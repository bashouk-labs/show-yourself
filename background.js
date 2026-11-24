/*
 * Show Yourself: background service worker.
 *  - Welcome page on install; content scripts re-injected into open tabs on
 *    install/update so no page needs a reload.
 *  - "OFF" badge mirrors the master switch.
 *  - Right-click an image → decode its QR code locally (jsQR).
 *  - Disguised downloads (invoice.pdf.exe…) are paused behind a warning tab.
 */
// Chrome, Edge and Safari run this file as a service worker. Firefox loads it
// as an event page instead, with these helpers listed before it in its manifest.
if (typeof importScripts === 'function') {
  importScripts('features.js', 'files.js', 'i18n.js', 'lib/jsQR.js');
}

const CONTENT_FILES = ['features.js', 'i18n.js', 'files.js', 'lib/psl.js', 'analyzer.js', 'content.js'];
const QR_MAX_SIDE_PX = 1600;
const QR_MAX_BYTES = 10 * 1024 * 1024;

function isEnabled(settings) {
  return !settings || settings.enabled !== false;
}

// --- Lifecycle --------------------------------------------------------------

function syncBadge() {
  chrome.storage.local.get('settings', ({ settings }) => {
    chrome.action.setBadgeText({ text: isEnabled(settings) ? '' : 'OFF' });
    chrome.action.setBadgeBackgroundColor({ color: '#64748b' });
  });
}

async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*', 'file:///*'] });
  for (const tab of tabs) {
    chrome.scripting
      .executeScript({ target: { tabId: tab.id, allFrames: true }, files: CONTENT_FILES })
      .catch(() => { /* restricted page (Web Store, PDF viewer…) */ });
  }
}

const ignoreError = () => void chrome.runtime.lastError;

// The QR entries exist only while the extension is switched on.
//  - 'sy-qr': on <img>.
//  - 'sy-qr-page': on a canvas or inline SVG, which Chrome does not treat as
//    images. It exists only while the page reports a right-click on one
//    ('sy-qr-target'), and is removed right after.
//    Why not simply hide it: Chrome counts hidden entries too, and with two
//    entries matching a picture it folds them into a submenu (one more click).
//    Its context is 'all': Chrome gives a canvas its own media type, so neither
//    'image' nor 'page' ever matches it.
function syncQrMenu() {
  chrome.contextMenus.removeAll(() => {
    if (!ShowYourselfFeatures.isOn('qrCode')) return;
    chrome.storage.local.get('settings', ({ settings }) => {
      if (!isEnabled(settings)) return;
      const title = ShowYourselfI18n.t('qr.menu');
      chrome.contextMenus.create({ id: 'sy-qr', title, contexts: ['image'] }, ignoreError);
    });
  });
}

// Starter list of very common sites, so everyday browsing stays quiet.
// Only the exact ASCII domain (and its subdomains) matches: a look-alike never
// does, and a red (danger) link is always shown, even on these sites.
// Hosts that serve anyone's pages (github.io, blogspot…) are left out on purpose.
const DEFAULT_TRUSTED = [
  'amazon.com', 'amazon.fr', 'apple.com', 'facebook.com', 'github.com', 'google.com',
  'instagram.com', 'linkedin.com', 'live.com', 'microsoft.com', 'whatsapp.com',
  'wikipedia.org', 'youtube.com'
];

function seedTrusted() {
  try {
    chrome.storage.local.get('trusted', (data) => {
      if (!data || data.trusted === undefined) chrome.storage.local.set({ trusted: DEFAULT_TRUSTED.slice() });
    });
  } catch (e) { /* storage unavailable */ }
}

chrome.runtime.onInstalled.addListener((details) => {
  seedTrusted();
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
  injectIntoOpenTabs();
  syncQrMenu();
  syncBadge();
});

chrome.runtime.onStartup.addListener(() => {
  syncQrMenu();
  syncBadge();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  syncBadge();
  const was = isEnabled(changes.settings.oldValue);
  if (was !== isEnabled(changes.settings.newValue)) syncQrMenu();
});

// --- QR codes ---------------------------------------------------------------

// Nothing is ever downloaded to read a QR code: no request can reach the
// user's local network (router, printer…) on a page's behalf. The page draws
// the picture itself; when it cannot (cross-origin image), the picture is cut
// out of a screenshot of what the user already sees.

/** Decodes an inline image (data: URL), optionally cropped to `spot` (CSS px + device pixel ratio). */
async function decodeQr(dataUrl, spot) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) throw new Error('Not an inline image');
  const blob = await (await fetch(dataUrl)).blob(); // data: URL, decoded locally
  if (!spot && blob.size > QR_MAX_BYTES) throw new Error('Image too large');
  const bitmap = spot
    ? await createImageBitmap(blob, Math.round(spot.x * spot.dpr), Math.round(spot.y * spot.dpr),
      Math.max(1, Math.round(spot.w * spot.dpr)), Math.max(1, Math.round(spot.h * spot.dpr)))
    : await createImageBitmap(blob);
  const scale = Math.min(1, QR_MAX_SIDE_PX / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = new OffscreenCanvas(w, h).getContext('2d');
  ctx.fillStyle = '#fff'; // transparent QR codes need a light background
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
  return code ? code.data : null;
}

