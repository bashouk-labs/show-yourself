/**
 * Unit tests for the QR image URL filter in background.js.
 * Run with: node tests/background.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Load the service worker with inert extension APIs; only pure helpers are tested.
const noop = () => {};
const listener = { addListener: noop };
const sandbox = {
  URL,
  importScripts: noop,
  chrome: {
    runtime: { onInstalled: listener, onStartup: listener },
    storage: { onChanged: listener, local: { get: noop } },
    contextMenus: { onClicked: listener },
    downloads: { onDeterminingFilename: listener },
  },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8'), sandbox);
const { isFetchableImageUrl } = sandbox;

let passed = 0;
let failed = 0;
function check(url, expected) {
  if (isFetchableImageUrl(url) === expected) passed++;
  else { failed++; console.log('  ✗ ' + url + ' → expected ' + expected); }
}

console.log('Show Yourself: background tests\n');

// Public images: allowed
check('https://example.com/qr.png', true);
check('http://cdn.example.org/a/b.jpg', true);
check('https://8.8.8.8/qr.png', true);
check('https://172.32.0.1/qr.png', true);
check('data:image/png;base64,iVBORw0KGgo=', true);

// Local and private networks: refused
check('http://localhost/qr.png', false);
check('http://app.localhost/qr.png', false);
check('http://printer.local/qr.png', false);
check('http://127.0.0.1/qr.png', false);
check('http://2130706433/qr.png', false);   // 127.0.0.1 in decimal
check('http://0x7f.1/qr.png', false);       // 127.0.0.1 in hex
check('http://10.0.0.5/qr.png', false);
check('http://172.16.0.1/qr.png', false);
check('http://172.31.255.255/qr.png', false);
check('http://192.168.1.1/router.png', false);
check('http://169.254.169.254/latest/meta-data', false);
check('http://100.64.0.1/qr.png', false);
check('http://0.0.0.0/qr.png', false);
check('http://[::1]/qr.png', false);
check('http://[fd00::1]/qr.png', false);
check('http://[fe80::1]/qr.png', false);
check('http://[::ffff:127.0.0.1]/qr.png', false);

// Other schemes: refused
check('file:///C:/secret.png', false);
check('chrome://settings', false);
check('blob:https://example.com/123', false);
check('not a url', false);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
