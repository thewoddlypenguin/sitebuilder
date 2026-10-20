// Shared headless-Edge CDP harness for verify.js + qa-preview.js — dep-free (node stdlib only).
//
// Exports:
//   MIME              — file-extension → Content-Type map used by the static server.
//   wait(ms)          — Promise-based sleep.
//   wsConnect(url)    — minimal dep-free WebSocket client (net.Socket + crypto
//                       handshake, message framing, `next()` promise queue);
//                       resolves to { send, next, close }.
//   evaluate(ws, expr) — Runtime.evaluate with returnByValue; resolves to the
//                       unwrapped result value.
//   waitReady(ws, selector, timeoutMs) — polls document.readyState
//                       (interactive|complete) + selector presence. DOM-ready,
//                       not full load: generated previews reference external
//                       images that may hang a pending <img> forever.
//   key(ws, keyName, shift) — dispatches a TRUSTED CDP key event (real Tab
//                       navigation for focus-trap tests; synthetic JS events
//                       don't navigate).
//   killTree(proc)    — taskkill /pid X /T /F on win32 (bare proc.kill()
//                       leaves children), then proc.kill(); all try/catch'd.
//   resolveBrowserPath() — headless Edge/Chrome executable path used for spawns.
//   createStaticServer(root, options) — unstarted http.Server: maps '/' →
//                       options.indexPath (default '/index.html'), optional
//                       options.routes = { path: (req, res) => void } special
//                       endpoints checked before file serving, then serves
//                       files from root with MIME lookup + 404 fallback.
//   createSessionFactory({ browserPath, tmpDir, defaultPort }) — returns
//                       runSession(port, width, height, mobileUA, pagePath,
//                       basePort): spawns headless Edge on a fixed debugging
//                       port (3 spawn retries, per-attempt user-data-dir under
//                       tmpDir, stderr captured — last 6000 chars — into the
//                       thrown error), polls /json/list (100 × 250ms), enables
//                       Page + Runtime, navigates to
//                       http://127.0.0.1:{basePort || defaultPort}{pagePath},
//                       waitReady('.preview-banner', 20000), waits 500ms, and
//                       returns { proc, ws, killTree }.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Headless Edge/Chrome executable path (adjust per machine).
function resolveBrowserPath() {
  return 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png' };

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// Generic static file server. Special endpoints (route handlers) win over
// file serving; '/' is mapped to indexPath first.
function createStaticServer(root, options) {
  const opts = options || {};
  const indexPath = opts.indexPath || '/index.html';
  const routes = opts.routes || {};
  return http.createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/') p = indexPath;
    if (Object.prototype.hasOwnProperty.call(routes, p)) { routes[p](req, res); return; }
    const file = path.join(root, p);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
}

// --- minimal websocket client (no deps) ---
function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(Number(u.port), u.hostname, () => {
      sock.write(
        `GET ${u.pathname}${u.search} HTTP/1.1\r\n` +
        `Host: ${u.host}\r\n` +
        `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    let buf = Buffer.alloc(0);
    let handshaken = false;
    let pendingResolve = null;
    const messages = [];
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshaken) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) return;
        buf = buf.slice(idx + 4);
        handshaken = true;
        resolve({
          send: obj => {
            const payload = Buffer.from(JSON.stringify(obj));
            const mask = crypto.randomBytes(4);
            const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
            let header;
            if (payload.length < 126) header = Buffer.from([0x81, 0x80 | payload.length]);
            else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(payload.length, 2); }
            else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
            sock.write(Buffer.concat([header, mask, masked]));
          },
          next: () => new Promise(r => { if (messages.length) r(messages.shift()); else pendingResolve = r; }),
          close: () => sock.end()
        });
        return;
      }
      // parse frames
      for (;;) {
        if (buf.length < 2) break;
        const len0 = buf[1] & 0x7f;
        let off = 2, len = len0;
        if (len0 === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
        else if (len0 === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) break;
        messages.push(JSON.parse(buf.slice(off, off + len).toString('utf8')));
        buf = buf.slice(off + len);
        if (pendingResolve) { const r = pendingResolve; pendingResolve = null; if (messages.length) r(messages.shift()); }
      }
    });
    sock.on('error', reject);
  });
}

async function evaluate(ws, expr) {
  const id = Math.floor(Math.random() * 1e9);
  ws.send({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } });
  for (;;) {
    const msg = await ws.next();
    if (msg.id === id) return msg.result && msg.result.result ? msg.result.result.value : undefined;
  }
}

// Wait until the page has loaded and the given selector exists. Fixed
// sleeps race against browser startup (a cold Edge start can outlast
// the previous wait, leaving evaluate() on about:blank).
async function waitReady(ws, selector, timeoutMs) {
  // DOM-ready, not full load: generated previews reference external
  // images that may hang in a sandboxed network, and a pending <img>
  // keeps readyState at 'interactive' forever. All page scripts are
  // parser-inserted, so they have finished by 'interactive'.
  const deadline = Date.now() + (timeoutMs || 15000);
  for (;;) {
    const readyNow = await evaluate(ws, `(function(){ return (document.readyState === 'interactive' || document.readyState === 'complete') && !!document.querySelector(${JSON.stringify(selector)}); })()`);
    if (readyNow === true) return;
    if (Date.now() > deadline) throw new Error('page not ready: ' + selector);
    await wait(200);
  }
}

// Dispatch a TRUSTED key event via CDP. Synthetic KeyboardEvents from JS
// don't perform native Tab navigation, so focus-trap tests must use this.
async function key(ws, keyName, shift) {
  const base = {
    key: keyName, code: 'Tab',
    windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9,
    modifiers: shift ? 8 : 0
  };
  const down = Math.floor(Math.random() * 1e9);
  ws.send({ id: down, method: 'Input.dispatchKeyEvent', params: Object.assign({ type: 'keyDown' }, base) });
  for (;;) { const m = await ws.next(); if (m.id === down) break; }
  const up = Math.floor(Math.random() * 1e9);
  ws.send({ id: up, method: 'Input.dispatchKeyEvent', params: Object.assign({ type: 'keyUp' }, base) });
  for (;;) { const m = await ws.next(); if (m.id === up) break; }
}

function killTree(proc) {
  if (!proc) return;
  try {
    if (process.platform === 'win32' && proc.pid) {
      require('child_process').execSync('taskkill /pid ' + proc.pid + ' /T /F', { stdio: 'ignore', timeout: 10000 });
    }
    proc.kill();
  } catch (e) { /* already gone */ }
}

// Fixed debugging ports per session. Robust against slow/failed browser
// startup (long sequential runs): stderr is drained + captured for
// diagnostics, the poll window is 25s, and a failed launch is retried
// twice before giving up.
//
// basePort: HTTP origin to load pages from (defaults to defaultPort, the
// main template server). The generated-preview phase passes its own dist-
// rooted server port so pages are served with dist/ as the web root,
// matching real hosting. `mobileUA` is accepted for signature compat and
// unused (mobile emulation is done via CDP device-metrics overrides).
function createSessionFactory(options) {
  const browserPath = options.browserPath || resolveBrowserPath();
  const tmpDir = options.tmpDir;
  const defaultPort = options.defaultPort;
  return async function runSession(port, width, height, mobileUA, pagePath, basePort) {
    const httpPort = basePort || defaultPort;
    let lastStderr = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      const args = [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--user-data-dir=' + path.join(tmpDir, 'p' + port + (attempt ? '-r' + attempt : '')),
        '--remote-debugging-port=' + port,
        '--window-size=' + width + ',' + height,
        'about:blank'
      ];
      const proc = spawn(browserPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      lastStderr = '';
      proc.stderr.on('data', d => { lastStderr += d.toString(); if (lastStderr.length > 6000) lastStderr = lastStderr.slice(-6000); });
      let wsUrl = null;
      for (let i = 0; i < 100 && !wsUrl; i++) {
        await wait(250);
        try {
          const res = await fetch('http://127.0.0.1:' + port + '/json/list');
          const tabs = await res.json();
          const page = tabs.find(t => t.type === 'page');
          if (page) wsUrl = page.webSocketDebuggerUrl;
        } catch (e) { /* not ready yet */ }
      }
      if (wsUrl) {
        const ws = await wsConnect(wsUrl);
        ws.send({ id: 1, method: 'Page.enable' });
        ws.send({ id: 2, method: 'Runtime.enable' });
        await evaluate(ws, `location.href = 'http://127.0.0.1:${httpPort}${pagePath || '/index.html'}'`);
        await waitReady(ws, '.preview-banner', 20000);
        await wait(500);
        return { proc, ws, killTree: () => killTree(proc) };
      }
      // Launch failed: free the port/user-data-dir and retry.
      killTree(proc);
      await wait(3000);
    }
    throw new Error('browser did not expose DevTools on ' + port + ' (stderr: ' + JSON.stringify(lastStderr.slice(-400)) + ')');
  };
}

module.exports = {
  MIME,
  wait,
  wsConnect,
  evaluate,
  waitReady,
  key,
  killTree,
  resolveBrowserPath,
  createStaticServer,
  createSessionFactory
};
