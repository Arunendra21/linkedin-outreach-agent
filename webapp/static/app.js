// ── tiny helpers ─────────────────────────────────────────────
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const api = async (url, body) => {
  const opt = body ? {method:'POST',headers:{'Content-Type':'application/json'},
                      body:JSON.stringify(body)} : {};
  const r = await fetch(url, opt);
  return r.json().catch(()=>({}));
};
let CURRENT_COMPANY = '';

// ── accordion ────────────────────────────────────────────────
$$('[data-toggle]').forEach(h => h.addEventListener('click', () => {
  h.closest('.step').classList.toggle('open');
}));
function openStep(n){ const s=$('#step'+n); if(s){s.classList.add('open');
  s.scrollIntoView({behavior:'smooth',block:'center'});} }
function markDone(n){ $('#step'+n)?.classList.add('done'); }

// ── config ───────────────────────────────────────────────────
async function loadConfig(){
  const c = await api('/api/config');
  $('#me-name').value = c.me?.name || '';
  $('#me-headline').value = c.me?.headline || '';
  $('#me-linkedin').value = c.me?.linkedin || '';
  $('#min-conf').value = Math.round((c.min_confidence_to_send ?? .6)*100);
  $('#lim-conn').value = c.limits?.max_connects_per_run ?? 12;
  $('#lim-mail').value = c.limits?.max_emails_per_run ?? 12;
  $('#titles').value = (c.target_titles||[]).join(', ');
}
$('#save-config').onclick = async () => {
  const body = {
    me:{ name:$('#me-name').value.trim(), headline:$('#me-headline').value.trim(),
         linkedin:$('#me-linkedin').value.trim() },
    limits:{ max_connects_per_run:+$('#lim-conn').value,
             max_emails_per_run:+$('#lim-mail').value },
    target_titles:$('#titles').value.split(',').map(s=>s.trim()).filter(Boolean),
    min_confidence_to_send:(+$('#min-conf').value)/100,
  };
  await api('/api/config', body);
  const s=$('#save-status'); s.textContent='✓ saved'; s.style.color='var(--ok)';
  markDone(1); setTimeout(()=>s.textContent='',2500); openStep(2);
};

// ── status pills ─────────────────────────────────────────────
async function refreshState(){
  const s = await api('/api/state');
  setPill('#pill-linkedin', s.profile_exists, 'LinkedIn');
  setPill('#pill-hunter', s.hunter, 'Hunter.io');
  setPill('#pill-smtp', !!s.smtp_user, s.smtp_user ? 'Email ✓' : 'Email');
}
function setPill(sel, on, label){
  const p=$(sel); p.classList.toggle('on',!!on); p.classList.toggle('off',!on);
  p.innerHTML = '<span class="dot"></span>'+label;
}

// ── job actions ──────────────────────────────────────────────
function busy(btn, on){ btn.disabled=on; }
$('#btn-login').onclick = async () => {
  busy($('#btn-login'),true);
  $('#login-status').textContent='opening Chrome…';
  const r = await api('/api/login', {});
  if(r.error){ $('#login-status').textContent=r.error; busy($('#btn-login'),false); }
};
$('#btn-search').onclick = async () => {
  const company=$('#company').value.trim(); if(!company){$('#company').focus();return;}
  CURRENT_COMPANY = company;
  busy($('#btn-search'),true); $('#search-status').textContent='searching…';
  const r = await api('/api/search',{company,limit:+$('#limit').value});
  if(r.error){ $('#search-status').textContent=r.error; busy($('#btn-search'),false); }
};
$('#btn-emails').onclick = async () => {
  busy($('#btn-emails'),true); $('#emails-status').textContent='verifying…';
  const r = await api('/api/find-emails',{company:CURRENT_COMPANY});
  if(r.error){ $('#emails-status').textContent=r.error; busy($('#btn-emails'),false); }
};
$('#btn-send').onclick = async () => {
  const selected = $$('.pick:checked').map(c=>c.dataset.url);
  if(!selected.length){ $('#send-status').textContent='select at least one person';
    $('#send-status').style.color='var(--warn)'; return; }
  busy($('#btn-send'),true); $('#send-status').textContent='sending…';
  $('#send-status').style.color='var(--muted)';
  const r = await api('/api/send',{ selected,
    connect:$('#tg-connect').checked, email:$('#tg-email').checked });
  if(r.error){ $('#send-status').textContent=r.error; busy($('#btn-send'),false); }
};
$('#btn-refresh').onclick = loadPeople;
$('#btn-selall').onclick = () => {
  const boxes=$$('.pick'); const all=boxes.every(b=>b.checked);
  boxes.forEach(b=>b.checked=!all);
};

