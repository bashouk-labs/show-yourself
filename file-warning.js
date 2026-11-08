'use strict';
/* Show Yourself: disguised-download warning tab: show the name as it looks vs. what it really is. */

const t = (k, p) => ShowYourselfI18n.t('fw.' + k, p);
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

const params = new URLSearchParams(location.search);
const id = Number(params.get('id'));
const r = ShowYourselfFiles.analyze(params.get('name') || '');
const hasApi = typeof chrome !== 'undefined' && chrome.downloads;

document.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });

// What you see: the raw name, rendered by the browser exactly like the OS would (bidi applied).
$('looks').textContent = r.name;

// What it really is: left-to-right, hidden characters shown as yellow tags, real extension in red.
const really = $('really');
const extTail = r.ext ? '.' + r.ext : '';
r.tokens.forEach((tok, i) => {
  if (tok.hidden) return really.appendChild(el('span', 'hid', tok.hidden));
  if (tok.fakeDot) return really.appendChild(el('span', 'fdot', tok.fakeDot));
  let text = tok.ch;
  const last = i === r.tokens.length - 1;
  const tailIdx = last && extTail ? text.toLowerCase().lastIndexOf(extTail) : -1;
  const head = tailIdx >= 0 ? text.slice(0, tailIdx) : text;
  // Make padding visible
  head.split(/(\s{3,}|_{5,}|\.{4,})/).forEach((part, j) => {
    if (!part) return;
    really.appendChild(j % 2 ? el('span', 'pad', part.replace(/ /g, '·')) : document.createTextNode(part));
  });
  if (tailIdx >= 0) really.appendChild(el('span', r.exec ? 'ext' : '', text.slice(tailIdx)));
});

$('kind').textContent = r.exec ? t('kindExec', { ext: r.ext }) : t('kindOther');
r.findings.forEach((f) => $('why').appendChild(el('li', '', t(f.code, f))));

function done(msg) {
  $('status').textContent = msg;
  $('del').disabled = $('keep').disabled = true;
}

$('del').onclick = () => {
  if (!hasApi) return done(t('deleted'));
  chrome.downloads.search({ id }, ([item]) => {
    const erase = () => chrome.downloads.erase({ id }, () => done(t('deleted')));
    if (!item) return done(t('deleted'));
    if (item.state === 'complete') chrome.downloads.removeFile(id, () => { void chrome.runtime.lastError; erase(); });
    else chrome.downloads.cancel(id, erase);
  });
};

$('keep').onclick = () => {
  if (!hasApi) return done(t('kept'));
  chrome.downloads.resume(id, () => { void chrome.runtime.lastError; done(t('kept')); });
};

$('del').focus();
