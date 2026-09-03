// Runs inside linkedin.com pages. Scrapes people from a search results page and
// performs the paced "connect + note" flow entirely in-page (no navigation), so
// one script instance stays alive through the whole run.

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => Math.floor(a + Math.random() * (b - a));
const stripDashes = s => (s || '').replace(/ [—–] /g, ', ').replace(/[—–]/g, '-');

function log(msg, level = 'info') {
  chrome.runtime.sendMessage({ type: 'LOG', msg, level });
}

// ── note template (kept in sync with outreach/templates.py) ──
function connectionNote(p, me) {
  const first = (p.name || 'there').trim().split(/\s+/)[0];
  const company = p.company || 'your team';
  let note = `Hi ${first}, I'm ${me.name}, ${me.headline || 'a new grad SWE'}. ` +
    `I'm preparing to apply at ${company} and would love to learn a bit about the ` +
    `team and interview process from someone actually there. Thanks for connecting!`;
  note = stripDashes(note);
  if (note.length > 300) note = note.slice(0, 297).trimEnd() + '...';
  return note;
}

// ── scraping ──────────────────────────────────────────────────
const DEGREE = ['• 1st', '• 2nd', '• 3rd', 'degree connection'];

function parseCardText(txt) {
  const lines = txt.split('\n').map(s => s.trim()).filter(Boolean);
  if (!lines.length) return null;
  const name = lines[0];
  if (['linkedin member', 'connect', 'follow', 'message'].includes(name.toLowerCase()))
    return null;
  const hasDegree = DEGREE.some(d => txt.includes(d));
  let title = '';
  for (let i = 0; i < lines.length; i++) {
    if (/^• (1st|2nd|3rd)$/.test(lines[i])) { title = lines[i + 1] || ''; break; }
  }
  if (!title) {
    title = lines.slice(1).find(l =>
      /@|Engineer|Developer|SDE|Intern|Scientist|Analyst|Manager/.test(l)) || '';
  }
  if (!hasDegree && !title) return null;
  return { name, title };
}

async function scrape(limit) {
  for (const f of [0.3, 0.6, 0.9, 1.0]) {
    window.scrollTo(0, document.body.scrollHeight * f);
    await sleep(1100);
  }
  const anchors = [...document.querySelectorAll('a[href*="/in/"]')];
  const richest = {};
  for (const a of anchors) {
    const href = (a.href || '').split('?')[0];
    if (!href.includes('/in/')) continue;
    const txt = (a.innerText || '').trim();
    if (txt.length > (richest[href] || '').length) richest[href] = txt;
  }
  const out = [];
  for (const [href, txt] of Object.entries(richest)) {
    const parsed = parseCardText(txt);
    if (parsed) out.push({ profileUrl: href, ...parsed });
    if (out.length >= limit) break;
  }
  return out;
}

// ── connect flow (on the search results page) ────────────────
function firstButton(matchers) {
  for (const b of document.querySelectorAll('button')) {
    if (b.offsetParent === null) continue;
    const text = (b.innerText || '').trim();
    const aria = (b.getAttribute('aria-label') || '').trim();
    if (matchers.some(m => m.test(text) || m.test(aria))) return b;
  }
  return null;
}

function cardConnectButton(profileUrl) {
  const path = profileUrl.split('linkedin.com')[1] || profileUrl;
  const a = document.querySelector(`a[href*="${path.replace(/\/$/, '')}"]`);
  if (!a) return null;
  let el = a;
  for (let i = 0; i < 9 && el; i++) {
    el = el.parentElement;
    if (!el) break;
    const btn = [...el.querySelectorAll('button')].find(b => {
      const t = (b.innerText || '').trim();
      const al = b.getAttribute('aria-label') || '';
      return /^connect$/i.test(t) || /^Invite .* to connect$/i.test(al);
    });
    if (btn) return btn;
  }
  return null;
}

async function connectOne(person, me) {
  const btn = cardConnectButton(person.profileUrl);
  if (!btn) return 'no_button';
  btn.scrollIntoView({ block: 'center' });
  await sleep(600);
  btn.click();
  await sleep(1600);

  // "Add a note"
  const addNote = firstButton([/add a note/i]);
  if (addNote) {
    addNote.click();
    await sleep(1200);
    const ta = document.querySelector('textarea[name="message"], #custom-message, textarea');
    if (ta) {
      const note = connectionNote(person, me);
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, note);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(700);
    }
  }
  const send = firstButton([/^send( now| invitation)?$/i]);
  if (!send) return 'error';
  send.click();
  await sleep(1500);
  return 'sent';
}

async function connectRun(people, me, caps, contacted) {
  let sent = 0;
  for (const p of people) {
    if (sent >= caps.maxConnects) { log('Per-run connect cap reached.', 'warn'); break; }
    if (contacted.includes(p.profileUrl)) { log(`${p.name}: already contacted, skip`); continue; }
    log(`${p.name} — ${p.title || ''}`);
    let res;
    try { res = await connectOne(p, me); }
    catch (e) { res = 'error'; }
    if (res === 'sent') {
      sent++;
      chrome.runtime.sendMessage({ type: 'CONNECTED', profileUrl: p.profileUrl });
      log('  connection sent', 'ok');
      await sleep(rand(caps.minDelay * 1000, caps.maxDelay * 1000));
    } else {
      log(`  connect: ${res}`, 'warn');
      // close any open modal before next
      const dismiss = firstButton([/dismiss|cancel/i]);
      if (dismiss) { dismiss.click(); await sleep(600); }
    }
  }
  chrome.runtime.sendMessage({ type: 'DONE', kind: 'connect', sent });
}

// ── message router ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((req, _sender, reply) => {
  if (req.type === 'PING') { reply({ ok: true, url: location.href }); return; }
  if (req.type === 'SCRAPE') {
    scrape(req.limit || 10).then(people => reply({ people }));
    return true;
  }
  if (req.type === 'CONNECT_RUN') {
    connectRun(req.people, req.me, req.caps, req.contacted || []);
    reply({ started: true });
    return true;
  }
});