// ── people table ─────────────────────────────────────────────
function confBadge(c){
  if(c==null) return '<span class="badge none">—</span>';
  const pct=Math.round(c*100);
  const cls = pct>=80?'hi':pct>=60?'mid':'lo';
  return `<span class="badge ${cls}">${pct}%</span>`;
}
async function loadPeople(){
  const q = CURRENT_COMPANY ? '?company='+encodeURIComponent(CURRENT_COMPANY) : '';
  const {people} = await api('/api/people'+q);
  const body=$('#people-body');
  if(!people || !people.length){
    body.innerHTML='<tr><td colspan="5" class="empty" style="padding:22px">No people yet — run Steps 3 &amp; 4.</td></tr>';
    return;
  }
  body.innerHTML = people.map(p=>{
    const status = [
      p.connected?'<span class="tag c">connected</span>':'',
      p.emailed?'<span class="tag e">emailed</span>':'',
    ].join('') || '<span class="hint">new</span>';
    const dis = (p.connected&&p.emailed)?'disabled':'';
    return `<tr>
      <td><input type="checkbox" class="pick" data-url="${p.profile_url}" ${dis} ${dis?'':'checked'}></td>
      <td class="who"><div class="nm"><a href="${p.profile_url}" target="_blank">${esc(p.name)}</a></div>
        <div class="tt">${esc(p.title||'')}</div></td>
      <td>${p.email?esc(p.email):'<span class="hint">—</span>'}</td>
      <td>${confBadge(p.confidence)}</td>
      <td>${status}</td>
    </tr>`;
  }).join('');
}
const esc = s => (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ── live log polling ─────────────────────────────────────────
let logCursor=0, wasRunning=false;
$('#console-head').onclick = e => {
  if(e.target.id==='btn-clear') return;
  $('#console').classList.toggle('expanded');
};
$('#btn-clear').onclick = async () => { await api('/api/logs/clear',{});
  logCursor=0; $('#console-log').innerHTML=''; };

async function pollLogs(){
  try{
    const r = await api('/api/logs?since='+logCursor);
    if(r.lines && r.lines.length){
      const box=$('#console-log');
      r.lines.forEach(l=>{
        const div=document.createElement('div');
        div.className='ln '+(l.level||'info');
        div.innerHTML=`<span class="ts">${l.t}</span>${esc(l.msg)}`;
        box.appendChild(div);
      });
      box.scrollTop=box.scrollHeight;
      logCursor=r.next;
      if(!$('#console').classList.contains('expanded'))
        $('#console').classList.add('expanded');
    }
    // running indicator + step completion
    $('#console').classList.toggle('running', r.running);
    $('#console-sub').textContent = r.running ? (r.kind+'…') : 'click to expand';
    if(wasRunning && !r.running){ onJobDone(r.kind); }
    wasRunning=r.running;
  }catch(e){}
}
function onJobDone(kind){
  ['btn-login','btn-search','btn-emails','btn-send'].forEach(id=>$('#'+id).disabled=false);
  if(kind==='login'){ markDone(2); $('#login-status').textContent='✓ connected';
    $('#login-status').style.color='var(--ok)'; refreshState(); openStep(3); }
  if(kind==='search'){ markDone(3); $('#search-status').textContent='✓ done';
    $('#search-status').style.color='var(--ok)'; loadPeople(); openStep(4); }
  if(kind==='find-emails'){ markDone(4); $('#emails-status').textContent='✓ verified';
    $('#emails-status').style.color='var(--ok)'; loadPeople(); openStep(5); }
  if(kind==='send'){ markDone(5); $('#send-status').textContent='✓ sent';
    $('#send-status').style.color='var(--ok)'; loadPeople(); }
}

// ── boot ─────────────────────────────────────────────────────
loadConfig(); refreshState(); loadPeople();
setInterval(pollLogs, 700);
setInterval(refreshState, 8000);
