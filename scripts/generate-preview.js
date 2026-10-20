#!/usr/bin/env node
/* ============================================================
   GENERATE PREVIEW — static preview-site generation (MVP)
   ------------------------------------------------------------
   Builds a shareable static preview page from a stored canonical
   PreviewSiteRecord (src/types/preview-site.ts).

   Usage:
     node scripts/generate-preview.js <record.json> [options]

     --out <dir>     output root (default: dist)
     --force         overwrite an existing slug dir

   What it does
     1. Reads + validates the record (slug format, required
        business fields, status gate, template id).
     2. Reads the approved template index.html.
     3. Injects the record verbatim as
        <script id="preview-data" type="application/json"> — the
        page never trusts anything else; js/preview-data-mapper.js
        converts it to the live PREVIEW_DATA shape at load time.
     4. Adds noindex protection (launch-architecture-decisions §2):
        robots + googlebot meta, "noindex,nofollow,noarchive,
        nosnippet".
     5. Rewrites asset URLs (css/, js/) to the shared ../../assets
        copy and copies them once.
     6. Writes dist/previews/{slug}/index.html — deterministic and
        repeatable: same record + template => identical bytes.

   No network access, no AI/API dependencies. Node standard
   library only.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* ---------- constants ---------- */

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NOINDEX_META = '  <meta name="robots" content="noindex,nofollow,noarchive,nosnippet">\n  <meta name="googlebot" content="noindex,nofollow,noarchive,nosnippet">\n';

/* ---------- indexing policy (JUS-60) — single source of truth ---------- */

// The exact directives used in <meta> tags AND the X-Robots-Tag header.
// QA compares against this string verbatim — do not reformat.
const NOINDEX_DIRECTIVES = 'noindex,nofollow,noarchive,nosnippet';

// robots.txt served at the PREVIEW DOMAIN ROOT (never inside per-slug
// dirs, never in production exports). See docs/preview-qa-checklist.md
// for the Disallow:/noindex interaction limitation.
const ROBOTS_TXT_CONTENT = 'User-agent: *\nDisallow: /\n';

// Nginx snippet for the CloudPanel preview vhost (the chosen preview
// host). Included INSIDE the preview server block only — production
// vhosts must never include it. `always` covers 4xx/5xx responses so
// every current AND FUTURE preview route inherits the header.
const NGINX_CONF_CONTENT = [
  '# Preview-domain indexing protection (JUS-60) — GENERATED file, do not edit.',
  '# Regenerate with: node scripts/generate-preview.js <record.json>',
  '#',
  '# Install: add this line INSIDE the preview vhost server block:',
  '#   include <out-root>/_nginx.preview.conf;',
  '# PRODUCTION VHOSTS MUST NEVER INCLUDE THIS FILE — its X-Robots-Tag',
  '# would noindex launched client sites.',
  '',
  '# Header on EVERY response (always: also 4xx/5xx), so every current',
  '# and future preview route inherits protection.',
  'add_header X-Robots-Tag "' + NOINDEX_DIRECTIVES + '" always;',
  '',
  '# Public URL shape: /{slug} and /{slug}/ serve previews/{slug}/index.html',
  '# (matches the backlog route examples; /previews/{slug}/ stays valid too).',
  'location ~ ^/([a-z0-9]+(?:-[a-z0-9]+)*)/?$ {',
  '    try_files /previews/$1/index.html =404;',
  '}',
  ''
].join('\n');

// Statuses allowed to generate a shareable preview. `blocked` records
// are refused (missing/invalid required data); `launched` sites live
// in production, not in the preview tree.
const GENERATABLE_STATUSES = ['needs_review', 'ready', 'purchased'];

// Shared template assets referenced by index.html. Copied once into
// {out}/assets; generated pages reference ../../assets/....
const ASSETS = ['css', 'js'];

/* ---------- helpers ---------- */

function fail(msg) {
  process.stderr.write('generate-preview: ' + msg + '\n');
  process.exit(1);
}

function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    fail('cannot read ' + p + ' (' + e.code + ')');
  }
}

function isBlank(v) {
  return v === undefined || v === null || String(v).trim() === '';
}

/* ---------- validation ---------- */

/**
 * Validate a canonical record. Returns an array of error strings
 * (empty = valid). Pure — exported for unit tests.
 */
function validateRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object') {
    return ['record: not a JSON object'];
  }
  if (isBlank(record.slug)) errors.push('slug: required (durable public identifier)');
  else if (!SLUG_RE.test(record.slug)) errors.push('slug: must be lowercase URL-safe words separated by hyphens (a-z, 0-9, -), got "' + record.slug + '"');
  if (isBlank(record.id)) errors.push('id: required (platform-internal identifier)');

  const biz = record.business || {};
  if (isBlank(biz.name)) errors.push('business.name: required');
  if (isBlank(biz.city)) errors.push('business.city: required');
  if (isBlank(biz.state)) errors.push('business.state: required');
  if (isBlank(biz.trade)) errors.push('business.trade: required');

  if (!record.template || isBlank(record.template.id)) {
    errors.push('template.id: required (approved template reference)');
  }
  if (isBlank(record.status)) {
    errors.push('status: required');
  } else if (GENERATABLE_STATUSES.indexOf(record.status) === -1) {
    errors.push('status: "' + record.status + '" is not generatable (allowed: ' + GENERATABLE_STATUSES.join(', ') + ')');
  }
  return errors;
}

/* ---------- HTML assembly (pure, exported) ---------- */

/**
 * Embed a JSON payload safely inside <script type="application/json">:
 * escape "<" (and the <!-- open-comment sequence) so record content
 * can never terminate the tag or open an HTML comment.
 */
function escapeJsonForScript(json) {
  return String(json)
    .replace(/</g, '\\u003c')
    .replace(/-->/g, '--\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Minimal HTML text escaping for injected title text (&, <, > only —
 * titles are plain text; quotes/attributes are not involved).
 */
function escapeHtmlText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Recursive copy that drops operator-only metadata keys ($comment at
 * ANY depth — top level, images, etc.). These keys document the
 * operator's own records; they never belong inside a shareable
 * artifact (and their prose can name other businesses).
 */
function stripComments(value) {
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(stripComments);
  if (value && typeof value === 'object') {
    const out = {};
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] === '$comment') continue;
      out[keys[i]] = stripComments(value[keys[i]]);
    }
    return out;
  }
  return value;
}

function embeddableRecord(record) {
  return stripComments(record);
}

/**
 * Build the generated page from the template HTML + canonical record.
 * Pure string transforms — deterministic for identical inputs.
 */
