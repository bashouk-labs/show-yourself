/**
 * Unit tests for the QR code helpers in background.js: no network address is
 * ever fetched, and screen areas sent by pages are checked.
 * Run with: node tests/background.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load the service worker with inert extension APIs; only pure helpers are tested.
const noop = () => {};
const listener = { addListener: noop };
const fetched = [];
const sandbox = {
  URL,
  importScripts: noop,
  // Records every fetch: only data: URLs may ever reach it.
  fetch: (url) => { fetched.push(String(url)); return Promise.reject(new Error('stub')); },
  chrome: {
    runtime: { onInstalled: listener, onStartup: listener, onMessage: listener },
    storage: { onChanged: listener, local: { get: noop } },
    contextMenus: { onClicked: listener },
    downloads: { onDeterminingFilename: listener },
    tabs: { onRemoved: listener },
  },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), sandbox);
const { isValidSpot, decodeQr } = sandbox;

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) passed++;
  else { failed++; console.log('  ✗ ' + name); }
}

(async () => {
  console.log('Show Yourself: background tests\n');

  // Screen areas: sane numbers only
  check('spot: normal', isValidSpot({ x: 0, y: 40, w: 600, h: 340, dpr: 2 }));
  check('spot: missing', !isValidSpot(null) && !isValidSpot(undefined) && !isValidSpot({}));
  check('spot: negative x', !isValidSpot({ x: -5, y: 0, w: 10, h: 10, dpr: 1 }));
  check('spot: zero width', !isValidSpot({ x: 0, y: 0, w: 0, h: 10, dpr: 1 }));
  check('spot: NaN', !isValidSpot({ x: NaN, y: 0, w: 10, h: 10, dpr: 1 }));
  check('spot: Infinity', !isValidSpot({ x: 0, y: 0, w: Infinity, h: 10, dpr: 1 }));
  check('spot: string numbers', !isValidSpot({ x: '0', y: '0', w: '10', h: '10', dpr: '1' }));
  check('spot: absurd pixel ratio', !isValidSpot({ x: 0, y: 0, w: 10, h: 10, dpr: 500 }));
  check('spot: huge area', !isValidSpot({ x: 0, y: 0, w: 99999, h: 10, dpr: 1 }));

  // Only inline images are decoded: network addresses are refused before any fetch
  const refused = ['https://example.com/qr.png', 'http://192.168.1.1/router.png', 'http://localhost/qr.png',
    'http://169.254.169.254/latest/meta-data', 'file:///C:/secret.png', 'blob:https://example.com/123',
    'data:text/html,<b>x</b>', 'not a url', null, 42];
  for (const src of refused) {
    let threw = false;
    try { await decodeQr(src); } catch (e) { threw = true; }
    check('refused without fetching: ' + src, threw);
  }
  check('no network address was ever fetched', fetched.length === 0);

  // An inline image does go through (decoded locally)
  try { await decodeQr('data:image/png;base64,iVBORw0KGgo='); } catch (e) { /* stub fetch */ }
  check('inline image accepted', fetched.length === 1 && fetched[0].startsWith('data:image/png'));

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exitCode = failed ? 1 : 0;
})();
