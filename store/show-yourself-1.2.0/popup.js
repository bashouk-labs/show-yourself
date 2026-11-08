'use strict';
const t = ShowYourselfI18n.t;
ShowYourselfI18n.translatePage(document);

const store = chrome.storage.local;
const $ = (id) => document.getElementById(id);

function renderStats(stats) {
  const cutoff = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
  let spotted = 0;
  let blocked = 0;
  Object.keys(stats || {}).forEach((day) => {
    if (day >= cutoff) { spotted += stats[day][0]; blocked += stats[day][1]; }
  });
  $('spotted').textContent = spotted;
  $('blocked').textContent = blocked;
}

// Compact chips: the first few are shown, "Show all (N)" opens the rest,
// and a search box appears once the list gets long.
const PREVIEW = 6;
const SEARCH_FROM = 8;
let trustedList = [];
let expanded = false;

function renderTrusted(list) {
  if (list) trustedList = list;
  const all = trustedList;
  const q = $('trustedSearch').value.trim().toLowerCase();
  const showSearch = expanded && all.length >= SEARCH_FROM;
  $('trustedSearch').hidden = !showSearch;
  const filtered = showSearch && q ? all.filter((d) => d.includes(q)) : all;
  const shown = expanded ? filtered : filtered.slice(0, PREVIEW);

  const ul = $('trusted');
  ul.replaceChildren();
  shown.forEach((domain) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = domain;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '×';
    btn.title = t('p.remove') + ' ' + domain;
    btn.setAttribute('aria-label', btn.title);
    btn.addEventListener('click', () => {
      store.set({ trusted: all.filter((d) => d !== domain) });
    });
    li.append(name, btn);
    ul.appendChild(li);
  });

  if (showSearch && q && !filtered.length) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = t('p.noMatch');
    ul.appendChild(li);
  }
  $('trustedMore').hidden = all.length <= PREVIEW;
  $('trustedMore').textContent = expanded ? t('p.showLess') : t('p.showAll', { n: all.length });
  $('trustedEmpty').hidden = !!all.length;
}

$('trustedSearch').placeholder = t('p.search');
$('trustedSearch').addEventListener('input', () => renderTrusted());
$('trustedMore').addEventListener('click', () => {
  expanded = !expanded;
  if (!expanded) $('trustedSearch').value = '';
  renderTrusted();
  if (expanded && !$('trustedSearch').hidden) $('trustedSearch').focus();
});

// --- Add a trusted site ----------------------------------------------------
// The typed text goes through the same analyzer as the bubble, so the list only
// ever holds the plain ASCII registrable domain (docs.github.com → github.com).
// A look-alike (gіthub.com with a Cyrillic і) is refused: it can never be trusted.
$('addInput').placeholder = t('p.addPlaceholder');

function toDomain(text) {
  let raw = String(text || '').trim();
  if (!raw) return { error: 'p.addInvalid' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw;
  let result = null;
  try { result = ShowYourselfAnalyzer.analyzeLink(raw, '', ''); } catch (e) { result = null; }
  if (!result || !result.host || !result.host.registrableAscii) return { error: 'p.addInvalid' };
  if (result.host.isIP) return { error: 'p.addIP' };
  if (result.severity === 'danger') {
    const f = (result.findings || []).find((x) => x.level === 'danger');
    return { error: 'p.addDanger', why: f ? f.title : '' };
  }
  const domain = result.host.registrableAscii;
  if (!/\./.test(domain)) return { error: 'p.addInvalid' };
  return { domain };
}

function showAddMsg(text) {
  $('addMsg').textContent = text;
  $('addMsg').hidden = !text;
}

function addTrusted(text) {
  const r = toDomain(text);
  if (r.error) return showAddMsg(t(r.error, { why: r.why }));
  store.get('trusted', (data) => {
    const list = data.trusted || [];
    if (list.includes(r.domain)) return showAddMsg(t('p.addExists', { domain: r.domain }));
    store.set({ trusted: list.concat(r.domain).sort() });
    $('addInput').value = '';
    showAddMsg(t('p.added', { domain: r.domain }));
    refreshCurrent();
  });
}

$('addForm').addEventListener('submit', (event) => {
  event.preventDefault();
  addTrusted($('addInput').value);
});

// One-click "add the site I'm on"
let currentDomain = null;
function refreshCurrent() {
  store.get('trusted', (data) => {
    const list = data.trusted || [];
    $('addCurrent').hidden = !currentDomain || list.includes(currentDomain);
    if (currentDomain) $('addCurrent').textContent = t('p.addCurrent', { domain: currentDomain });
  });
}
try {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const url = tabs && tabs[0] && tabs[0].url;
    if (url && /^https?:/i.test(url)) {
      const r = toDomain(url);
      currentDomain = r.domain || null;
    }
    refreshCurrent();
  });
} catch (e) { /* no tabs API (test page) */ }
$('addCurrent').addEventListener('click', () => { if (currentDomain) addTrusted(currentDomain); });

store.get(['stats', 'settings', 'trusted'], (data) => {
  renderStats(data.stats);
  renderTrusted(data.trusted);
  setEnabledUI(!data.settings || data.settings.enabled !== false);
  setBubbleUI((data.settings && data.settings.bubble) || 'all');
  $('blockClicks').checked = !data.settings || data.settings.blockClicks !== false;
});

function saveSetting(patch) {
  store.get('settings', (data) => {
    store.set({ settings: Object.assign({}, data.settings, patch) });
  });
}

function setEnabledUI(on) {
  $('enabled').checked = on;
  $('enabledHelp').textContent = t(on ? 'p.enabledOn' : 'p.enabledOff');
  $('settingsBody').classList.toggle('off', !on);
}

$('enabled').addEventListener('change', (event) => {
  setEnabledUI(event.target.checked);
  saveSetting({ enabled: event.target.checked });
});

function setBubbleUI(mode) {
  document.querySelectorAll('input[name="bubble"]').forEach((r) => { r.checked = r.value === mode; });
  $('bubbleHelp').textContent = t('p.bubbleHelp.' + mode);
}

document.querySelectorAll('input[name="bubble"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    setBubbleUI(radio.value);
    saveSetting({ bubble: radio.value });
  });
});

$('blockClicks').addEventListener('change', (event) => {
  saveSetting({ blockClicks: event.target.checked });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.stats) renderStats(changes.stats.newValue);
  if (changes.trusted) { renderTrusted(changes.trusted.newValue); refreshCurrent(); }
});