function buildPreviewHtml(templateHtml, record) {
  let html = templateHtml;

  // 1. Noindex protection, directly after <meta name="viewport">.
  //    (Idempotent: skip when the template already carries it.)
  if (!/<meta name="robots"/i.test(html)) {
    html = html.replace(
      /(<meta name="viewport"[^>]*>\r?\n)/i,
      '$1' + NOINDEX_META
    );
  }

  // 2. Mark the page as a generated preview (data attr for tests,
  //    keeps template and generated pages distinguishable).
  html = html.replace(/<html lang="en">/, '<html lang="en" data-generated-preview="true">');

  // 2b. Static <title> rewrite. The template ships demo copy in
  //     <title>; the live renderer fills the DOM title at runtime,
  //     but the RAW HTML must already carry THIS record's title
  //     (crawlers/link unfurlers read the static markup, and every
  //     generated page must be free of the template business name).
  if (record.meta && !isBlank(record.meta.title)) {
    html = html.replace(
      /<title[^>]*>[\s\S]*?<\/title>/i,
      '<title>' + escapeHtmlText(record.meta.title) + '</title>'
    );
  }

  // 3. Embed the canonical record verbatim + the mapper bootstrap,
  //    REPLACING the template's static js/preview-data.js tag (which
  //    would otherwise overwrite the mapped data — generated pages
  //    must never carry another business's demo content). The mapper
  //    converts canonical -> live PREVIEW_DATA before preview-render.js
  //    runs; script order is load-bearing. The embedded payload drops
  //    operator-only metadata ($comment) so no other business's name
  //    survives anywhere in the raw HTML.
  const json = escapeJsonForScript(JSON.stringify(embeddableRecord(record), null, 2));
  const dataTag = '<script id="preview-data" type="application/json">' + json + '</' + 'script>\r\n  <script src="js/preview-data-mapper.js"></script>';

  // CR?LF tolerated: the template is edited on Windows (CRLF) but may
  // be normalized (LF) by other tooling; both must keep working.
  html = html.replace(
    /  <script src="js\/preview-data\.js"><\/script>\r?\n/,
    '  ' + dataTag + '\r\n'
  );

  // 4. Asset URLs -> shared ../../assets copy (page lives two levels
  //    deeper: dist/previews/{slug}/index.html vs dist/assets/...).
  html = html.replace(/(href|src)="(css|js)\//g, '$1="../../assets/$2/');

  return html;
}

/* ---------- asset sync ---------- */

function syncAssets(outRoot) {
  const assetsDir = path.join(outRoot, 'assets');
  for (const name of ASSETS) {
    const src = path.join(ROOT, name);
    const dest = path.join(assetsDir, name);
    fs.cpSync(src, dest, { recursive: true });
  }
}

/**
 * Write the preview-domain indexing policy files (JUS-60), ALL at the
 * deployment root (== outRoot; dist/ is served as the preview web
 * root):
 *   robots.txt          — "User-agent: * / Disallow: /"
 *   _nginx.preview.conf — X-Robots-Tag add_header for the preview vhost
 * Both are preview-host artifacts only; a future production export
 * flow must copy page trees WITHOUT them.
 */
function syncPolicyFiles(outRoot) {
  fs.writeFileSync(path.join(outRoot, 'robots.txt'), ROBOTS_TXT_CONTENT, 'utf8');
  fs.writeFileSync(path.join(outRoot, '_nginx.preview.conf'), NGINX_CONF_CONTENT, 'utf8');
}

/* ---------- generation ---------- */

/**
 * Generate a preview page for one record. Writes:
 *   {outRoot}/previews/{slug}/index.html
 *   {outRoot}/assets/...   (shared, synced every run)
 * Returns the output path (or throws on invalid input).
 */
function generatePreview(record, options) {
  options = options || {};
  const errors = validateRecord(record);
  if (errors.length) {
    const err = new Error('invalid record: ' + errors.join('; '));
    err.errors = errors;
    throw err;
  }

  const outRoot = path.resolve(options.outRoot || path.join(ROOT, 'dist'));
  const slugDir = path.join(outRoot, 'previews', record.slug);
  const outFile = path.join(slugDir, 'index.html');

  if (fs.existsSync(outFile) && !options.force) {
    const err = new Error('preview already exists at ' + outFile + ' (use --force to regenerate)');
    err.code = 'EEXIST';
    throw err;
  }

  const templateHtml = readText(path.join(ROOT, 'index.html'));
  const html = buildPreviewHtml(templateHtml, record);

  syncAssets(outRoot);
  syncPolicyFiles(outRoot);
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(outFile, html, 'utf8');

  return outFile;
}

/* ---------- CLI ---------- */

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i];
    else if (a === '--force') args.force = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else args._.push(a);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length === 0) {
    process.stdout.write(
      'usage: node scripts/generate-preview.js <record.json> [--out <dir>] [--force]\n' +
      '  record.json   canonical PreviewSiteRecord (see examples/preview-site.example.json)\n'
    );
    return;
  }

  const recordPath = path.resolve(args._[0]);
  let record;
  try {
    record = JSON.parse(readText(recordPath));
  } catch (e) {
    fail('record is not valid JSON: ' + e.message);
  }

  let outFile;
  try {
    outFile = generatePreview(record, { outRoot: args.out, force: args.force });
  } catch (e) {
    fail(e.message);
  }
  process.stdout.write('generated ' + outFile + '\n');
}

/* ---------- exports (for require()/tests); CLI when run directly ---------- */

module.exports = {
  SLUG_RE: SLUG_RE,
  GENERATABLE_STATUSES: GENERATABLE_STATUSES,
  NOINDEX_DIRECTIVES: NOINDEX_DIRECTIVES,
  ROBOTS_TXT_CONTENT: ROBOTS_TXT_CONTENT,
  NGINX_CONF_CONTENT: NGINX_CONF_CONTENT,
  validateRecord: validateRecord,
  escapeJsonForScript: escapeJsonForScript,
  buildPreviewHtml: buildPreviewHtml,
  generatePreview: generatePreview
};

if (require.main === module) main();