/**
 * Asks the page to draw the image itself (same rights as the page, no extra
 * privilege). Replies { png } or, for a picture it cannot read, { spot }: where
 * it sits on screen.
 */
function grabFromPage(tabId, frameId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'sy-qr-grab' }, { frameId }, (reply) => {
      void chrome.runtime.lastError;
      resolve(reply || {});
    });
  });
}

/** A screen area sent by the page: finite numbers in sane ranges only. */
function isValidSpot(s) {
  const ok = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  return !!s && ok(s.x, 0, 20000) && ok(s.y, 0, 20000) && ok(s.w, 1, 20000) && ok(s.h, 1, 20000) && ok(s.dpr, 0.25, 10);
}

/** Screenshot of the visible part of the tab, as a PNG data URL. */
function captureTab(windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
      const err = chrome.runtime.lastError;
      if (err || !dataUrl) reject(new Error(err ? err.message : 'No capture'));
      else resolve(dataUrl);
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if ((info.menuItemId !== 'sy-qr' && info.menuItemId !== 'sy-qr-page') || !tab || tab.id == null) return;
  const frameId = info.frameId || 0;
  const msg = { type: 'sy-qr', text: null, error: false };
  try {
    const reply = await grabFromPage(tab.id, frameId);
    if (typeof reply.png === 'string' && reply.png.startsWith('data:image/png;base64,')) {
      // Only an inline PNG is accepted from the page: never an address to fetch.
      msg.text = await decodeQr(reply.png);
    } else if (frameId === 0 && isValidSpot(reply.spot)) {
      // Cross-origin image the page could not read back: cut it out of the screen.
      const current = await chrome.tabs.get(tab.id);
      if (!current.active) throw new Error('Tab no longer visible');
      msg.text = await decodeQr(await captureTab(tab.windowId), reply.spot);
    } else {
      msg.error = true;
    }
  } catch (e) {
    msg.error = true;
  }
  chrome.tabs.sendMessage(tab.id, msg, { frameId }, () => void chrome.runtime.lastError);
});

// --- Daily counter ----------------------------------------------------------
// Daily buckets { 'YYYY-MM-DD': [spotted, blocked] }, kept 30 days. Every frame
// of every tab reports here and updates run one after another, so no count is lost.

let statsQueue = Promise.resolve();

async function bumpStat(index) {
  const day = new Date().toISOString().slice(0, 10);
  const { stats = {} } = await chrome.storage.local.get('stats');
  stats[day] = stats[day] || [0, 0];
  stats[day][index]++;
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  Object.keys(stats).forEach((d) => { if (d < cutoff) delete stats[d]; });
  await chrome.storage.local.set({ stats });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === 'sy-qr-target') {
    // The image entry never moves. The other one shows only on a drawn QR code, where
    // Chrome sees no image: the two never match the same right-click.
    if (msg.drawn) {
      chrome.contextMenus.create({ id: 'sy-qr-page', title: ShowYourselfI18n.t('qr.menu'), contexts: ['all'] }, ignoreError);
    } else {
      chrome.contextMenus.remove('sy-qr-page', ignoreError);
    }
    return;
  }
  if (msg.type !== 'sy-stat' || (msg.index !== 0 && msg.index !== 1)) return;
  statsQueue = statsQueue.then(() => bumpStat(msg.index)).catch(() => {});
});

// --- Disguised downloads ----------------------------------------------------

function guardDownload(item) {
  if (!ShowYourselfFeatures.isOn('fileGuard') || !item.filename) return;
  const result = ShowYourselfFiles.analyze(item.filename);
  if (!result.danger) return;

  // Pause first, synchronously, so even a tiny file cannot finish before the
  // check. The settings read is async: resume if the extension is switched off.
  chrome.downloads.pause(item.id, () => void chrome.runtime.lastError);
  chrome.storage.local.get('settings', ({ settings }) => {
    if (!isEnabled(settings)) {
      chrome.downloads.resume(item.id, () => void chrome.runtime.lastError);
      return;
    }
    const query = new URLSearchParams({ id: String(item.id), name: result.name });
    chrome.tabs.create({ url: chrome.runtime.getURL('file-warning.html') + '?' + query }, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        // No warning could be shown (no window open…): never leave the download stuck.
        chrome.downloads.resume(item.id, ignoreError);
        return;
      }
      chrome.storage.session.set({ ['fw' + tab.id]: item.id });
    });
  });
}

// Chrome and Edge give the final name before the file is written. Firefox only
// has onCreated, right after the download starts: a tiny file may finish first.
// Safari has no downloads API: attachments and file links are still checked in pages.
if (chrome.downloads) {
  if (chrome.downloads.onDeterminingFilename) {
    chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
      suggest(); // keep the browser's name: we never rename silently
      guardDownload(item);
    });
  } else {
    chrome.downloads.onCreated.addListener(guardDownload);
  }
}

// We warn, we never block: if the warning tab is closed without a choice, the
// download resumes. The tab clears its entry once Keep or Delete is clicked.
// Session storage because the service worker may restart in between.
chrome.tabs.onRemoved.addListener((tabId) => {
  const key = 'fw' + tabId;
  chrome.storage.session.get(key, (data) => {
    const id = data[key];
    if (id == null) return;
    chrome.storage.session.remove(key);
    chrome.downloads.resume(id, () => void chrome.runtime.lastError);
  });
});
