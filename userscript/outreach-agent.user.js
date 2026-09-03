// ==UserScript==
// @name         Outreach Agent for LinkedIn
// @namespace    https://github.com/Arunendra21/linkedin-outreach-agent
// @version      1.0.0
// @description  Type a company: find engineers & new grads on LinkedIn, connect with a personalized note, verify their email (Hunter.io), and send interview-prep outreach via Gmail. Free, one-click install with Tampermonkey.
// @author       Arunendra Tripathi
// @match        https://www.linkedin.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @connect      api.hunter.io
// @run-at       document-idle
// @noframes
// ==/UserScript==

/* global GM_setValue, GM_getValue, GM_xmlhttpRequest, GM_openInTab */
(function () {
  'use strict';
  if (window.__outreachAgentLoaded) return;
  window.__outreachAgentLoaded = true;

  // ── tiny utils ──────────────────────────────────────────────
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => Math.floor(a + Math.random() * (b - a));
  const esc = s => (s || '').replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const stripDashes = s => (s || '').replace(/ [—–] /g, ', ').replace(/[—–]/g, '-');

  // ── persistent state (Tampermonkey storage, synchronous) ────
  const DEFAULTS = {
    name: '', headline: 'final-year CS student / new grad SWE', linkedin: '',
    hunterKey: '', minConfidence: 60,
    titles: 'Software Engineer, SDE, Backend Engineer, New Grad, Associate Software Engineer',
    maxConnects: 12, maxEmails: 12, minDelay: 40, maxDelay: 110,
  };
  const cfg = () => ({ ...DEFAULTS, ...(GM_getValue('cfg', {})) });
  const saveCfg = c => GM_setValue('cfg', c);
  const getPeople = () => GM_getValue('people', []);
  const setPeople = p => GM_setValue('people', p);
  const getContacted = () => GM_getValue('contacted', []);
  const addContacted = url => {
    const c = getContacted(); if (!c.includes(url)) { c.push(url); GM_setValue('contacted', c); }
  };
  const getLog = () => GM_getValue('log', []);
  function log(msg, level = 'info') {
    const l = getLog(); l.push({ t: new Date().toLocaleTimeString(), msg, level });
    GM_setValue('log', l.slice(-300)); renderLog();
  }
  const clearLog = () => { GM_setValue('log', []); renderLog(); };

  const titlesArr = () => cfg().titles.split(',').map(s => s.trim()).filter(Boolean);

  // ── message templates (in sync with the Python/extension) ───
  function connectionNote(p) {
    const c = cfg();
    const first = (p.name || 'there').trim().split(/\s+/)[0];
    const company = p.company || 'your team';
    let note = `Hi ${first}, I'm ${c.name}, ${c.headline || 'a new grad SWE'}. ` +
      `I'm preparing to apply at ${company} and would love to learn a bit about the ` +
      `team and interview process from someone actually there. Thanks for connecting!`;
    note = stripDashes(note);
    if (note.length > 300) note = note.slice(0, 297).trimEnd() + '...';
    return note;
  }
  function emailTemplate(p) {
    const c = cfg();
    const first = (p.name || 'there').trim().split(/\s+/)[0];
    const company = p.company || 'your company';
    const role = p.title || 'your role';
    const subject = `Quick question about the ${company} interview process`;
    const sig = [c.name, c.headline, c.linkedin].filter(Boolean).join('\n');
    const body =
`Hi ${first},

I hope you don't mind the cold email. I'm ${c.name}, ${c.headline || 'a new grad software engineer'}, and I'm preparing to apply for a software role at ${company}. I came across your profile (${role}) and thought you'd have a real sense of what it's actually like there.

If you have a couple of minutes, I'd really appreciate any pointers on:

  - What the team and work environment are genuinely like day to day
  - What the online assessment (OA) tends to look like, in terms of topics, format and difficulty
  - How you'd suggest preparing for the interview loop, and what they weigh most

Even a couple of quick lines would help me a lot. Totally understand if you're busy, no pressure at all, and thanks either way.

Best,
${sig}`;
    return { subject: stripDashes(subject), body: stripDashes(body) };
  }

  // ── LinkedIn scraping ───────────────────────────────────────
  const DEGREE = ['• 1st', '• 2nd', '• 3rd', 'degree connection'];
  function parseCardText(txt) {
    const lines = txt.split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) return null;
    const name = lines[0];
    if (['linkedin member', 'connect', 'follow', 'message'].includes(name.toLowerCase())) return null;
    const hasDegree = DEGREE.some(d => txt.includes(d));
    let title = '';
    for (let i = 0; i < lines.length; i++)
      if (/^• (1st|2nd|3rd)$/.test(lines[i])) { title = lines[i + 1] || ''; break; }
    if (!title) title = lines.slice(1).find(l =>
      /@|Engineer|Developer|SDE|Intern|Scientist|Analyst|Manager/.test(l)) || '';
    if (!hasDegree && !title) return null;
    return { name, title };
  }
  async function scrape(limit, company) {
    for (const f of [0.3, 0.6, 0.9, 1.0]) {
      window.scrollTo(0, document.body.scrollHeight * f); await sleep(1100);
    }
    const richest = {};
    for (const a of document.querySelectorAll('a[href*="/in/"]')) {
      const href = (a.href || '').split('?')[0];
      if (!href.includes('/in/')) continue;
      const txt = (a.innerText || '').trim();
      if (txt.length > (richest[href] || '').length) richest[href] = txt;
    }
    const out = [];
    for (const [href, txt] of Object.entries(richest)) {
      const parsed = parseCardText(txt);
      if (parsed) out.push({ profileUrl: href, company, ...parsed });
      if (out.length >= limit) break;
    }
    return out;
  }

  // ── connect flow (on the search results page) ───────────────
  function firstButton(res) {
    for (const b of document.querySelectorAll('button')) {
      if (b.offsetParent === null) continue;
      const text = (b.innerText || '').trim();
      const aria = (b.getAttribute('aria-label') || '').trim();
      if (res.some(r => r.test(text) || r.test(aria))) return b;
    }
    return null;
  }
  function cardConnectButton(profileUrl) {
    const path = (profileUrl.split('linkedin.com')[1] || profileUrl).replace(/\/$/, '');
    const a = document.querySelector(`a[href*="${path}"]`);
    if (!a) return null;
    let el = a;
    for (let i = 0; i < 9 && el; i++) {
      el = el.parentElement; if (!el) break;
      const btn = [...el.querySelectorAll('button')].find(b => {
        const t = (b.innerText || '').trim(); const al = b.getAttribute('aria-label') || '';
        return /^connect$/i.test(t) || /^Invite .* to connect$/i.test(al);
      });
      if (btn) return btn;
    }
    return null;
  }
  async function connectOne(p) {
    const btn = cardConnectButton(p.profileUrl);
    if (!btn) return 'no_button';
    btn.scrollIntoView({ block: 'center' }); await sleep(600);
    btn.click(); await sleep(1600);
    const addNote = firstButton([/add a note/i]);
    if (addNote) {
      addNote.click(); await sleep(1100);
      const ta = document.querySelector('textarea[name="message"], #custom-message, textarea');
      if (ta) {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, connectionNote(p));
        ta.dispatchEvent(new Event('input', { bubbles: true })); await sleep(700);
      }
    }
    const send = firstButton([/^send( now| invitation)?$/i]);
    if (!send) return 'error';
    send.click(); await sleep(1400); return 'sent';
  }
  let RUNNING = false;
  async function connectRun(selected) {
    const c = cfg();
    if (!c.name) { log('Set your name in Settings (gear icon) first.', 'error'); return; }
    RUNNING = true; setBusy(true);
    const people = getPeople().filter(p => selected.includes(p.profileUrl));
    const contacted = getContacted();
    let sent = 0;
    for (const p of people) {
      if (sent >= c.maxConnects) { log('Per-run connect cap reached.', 'warn'); break; }
      if (contacted.includes(p.profileUrl)) { log(`${p.name}: already contacted, skip`); continue; }
      log(`${p.name} — ${p.title || ''}`);
      let res; try { res = await connectOne(p); } catch (e) { res = 'error'; }
      if (res === 'sent') {
        sent++; addContacted(p.profileUrl);
        const all = getPeople(); const t = all.find(x => x.profileUrl === p.profileUrl);
        if (t) { t.connected = true; setPeople(all); }
        log('  connection sent', 'ok'); renderPeople();
        await sleep(rand(c.minDelay * 1000, c.maxDelay * 1000));
      } else {
        log(`  connect: ${res}`, 'warn');
        const dismiss = firstButton([/dismiss|cancel/i]);
        if (dismiss) { dismiss.click(); await sleep(600); }
      }
    }
    log(`Done. ${sent} connection(s) sent.`, 'ok');
    RUNNING = false; setBusy(false);
  }

  // ── Hunter.io via GM_xmlhttpRequest (no CORS issues) ────────
  function gmGetJSON(url) {
    return new Promise(res => {
      GM_xmlhttpRequest({
        method: 'GET', url, timeout: 15000,
        onload: r => { try { res(JSON.parse(r.responseText)); } catch { res(null); } },
        onerror: () => res(null), ontimeout: () => res(null),
      });
    });
  }
  function nameParts(full) {
    const parts = (full || '').normalize('NFKD').replace(/[^\x00-\x7F]/g, '')
      .split(/\s+/).filter(Boolean);
    if (!parts.length) return ['', ''];
    return [parts[0].toLowerCase().replace(/[^a-z]/g, ''),
            (parts[parts.length - 1] || '').toLowerCase().replace(/[^a-z]/g, '')];
  }
  async function verify() {
    const c = cfg(); setBusy(true);
    if (!c.hunterKey) log('No Hunter.io key set — emails will be guessed. Add a key in Settings.', 'warn');
    const people = getPeople();
    log(`Verifying emails for ${people.length} people…`);
    const domainCache = {};
    for (const p of people) {
      if (p.email && p.confidence != null) continue;
      const [first, last] = nameParts(p.name);
      let email = null, conf = 0.35, source = 'pattern';
      if (c.hunterKey) {
        if (!(p.company in domainCache)) {
          const dj = await gmGetJSON('https://api.hunter.io/v2/domain-search?company=' +
            encodeURIComponent(p.company) + '&limit=1&api_key=' + c.hunterKey);
          domainCache[p.company] = dj && dj.data && dj.data.domain;
        }
        const domain = domainCache[p.company];
        if (domain) {
          const fj = await gmGetJSON('https://api.hunter.io/v2/email-finder?domain=' + domain +
            '&first_name=' + first + '&last_name=' + last + '&api_key=' + c.hunterKey);
          if (fj && fj.data && fj.data.email) {
            email = fj.data.email; conf = (fj.data.score || 0) / 100; source = 'hunter';
          } else if (first) { email = `${first}.${last}@${domain}`.replace(/\.@/, '@'); }
        }
      }
      p.email = email; p.confidence = email ? conf : null; p.source = source;
      log(`  ${p.name}: ${email || 'not found'}` +
        (email ? ` (${source}, ${Math.round(conf * 100)}%)` : ''), email ? 'info' : 'warn');
      setPeople(people); renderPeople();
    }
    log('Email verification done.', 'ok'); setBusy(false);
  }

  // ── email via Gmail compose handoff ─────────────────────────
  function emailSelected(selected) {
    const c = cfg();
    const people = getPeople().filter(p => selected.includes(p.profileUrl));
    let opened = 0;
    for (const p of people) {
      if (opened >= c.maxEmails) { log('Per-run email cap reached.', 'warn'); break; }
      if (!p.email) { log(`${p.name}: no email, skip`, 'warn'); continue; }
      if (Math.round((p.confidence || 0) * 100) < c.minConfidence) {
        log(`${p.name}: ${p.email} ${Math.round((p.confidence || 0) * 100)}% < ${c.minConfidence}% — skip`, 'warn');
        continue;
      }
      const { subject, body } = emailTemplate(p);
      const url = 'https://mail.google.com/mail/?view=cm&fs=1&tf=1&to=' +
        encodeURIComponent(p.email) + '&su=' + encodeURIComponent(subject) +
        '&body=' + encodeURIComponent(body);
      GM_openInTab(url, { active: false, insert: true, setParent: true });
      opened++; log(`${p.name}: opened Gmail compose to ${p.email}`, 'ok');
    }
    log(`Opened ${opened} Gmail compose tab(s). Review and hit Send in each.`, 'ok');
  }

  // ── find (navigate to search, then auto-scrape after reload) ─
  function startFind(company, limit) {
    GM_setValue('pendingFind', { company, limit, ts: Date.now() });
    const kw = `${company} (${titlesArr().join(' OR ')})`;
    location.href = 'https://www.linkedin.com/search/results/people/?keywords=' +
      encodeURIComponent(kw) + '&origin=SWITCH_SEARCH_VERTICAL';
  }
  async function maybeResumeFind() {
    const pend = GM_getValue('pendingFind', null);
    if (!pend) return;
    if (!location.pathname.startsWith('/search/results/people')) return;
    GM_setValue('pendingFind', null);
    setBusy(true);
    log(`Searching for people at “${pend.company}”…`);
    await sleep(2500);
    const people = await scrape(pend.limit || 8, pend.company);
    const store = getPeople();
    const byUrl = Object.fromEntries(store.map(p => [p.profileUrl, p]));
    for (const p of people) byUrl[p.profileUrl] = { ...byUrl[p.profileUrl], ...p };
    setPeople(Object.values(byUrl));
    log(`Found ${people.length} people at ${pend.company}.`, 'ok');
    renderPeople(); setBusy(false); openPanel();
  }

  // ── UI (shadow DOM so LinkedIn styles can't interfere) ──────
  let root, elCompany, elLimit, elPeople, elLog, elCount, elSpin, panel;
  function css() {
    return `
    :host{all:initial}
    *{box-sizing:border-box;font-family:'Segoe UI',system-ui,sans-serif}
    .fab{position:fixed;right:20px;bottom:20px;width:52px;height:52px;border-radius:16px;
      background:#ff6a5a;color:#fff;font-size:24px;display:grid;place-items:center;cursor:pointer;
      box-shadow:0 10px 30px -8px rgba(255,106,90,.7);z-index:2147483646;border:none}
    .fab:hover{filter:brightness(1.08)}
    .panel{position:fixed;right:20px;bottom:84px;width:390px;max-height:82vh;background:#0f1524;
      color:#eef2fb;border:1px solid #232c44;border-radius:16px;z-index:2147483647;display:none;
      flex-direction:column;overflow:hidden;box-shadow:0 30px 70px -20px rgba(0,0,0,.75);font-size:13.5px}
    .panel.open{display:flex}
    .hd{display:flex;align-items:center;gap:8px;padding:13px 15px;background:#121829;
      border-bottom:1px solid #232c44}
    .hd .g{width:22px;height:22px;border-radius:7px;background:#ff6a5a;color:#fff;display:grid;
      place-items:center;font-size:12px}
    .hd b{font-weight:700;font-size:14px}
    .hd .sp{margin-left:auto;display:flex;gap:4px}
    .ic{background:none;border:none;color:#94a1c0;cursor:pointer;font-size:16px;padding:4px 6px;border-radius:6px}
    .ic:hover{color:#fff;background:#1b2437}
    .body{padding:12px 15px;overflow-y:auto}
    .warn{background:rgba(255,106,90,.14);color:#ffb4aa;padding:8px 10px;border-radius:8px;
      font-size:12px;margin-bottom:10px}
    input,textarea{width:100%;background:#0a0e1a;border:1px solid #33405f;color:#eef2fb;
      padding:8px 10px;border-radius:8px;font-size:13px}
    input:focus,textarea:focus{outline:none;border-color:#ff6a5a}
    .find{display:flex;gap:6px;margin-bottom:8px}
    .find input.c{flex:1}.find input.n{width:50px;text-align:center}
    .btn{font-weight:600;font-size:13px;padding:8px 12px;border-radius:8px;border:1px solid transparent;
      cursor:pointer;font-family:inherit}
    .btn:disabled{opacity:.5;cursor:not-allowed}
    .btn.p{background:#ff6a5a;color:#fff}.btn.p:hover:not(:disabled){filter:brightness(1.08)}
    .btn.g{background:#121829;color:#eef2fb;border-color:#33405f}.btn.g:hover:not(:disabled){background:#1b2437}
    .acts{display:flex;gap:6px;margin-bottom:10px}.acts .btn{flex:1}
    .lh{display:flex;align-items:center;gap:8px;font-size:12px;color:#94a1c0;margin:4px 0}
    .lh .ct{margin-left:auto;color:#5f6d8c}
    .row{display:flex;gap:9px;padding:8px 0;border-bottom:1px solid #232c44;align-items:flex-start}
    .row .m{flex:1;min-width:0}
    .row .nm{font-weight:600}.row .nm a{color:#eef2fb;text-decoration:none}.row .nm a:hover{color:#ff6a5a}
    .row .tt{color:#94a1c0;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .row .em{font-family:ui-monospace,monospace;font-size:11px;color:#5f6d8c;margin-top:2px;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .bd{font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;flex:none}
    .bd.hi{background:rgba(53,208,186,.16);color:#35d0ba}
    .bd.mid{background:rgba(242,180,92,.16);color:#f2b45c}
    .bd.lo{background:rgba(255,106,90,.16);color:#ff6a5a}
    .tag{font-size:9px;font-weight:700;padding:1px 6px;border-radius:5px;margin-left:5px;
      background:rgba(255,106,90,.16);color:#ff6a5a}
    .empty{color:#5f6d8c;font-style:italic;text-align:center;padding:18px 0}
    .log{margin-top:8px;max-height:120px;overflow-y:auto;font-family:ui-monospace,monospace;
      font-size:11px;line-height:1.65;border-top:1px solid #232c44;padding-top:8px}
    .ln .ts{color:#5f6d8c;margin-right:6px}
    .ln.ok{color:#35d0ba}.ln.warn{color:#f2b45c}.ln.error{color:#ff6a5a}.ln.info{color:#94a1c0}
    .spin{width:11px;height:11px;border:2px solid #33405f;border-top-color:#ff6a5a;border-radius:50%;
      animation:sp .7s linear infinite;display:none}
    .spin.on{display:inline-block}@keyframes sp{to{transform:rotate(360deg)}}
    .set{display:none}.set.on{display:block}.main.off{display:none}
    .fld{margin-bottom:9px}.fld label{display:block;font-size:11.5px;color:#94a1c0;margin-bottom:4px;font-weight:600}
    .two{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .hint{font-size:10.5px;color:#5f6d8c;margin-top:3px}
    a.link{color:#ff6a5a}
    input[type=checkbox]{width:15px;height:15px;accent-color:#ff6a5a;cursor:pointer}
    `;
  }
  function html() {
    return `
    <button class="fab" id="fab" title="Outreach Agent">◎</button>
    <div class="panel" id="panel">
      <div class="hd"><span class="g">◎</span><b>Outreach Agent</b>
        <span class="spin" id="spin"></span>
        <span class="sp"><button class="ic" id="gear" title="Settings">⚙</button>
        <button class="ic" id="close" title="Close">✕</button></span></div>
      <div class="body">
        <div class="warn" id="warn" style="display:none">Set your name in Settings ⚙ first.</div>

        <div class="main" id="main">
          <div class="find">
            <input class="c" id="company" placeholder="Company name (e.g. Stripe)">
            <input class="n" id="limit" type="number" min="1" max="25" value="8">
            <button class="btn p" id="find">Find</button>
          </div>
          <div class="acts">
            <button class="btn g" id="verify">Verify emails</button>
            <button class="btn g" id="connect">Connect</button>
            <button class="btn g" id="email">Email</button>
          </div>
          <div class="lh"><label><input type="checkbox" id="selall"> Select all</label>
            <span class="ct" id="count"></span></div>
          <div id="people"><p class="empty">Type a company and hit Find.</p></div>
          <div class="log" id="log"></div>
        </div>

        <div class="set" id="set">
          <div class="fld"><label>Your name</label><input id="s_name" placeholder="Jane Doe"></div>
          <div class="fld"><label>Headline</label><input id="s_headline"></div>
          <div class="fld"><label>Your LinkedIn URL</label><input id="s_linkedin" placeholder="https://www.linkedin.com/in/..."></div>
          <div class="fld"><label>Hunter.io API key</label><input id="s_hunterKey" type="password" placeholder="free at hunter.io/api-keys">
            <div class="hint">Get one free at <a class="link" href="https://hunter.io/api-keys" target="_blank">hunter.io/api-keys</a>. Without it emails are guessed.</div></div>
          <div class="two">
            <div class="fld"><label>Send email ≥ conf (%)</label><input id="s_minConfidence" type="number" min="0" max="100" value="60"></div>
            <div class="fld"><label>Max connects/run</label><input id="s_maxConnects" type="number" value="12"></div>
            <div class="fld"><label>Max emails/run</label><input id="s_maxEmails" type="number" value="12"></div>
            <div class="fld"><label>Delay min/max (s)</label>
              <div class="two"><input id="s_minDelay" type="number" value="40"><input id="s_maxDelay" type="number" value="110"></div></div>
          </div>
          <div class="fld"><label>Target titles (comma separated)</label><input id="s_titles"></div>
          <button class="btn p" id="save" style="width:100%">Save settings</button>
        </div>
      </div>
    </div>`;
  }

  function q(sel) { return root.querySelector(sel); }
  function openPanel() { q('#panel').classList.add('open'); refreshWarn(); }
  function setBusy(on) {
    if (!root) return;
    elSpin.classList.toggle('on', on);
    ['#find', '#verify', '#connect', '#email'].forEach(s => { const b = q(s); if (b) b.disabled = on; });
  }
  function badge(c) {
    if (c == null) return '<span class="bd lo">no email</span>';
    const p = Math.round(c * 100), cls = p >= 80 ? 'hi' : p >= 60 ? 'mid' : 'lo';
    return `<span class="bd ${cls}">${p}%</span>`;
  }
  function renderPeople() {
    if (!root) return;
    const people = getPeople();
    elCount.textContent = people.length ? `${people.length} found` : '';
    if (!people.length) { elPeople.innerHTML = '<p class="empty">Type a company and hit Find.</p>'; return; }
    elPeople.innerHTML = people.map(p => {
      const tag = p.connected ? '<span class="tag">connected</span>' : '';
      const hasEmail = p.email && p.confidence != null;
      return `<div class="row">
        <input type="checkbox" class="pick" data-url="${esc(p.profileUrl)}" checked>
        <div class="m"><div class="nm"><a href="${esc(p.profileUrl)}" target="_blank">${esc(p.name)}</a>${tag}</div>
        <div class="tt">${esc(p.title || '')}</div>${p.email ? `<div class="em">${esc(p.email)}</div>` : ''}</div>
        ${hasEmail ? badge(p.confidence) : ''}</div>`;
    }).join('');
  }
  function renderLog() {
    if (!root) return;
    elLog.innerHTML = getLog().map(l =>
      `<div class="ln ${l.level}"><span class="ts">${l.t}</span>${esc(l.msg)}</div>`).join('');
    elLog.scrollTop = elLog.scrollHeight;
  }
  function selected() {
    return [...root.querySelectorAll('.pick:checked')].map(c => c.dataset.url);
  }
  function refreshWarn() { q('#warn').style.display = cfg().name ? 'none' : 'block'; }

  function loadSettingsForm() {
    const c = cfg();
    q('#s_name').value = c.name; q('#s_headline').value = c.headline;
    q('#s_linkedin').value = c.linkedin; q('#s_hunterKey').value = c.hunterKey;
    q('#s_minConfidence').value = c.minConfidence; q('#s_maxConnects').value = c.maxConnects;
    q('#s_maxEmails').value = c.maxEmails; q('#s_minDelay').value = c.minDelay;
    q('#s_maxDelay').value = c.maxDelay; q('#s_titles').value = c.titles;
  }
  function toggleSettings(show) {
    q('#set').classList.toggle('on', show); q('#main').classList.toggle('off', show);
    if (show) loadSettingsForm();
  }

  function buildUI() {
    const host = document.createElement('div');
    host.id = 'outreach-agent-host';
    document.documentElement.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style'); style.textContent = css();
    const div = document.createElement('div'); div.innerHTML = html();
    root.append(style, div);

    elCompany = q('#company'); elLimit = q('#limit'); elPeople = q('#people');
    elLog = q('#log'); elCount = q('#count'); elSpin = q('#spin');

    q('#fab').onclick = () => { q('#panel').classList.toggle('open'); refreshWarn(); };
    q('#close').onclick = () => q('#panel').classList.remove('open');
    q('#gear').onclick = () => toggleSettings(!q('#set').classList.contains('on'));
    q('#save').onclick = () => {
      saveCfg({
        name: q('#s_name').value.trim(), headline: q('#s_headline').value.trim(),
        linkedin: q('#s_linkedin').value.trim(), hunterKey: q('#s_hunterKey').value.trim(),
        minConfidence: +q('#s_minConfidence').value, maxConnects: +q('#s_maxConnects').value,
        maxEmails: +q('#s_maxEmails').value, minDelay: +q('#s_minDelay').value,
        maxDelay: +q('#s_maxDelay').value, titles: q('#s_titles').value,
      });
      toggleSettings(false); refreshWarn(); log('Settings saved.', 'ok');
    };
    q('#find').onclick = () => {
      const company = elCompany.value.trim(); if (!company) return elCompany.focus();
      startFind(company, +elLimit.value);
    };
    q('#verify').onclick = () => verify();
    q('#connect').onclick = () => { const s = selected(); if (s.length) connectRun(s); };
    q('#email').onclick = () => { const s = selected(); if (s.length) emailSelected(s); };
    q('#selall').onchange = e => root.querySelectorAll('.pick').forEach(c => c.checked = e.target.checked);

    renderPeople(); renderLog();
  }

  // ── boot ────────────────────────────────────────────────────
  buildUI();
  maybeResumeFind();
})();
