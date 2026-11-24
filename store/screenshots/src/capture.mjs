// Renders the Chrome Web Store screenshots (1280x800) from scene.html, in English and French.
// Usage, from the repo root:  node store/screenshots/src/capture.mjs
// Needs Google Chrome (or set CHROME=path/to/chrome) and Node 22+.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// With --post: portrait 1080x1350 images for social posts, in store/social.
const POST = process.argv.includes('--post');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, POST ? 'store/social' : 'store/screenshots');
fs.mkdirSync(OUT, { recursive: true });
// Each shot: scene name, optional view (post only), output file suffix.
const SHOTS = POST
  ? [['ms', 'compact', '1-red-compact'], ['ms', 'full', '2-red-details'], ['shady', 'compact', '3-yellow-compact']]
  : [['link', '', '1-link'], ['sender', '', '2-sender'], ['file', '', '3-file'], ['shady', '', '4-shady-site'], ['safe', '', '5-safe-site']];
const LANGS = ['en', 'fr'];

const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => fs.existsSync(p));
if (!CHROME) throw new Error('Chrome not found: set CHROME=...');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.ttf': 'font/ttf', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sy-shots-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', (d) => { buf += d; const m = buf.match(/ws:\/\/\S+/); if (m) resolve(m[0]); });
  setTimeout(() => reject(new Error('Chrome did not start')), 20000);
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let nextId = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, (m) => (m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result)));
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  for (const lang of LANGS) {
    for (const [scene, view, name] of SHOTS) {
      const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
      await send('Emulation.setDeviceMetricsOverride', POST
        ? { width: 480, height: 600, deviceScaleFactor: 2.25, mobile: false }
        : { width: 800, height: 500, deviceScaleFactor: 1.6, mobile: false }, sessionId);
      await send('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
      await send('Page.enable', {}, sessionId);
      await send('Page.navigate', { url: `${base}/store/screenshots/src/scene.html?scene=${scene}&lang=${lang}${POST ? '&fmt=post&view=' + view : ''}` }, sessionId);
      for (let i = 0; i < 100; i++) {
        const { result } = await send('Runtime.evaluate', { expression: 'document.title' }, sessionId);
        if (result.value === 'READY') break;
        await sleep(100);
      }
      const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
      const out = path.join(OUT, `${lang}-${name}.png`);
      fs.writeFileSync(out, Buffer.from(data, 'base64'));
      console.log('wrote', path.relative(ROOT, out));
      await send('Target.closeTarget', { targetId });
    }
  }
} finally {
  ws.close();
  chrome.kill();
  server.close();
}
