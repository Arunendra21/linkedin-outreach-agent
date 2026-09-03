const $ = s => document.querySelector(s);
const send = msg => chrome.runtime.sendMessage(msg);
const esc = s => (s || '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let logCursor = 0, running = false;

// ── settings gate ─────────────────────────────────────────────
async function checkSetup() {
  const c = await chrome.storage.sync.get({ name: '', hunterKey: '' });
  $('#setup-warn').hidden = !!c.name;
}
$('#settings').onclick = () => chrome.runtime.openOptionsPage();
$('#open-opts').onclick = () => chrome.runtime.openOptionsPage();

// ── people list ───────────────────────────────────────────────
function badge(c) {
  if (c == null) return '<span class="badge lo">no email</span>';
  const p = Math.round(c * 100);
  const cls = p >= 80 ? 'hi' : p >= 60 ? 'mid' : 'lo';
  return `<span class="badge ${cls}">${p}%</span>`;
}
async function render() {
  const people = (await chrome.storage.local.get({ people: [] })).people;
  const box = $('#people');
  $('#count').textContent = people.length ? `${people.length} found` : '';
  if (!people.length) {
    box.innerHTML = '<p class="empty">No people yet. Type a company and hit <b>Find</b>.</p>';
    return;
  }
  box.innerHTML = people.map(p => {
    const tags = (p.connected ? '<span class="tag">connected</span>' : '');
    const hasEmail = p.email && p.confidence != null;
    return `<div class="row">
      <input type="checkbox" class="pick" data-url="${esc(p.profileUrl)}" checked>
      <div class="meta">
        <div class="nm"><a href="${esc(p.profileUrl)}" target="_blank">${esc(p.name)}</a>${tags}</div>
        <div class="tt">${esc(p.title || '')}</div>
        ${p.email ? `<div class="em">${esc(p.email)}</div>` : ''}
      </div>
      ${hasEmail ? badge(p.confidence) : (p.email ? '' : '')}
    </div>`;
  }).join('');
}
function selected() {
  return [...document.querySelectorAll('.pick:checked')].map(c => c.dataset.url);
}
$('#selall').onchange = e =>
  document.querySelectorAll('.pick').forEach(c => c.checked = e.target.checked);

// ── actions ───────────────────────────────────────────────────
function setBusy(on) {
  running = on;
  $('#spin').hidden = !on;
  ['btn-find', 'btn-verify', 'btn-connect', 'btn-email'].forEach(id => $('#' + id).disabled = on);
}
$('#btn-find').onclick = () => {
  const company = $('#company').value.trim();
  if (!company) return $('#company').focus();
  setBusy(true);
  send({ type: 'FIND', company, limit: +$('#limit').value });
};
$('#btn-verify').onclick = () => { setBusy(true); send({ type: 'VERIFY' }); };
$('#btn-connect').onclick = () => {
  const sel = selected(); if (!sel.length) return;
  setBusy(true); send({ type: 'CONNECT', selected: sel });
};
$('#btn-email').onclick = () => {
  const sel = selected(); if (!sel.length) return;
  setBusy(true); send({ type: 'EMAIL', selected: sel });
};

// ── live log polling ──────────────────────────────────────────
async function pollLog() {
  const lines = (await chrome.storage.local.get({ log: [] })).log;
  const box = $('#log');
  if (lines.length < logCursor) { logCursor = 0; box.innerHTML = ''; }
  for (let i = logCursor; i < lines.length; i++) {
    const l = lines[i];
    if (l.msg.startsWith('__DONE__')) { setBusy(false); render(); continue; }
    const d = document.createElement('div');
    d.className = 'ln ' + (l.level || 'info');
    d.innerHTML = `<span class="ts">${l.t}</span>${esc(l.msg)}`;
    box.appendChild(d);
  }
  logCursor = lines.length;
  box.scrollTop = box.scrollHeight;
}

// ── boot ──────────────────────────────────────────────────────
checkSetup();
render();
pollLog();
setInterval(pollLog, 800);
setInterval(render, 3000);
