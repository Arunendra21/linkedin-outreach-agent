// Service worker: orchestrates search navigation, Hunter.io verification, the
// Gmail compose handoff, and keeps the shared log + state in chrome.storage.

const DEFAULTS = {
  name: '', headline: 'final-year CS student / new grad SWE', linkedin: '',
  hunterKey: '', fromEmail: '', minConfidence: 0.6,
  titles: ['Software Engineer', 'SDE', 'Backend Engineer', 'New Grad',
           'Associate Software Engineer'],
  maxConnects: 12, maxEmails: 12, minDelay: 40, maxDelay: 110,
};

const stripDashes = s => (s || '').replace(/ [—–] /g, ', ').replace(/[—–]/g, '-');

async function getCfg() {
  const c = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...c };
}
async function getLocal(k, d) { return (await chrome.storage.local.get({ [k]: d }))[k]; }
async function setLocal(o) { return chrome.storage.local.set(o); }

async function log(msg, level = 'info') {
  const lines = await getLocal('log', []);
  lines.push({ t: new Date().toLocaleTimeString(), msg, level });
  await setLocal({ log: lines.slice(-400) });
}

// ── tabs ──────────────────────────────────────────────────────
function waitForComplete(tabId, timeout = 25000) {
  return new Promise(res => {
    const t0 = Date.now();
    const iv = setInterval(async () => {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete' || Date.now() - t0 > timeout) {
          clearInterval(iv); res(tab);
        }
      } catch { clearInterval(iv); res(null); }
    }, 500);
  });
}

async function linkedinTab() {
  const stored = await getLocal('tabId', null);
  if (stored != null) { try { return await chrome.tabs.get(stored); } catch {} }
  const [t] = await chrome.tabs.query({ url: 'https://www.linkedin.com/*' });
  if (t) return t;
  return chrome.tabs.create({ url: 'https://www.linkedin.com/feed/', active: true });
}

// ── FIND ──────────────────────────────────────────────────────
async function find(company, limit) {
  const cfg = await getCfg();
  const kw = `${company} (${cfg.titles.join(' OR ')})`;
  const url = 'https://www.linkedin.com/search/results/people/?keywords=' +
    encodeURIComponent(kw) + '&origin=SWITCH_SEARCH_VERTICAL';
  await log(`Searching LinkedIn for people at “${company}”…`);
  let tab = await linkedinTab();
  await setLocal({ tabId: tab.id, company });
  await chrome.tabs.update(tab.id, { url, active: true });
  await waitForComplete(tab.id);
  await new Promise(r => setTimeout(r, 2500));
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'SCRAPE', limit });
    const people = (res && res.people || []).map(p => ({ ...p, company }));
    const store = await getLocal('people', []);
    const byUrl = Object.fromEntries(store.map(p => [p.profileUrl, p]));
    for (const p of people) byUrl[p.profileUrl] = { ...byUrl[p.profileUrl], ...p };
    await setLocal({ people: Object.values(byUrl) });
    await log(`Found ${people.length} people at ${company}.`, 'ok');
  } catch (e) {
    await log('Could not read the page. Make sure you are logged into LinkedIn ' +
      'and on the search results, then try again.', 'error');
  }
  await log('__DONE__find');
}

// ── Hunter.io verification ────────────────────────────────────
function nameParts(full) {
  const parts = (full || '').normalize('NFKD').replace(/[^\x00-\x7F]/g, '')
    .split(/\s+/).filter(Boolean);
  if (!parts.length) return ['', ''];
  return [parts[0].toLowerCase().replace(/[^a-z]/g, ''),
          (parts[parts.length - 1] || '').toLowerCase().replace(/[^a-z]/g, '')];
}
async function hunterDomain(company, key) {
  try {
    const r = await fetch('https://api.hunter.io/v2/domain-search?company=' +
      encodeURIComponent(company) + '&limit=1&api_key=' + key);
    const j = await r.json(); return j.data && j.data.domain;
  } catch { return null; }
}
async function hunterFind(first, last, domain, key) {
  try {
    const r = await fetch('https://api.hunter.io/v2/email-finder?domain=' + domain +
      '&first_name=' + first + '&last_name=' + last + '&api_key=' + key);
    const j = await r.json();
    return j.data ? { email: j.data.email, score: j.data.score } : {};
  } catch { return {}; }
}
function patternGuess(first, last, domain) {
  if (!first || !domain) return null;
  return `${first}.${last}@${domain}`.replace(/\.@/, '@');
}

async function verify() {
  const cfg = await getCfg();
  const people = await getLocal('people', []);
  if (!cfg.hunterKey) await log('No Hunter.io key set — using pattern guesses ' +
    '(add a key in Settings for verified emails).', 'warn');
  await log(`Verifying emails for ${people.length} people…`);
  let domainCache = {};
  for (const p of people) {
    if (p.email && p.confidence != null) continue;
    const [first, last] = nameParts(p.name);
    let email = null, conf = 0.35, source = 'pattern';
    if (cfg.hunterKey) {
      if (!(p.company in domainCache))
        domainCache[p.company] = await hunterDomain(p.company, cfg.hunterKey);
      const domain = domainCache[p.company];
      if (domain) {
        const r = await hunterFind(first, last, domain, cfg.hunterKey);
        if (r.email) { email = r.email; conf = (r.score || 0) / 100; source = 'hunter'; }
        else { email = patternGuess(first, last, domain); }
      }
    }
    p.email = email; p.confidence = email ? conf : null; p.source = source;
    await log(`  ${p.name}: ${email || 'not found'}` +
      (email ? ` (${source}, ${Math.round(conf * 100)}%)` : ''), email ? 'info' : 'warn');
  }
  await setLocal({ people });
  await log('Email verification done.', 'ok');
  await log('__DONE__verify');
}

