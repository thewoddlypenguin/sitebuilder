#!/usr/bin/env node
/* ============================================================
   PREVIEW SERVER — local preview-domain simulator (JUS-60)
   ------------------------------------------------------------
   Serves the dist/ tree the way the deployed preview host
   (CloudPanel/Nginx) will:

     - public URL shape is /{slug} (backlog route examples),
       also /{slug}/ and /previews/{slug}[/] for convenience
     - X-Robots-Tag: noindex,nofollow,noarchive,nosnippet on
       EVERY response — pages, assets, robots.txt, even 404s —
       mirroring `add_header ... always` in _nginx.preview.conf
     - /robots.txt from the deployment root

   CLI:   node scripts/preview-server.js [--out <dir>] [--port <n>]
   lib:   createPreviewServer(outRoot) -> http.Server (unstarted)

   IMPORTANT: this verifies LOCAL behavior with the SAME policy
   files the real vhost loads. It is not a substitute for
   checking headers on the actual deployed host (curl the live
   domain once after DNS/SSL — see docs/preview-qa-checklist.md §2).
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const H = require('./cdp-harness.js');

const ROOT = path.join(__dirname, '..');
const X_ROBOTS_TAG = 'X-Robots-Tag';

function directives() {
  /* Single source of truth; falls back to the literal if the
     generator module is unavailable. */
  try { return require('./generate-preview.js').NOINDEX_DIRECTIVES; }
  catch (e) { return 'noindex,nofollow,noarchive,nosnippet'; }
}

/* Resolve a URL path to a file inside root (traversal-safe). */
function safeResolve(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const resolved = path.normalize(path.join(root, decoded));
  const rootNorm = path.normalize(root + path.sep);
  if (resolved !== path.normalize(root) && resolved.indexOf(rootNorm) !== 0) return null;
  return resolved;
}

function applyPolicyHeaders(res) {
  res.setHeader(X_ROBOTS_TAG, directives());
  res.setHeader('Referrer-Policy', 'no-referrer');
}

/**
 * Build the preview-domain server for an output tree. Not started —
 * call .listen() yourself (the QA gate picks an ephemeral port).
 */
function createPreviewServer(outRoot) {
  outRoot = path.normalize(outRoot);
  return http.createServer(function (req, res) {
    /* Header policy first: every response from this host carries it,
       including redirects and 404s (nginx `always` semantics). */
    applyPolicyHeaders(res);

    let p = req.url.split('?')[0];
    if (p === '/') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('preview host root: no site list (use /{slug})');
      return;
    }
    if (p === '/robots.txt') {
      const file = safeResolve(outRoot, p);
      if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(fs.readFileSync(file));
      return;
    }

    /* Route candidates, in order:
         /{slug}            -> previews/{slug}/index.html
         /{slug}/           -> previews/{slug}/index.html
         /previews/{slug}[/]-> previews/{slug}/index.html
         anything else      -> static file under outRoot (assets/) */
    const candidates = [];
    const seg = p.replace(/^\/+/, '').replace(/\/+$/, '');
    const mClean = seg.match(/^([a-z0-9]+(?:-[a-z0-9]+)*)$/);
    if (mClean) {
      candidates.push(path.join(outRoot, 'previews', seg, 'index.html'));
    }
    const mPre = seg.match(/^previews\/([a-z0-9]+(?:-[a-z0-9]+)*)$/);
    if (mPre) {
      candidates.push(path.join(outRoot, 'previews', mPre[1], 'index.html'));
    }
    const direct = safeResolve(outRoot, p);
    if (direct) {
      candidates.push(direct);
      if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) {
        candidates.push(path.join(direct, 'index.html'));
      }
    }

    for (let i = 0; i < candidates.length; i++) {
      const file = candidates[i];
      if (file.indexOf(outRoot) === 0 && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { 'Content-Type': H.MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(fs.readFileSync(file));
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
}

/* ---------- CLI ---------- */

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--port') args.port = parseInt(argv[++i], 10);
    else args._.push(argv[i]);
  }
  return args;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const outRoot = path.resolve(args.out || path.join(ROOT, 'dist'));
  const port = args.port || 4173;
  const server = createPreviewServer(outRoot);
  server.listen(port, '127.0.0.1', function () {
    process.stdout.write(
      'preview server: http://127.0.0.1:' + port + '/  (root: ' + outRoot + ')\n' +
      'routes: /{slug} | /{slug}/ | /previews/{slug}[/] | /robots.txt\n' +
      'X-Robots-Tag: ' + directives() + ' (on every response)\n'
    );
  });
}

module.exports = { createPreviewServer: createPreviewServer, X_ROBOTS_TAG: X_ROBOTS_TAG };
