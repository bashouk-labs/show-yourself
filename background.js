/*
 * Show Yourself: background service worker.
 *  - Welcome page on install; content scripts re-injected into open tabs on
 *    install/update so no page needs a reload.
 *  - "OFF" badge mirrors the master switch.
 *  - Right-click an image → decode its QR code locally (jsQR).
 *  - Disguised downloads (invoice.pdf.exe…) are paused behind a warning tab.
 */
importScripts('features.js', 'files.js', 'i18n.js', 'lib/jsQR.js');

const CONTENT_FILES = ['features.js', 'i18n.js', 'files.js', 'analyzer.js', 'content.js'];
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

function createQrMenu() {
  if (!ShowYourselfFeatures.isOn('qrCode')) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'sy-qr', title: ShowYourselfI18n.t('qr.menu'), contexts: ['image'] });
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
  createQrMenu();
  syncBadge();
});

chrome.runtime.onStartup.addListener(() => {
  createQrMenu();
  syncBadge();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) syncBadge();
});

// --- QR codes ---------------------------------------------------------------

/**
 * True for addresses that must never be fetched on the page's behalf:
 * loopback, private networks, link-local and local-only names.
 */
function isPrivateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (host.includes(':')) {
    return host === '::' || host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith('::ffff:');
  }
  const ip = host.split('.').map(Number);
  if (ip.length !== 4 || ip.some((n) => !Number.isInteger(n))) return false;
  const [a, b] = ip;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Only public http(s) images or inline data: URLs may be fetched. */
function isFetchableImageUrl(src) {
  let url;
  try { url = new URL(src); } catch (e) { return false; }
  if (url.protocol === 'data:') return true;
  return (url.protocol === 'https:' || url.protocol === 'http:') && !isPrivateHost(url.hostname);
}

async function decodeQr(src) {
  // Cookies are never sent: the request must not act on the user's behalf.
  const res = await fetch(src, { credentials: 'omit', redirect: 'error' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const blob = await res.blob();
  if (blob.size > QR_MAX_BYTES) throw new Error('Image too large');
  const bitmap = await createImageBitmap(blob);
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

/** Asks the page to draw the image itself (same rights as the page, no extra privilege). */
function grabFromPage(tabId, frameId) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'sy-qr-grab' }, { frameId }, (reply) => {
      void chrome.runtime.lastError;
      resolve(reply && reply.png);
    });
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'sy-qr' || !tab || tab.id == null) return;
  const frameId = info.frameId || 0;
  const msg = { type: 'sy-qr', text: null, error: false };
  try {
    const png = await grabFromPage(tab.id, frameId);
    if (png) {
      msg.text = await decodeQr(png);
    } else if (isFetchableImageUrl(info.srcUrl)) {
      // Cross-origin image the page could not read back: fetch it anonymously.
      msg.text = await decodeQr(info.srcUrl);
    } else {
      msg.error = true;
    }
  } catch (e) {
    msg.error = true;
  }
  chrome.tabs.sendMessage(tab.id, msg, { frameId }, () => void chrome.runtime.lastError);
});

// --- Disguised downloads ----------------------------------------------------

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  suggest(); // keep Chrome's name: we never rename silently
  if (!ShowYourselfFeatures.isOn('fileGuard')) return;
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
    chrome.tabs.create({ url: chrome.runtime.getURL('file-warning.html') + '?' + query });
  });
});