// ── CONNECT (hand to content script on the search page) ───────
async function connect(selected) {
  const cfg = await getCfg();
  if (!cfg.name) { await log('Set your name in Settings first.', 'error');
    await log('__DONE__connect'); return; }
  const people = (await getLocal('people', [])).filter(p => selected.includes(p.profileUrl));
  const contacted = await getLocal('contacted', []);
  const tabId = await getLocal('tabId', null);
  if (tabId == null) { await log('Run “Find people” first.', 'error');
    await log('__DONE__connect'); return; }
  try {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.tabs.sendMessage(tabId, {
      type: 'CONNECT_RUN', people, contacted,
      me: { name: cfg.name, headline: cfg.headline },
      caps: { maxConnects: cfg.maxConnects, minDelay: cfg.minDelay, maxDelay: cfg.maxDelay },
    });
  } catch (e) {
    await log('Lost the LinkedIn tab. Re-run “Find people”, then Connect.', 'error');
    await log('__DONE__connect');
  }
}

// ── EMAIL (Gmail compose handoff) ─────────────────────────────
function emailTemplate(p, cfg) {
  const first = (p.name || 'there').trim().split(/\s+/)[0];
  const company = p.company || 'your company';
  const role = p.title || 'your role';
  const subject = `Quick question about the ${company} interview process`;
  const sig = [cfg.name, cfg.headline, cfg.linkedin].filter(Boolean).join('\n');
  const body =
`Hi ${first},

I hope you don't mind the cold email. I'm ${cfg.name}, ${cfg.headline || 'a new grad software engineer'}, and I'm preparing to apply for a software role at ${company}. I came across your profile (${role}) and thought you'd have a real sense of what it's actually like there.

If you have a couple of minutes, I'd really appreciate any pointers on:

  - What the team and work environment are genuinely like day to day
  - What the online assessment (OA) tends to look like, in terms of topics, format and difficulty
  - How you'd suggest preparing for the interview loop, and what they weigh most

Even a couple of quick lines would help me a lot. Totally understand if you're busy, no pressure at all, and thanks either way.

Best,
${sig}`;
  return { subject: stripDashes(subject), body: stripDashes(body) };
}

async function emailSelected(selected) {
  const cfg = await getCfg();
  const people = (await getLocal('people', [])).filter(p => selected.includes(p.profileUrl));
  let opened = 0;
  for (const p of people) {
    if (opened >= cfg.maxEmails) { await log('Per-run email cap reached.', 'warn'); break; }
    if (!p.email) { await log(`${p.name}: no email, skip`, 'warn'); continue; }
    if ((p.confidence ?? 0) < cfg.minConfidence) {
      await log(`${p.name}: ${p.email} ${Math.round((p.confidence || 0) * 100)}% ` +
        `below ${Math.round(cfg.minConfidence * 100)}% — skip`, 'warn'); continue;
    }
    const { subject, body } = emailTemplate(p, cfg);
    const url = 'https://mail.google.com/mail/?view=cm&fs=1&tf=1&to=' +
      encodeURIComponent(p.email) + '&su=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body);
    await chrome.tabs.create({ url, active: false });
    opened++;
    await log(`${p.name}: opened Gmail compose to ${p.email}`, 'ok');
    await new Promise(r => setTimeout(r, 700));
  }
  await log(`Opened ${opened} Gmail compose tab(s). Review and hit Send in each.`, 'ok');
  await log('__DONE__email');
}

// ── message router ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((req, _s, reply) => {
  (async () => {
    if (req.type === 'FIND') { await find(req.company, req.limit); reply({ ok: true }); }
    else if (req.type === 'VERIFY') { await verify(); reply({ ok: true }); }
    else if (req.type === 'CONNECT') { await connect(req.selected); reply({ ok: true }); }
    else if (req.type === 'EMAIL') { await emailSelected(req.selected); reply({ ok: true }); }
    else if (req.type === 'LOG') { await log(req.msg, req.level); reply({ ok: true }); }
    else if (req.type === 'CONNECTED') {
      const c = await getLocal('contacted', []);
      if (!c.includes(req.profileUrl)) { c.push(req.profileUrl); await setLocal({ contacted: c }); }
      const people = await getLocal('people', []);
      const p = people.find(x => x.profileUrl === req.profileUrl);
      if (p) { p.connected = true; await setLocal({ people }); }
      reply({ ok: true });
    }
    else if (req.type === 'DONE') { await log('__DONE__' + req.kind); reply({ ok: true }); }
    else reply({ ok: false });
  })();
  return true;
});
