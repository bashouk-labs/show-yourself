/*
 * Builds one store package per browser family, from the same sources.
 * Run from the repo root: node tools/build.js
 *
 *   store/show-yourself-<v>-chrome.zip   Chrome Web Store, Microsoft Edge Add-ons, Opera
 *   store/show-yourself-<v>-firefox.zip  addons.mozilla.org
 *   store/show-yourself-<v>-safari.zip   to unzip on a Mac, then Xcode (see store/PUBLIER.md)
 *
 * Only the manifest differs. No dependency: the zip writer below uses Node's zlib.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'store');

// What ships. Everything else (tests, tools, docs, store, test.html…) stays out.
const INCLUDE = [
  'LICENSE', '_locales', 'fonts', 'icons', 'lib',
  'analyzer.js', 'background.js', 'content.js', 'features.js', 'files.js', 'i18n.js',
  'file-warning.css', 'file-warning.html', 'file-warning.js',
  'popup.css', 'popup.html', 'popup.js',
  'welcome.css', 'welcome.html', 'welcome.js',
];

// Firefox has no extension service worker: the background runs as an event page,
// loading the helpers that background.js imports itself elsewhere.
const FIREFOX_BACKGROUND = ['features.js', 'files.js', 'i18n.js', 'lib/jsQR.js', 'background.js'];
const GECKO_ID = 'showyourself@bashouk.com'; // permanent once published on AMO

const TARGETS = {
  chrome: (m) => m,
  firefox: (m) => {
    m.background = { scripts: FIREFOX_BACKGROUND };
    // Firefox already gives each install a random extension URL.
    for (const r of m.web_accessible_resources) delete r.use_dynamic_url;
    m.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        strict_min_version: '140.0',
        data_collection_permissions: { required: ['none'] },
      },
    };
    return m;
  },
  safari: (m) => {
    // Safari has no downloads API (background.js checks for it).
    m.permissions = m.permissions.filter((p) => p !== 'downloads');
    for (const r of m.web_accessible_resources) delete r.use_dynamic_url;
    return m;
  },
};

function listFiles(rel) {
  const abs = path.join(ROOT, rel);
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs).sort().flatMap((name) => listFiles(path.posix.join(rel, name)));
}

// --- Minimal zip writer (deflate, forward slashes, as the stores require) ----

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function zip(entries) {
  const { time, date } = dosDateTime(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0x0800, 6);      // UTF-8 names
    local.writeUInt16LE(8, 8);           // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);        // made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

// --- Build -------------------------------------------------------------------

const manifestSrc = fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8');
const version = JSON.parse(manifestSrc).version;
const files = INCLUDE.flatMap(listFiles);
const only = process.argv.slice(2);

for (const [target, adapt] of Object.entries(TARGETS)) {
  if (only.length && !only.includes(target)) continue;
  const manifest = adapt(JSON.parse(manifestSrc));
  const entries = files.map((name) => ({ name, data: fs.readFileSync(path.join(ROOT, name)) }));
  entries.push({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2) + '\n') });
  const out = path.join(OUT, `show-yourself-${version}-${target}.zip`);
  fs.writeFileSync(out, zip(entries));
  console.log(`${target.padEnd(8)} ${path.relative(ROOT, out)}  (${entries.length} files)`);
}
