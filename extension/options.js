const DEFAULTS = {
  name: '', headline: 'final-year CS student / new grad SWE', linkedin: '',
  hunterKey: '', minConfidence: 0.6,
  titles: ['Software Engineer', 'SDE', 'Backend Engineer', 'New Grad',
           'Associate Software Engineer'],
  maxConnects: 12, maxEmails: 12, minDelay: 40, maxDelay: 110,
};
const $ = id => document.getElementById(id);

async function load() {
  const c = await chrome.storage.sync.get(DEFAULTS);
  $('name').value = c.name;
  $('headline').value = c.headline;
  $('linkedin').value = c.linkedin;
  $('hunterKey').value = c.hunterKey;
  $('minConfidence').value = Math.round(c.minConfidence * 100);
  $('titles').value = (c.titles || []).join(', ');
  $('maxConnects').value = c.maxConnects;
  $('maxEmails').value = c.maxEmails;
  $('minDelay').value = c.minDelay;
  $('maxDelay').value = c.maxDelay;
}

$('save').onclick = async () => {
  const data = {
    name: $('name').value.trim(),
    headline: $('headline').value.trim(),
    linkedin: $('linkedin').value.trim(),
    hunterKey: $('hunterKey').value.trim(),
    minConfidence: Math.max(0, Math.min(100, +$('minConfidence').value)) / 100,
    titles: $('titles').value.split(',').map(s => s.trim()).filter(Boolean),
    maxConnects: +$('maxConnects').value,
    maxEmails: +$('maxEmails').value,
    minDelay: +$('minDelay').value,
    maxDelay: +$('maxDelay').value,
  };
  await chrome.storage.sync.set(data);
  const s = $('status'); s.textContent = '✓ saved'; s.style.color = 'var(--teal)';
  setTimeout(() => (s.textContent = ''), 2500);
};

load();
