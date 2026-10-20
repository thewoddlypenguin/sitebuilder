#!/usr/bin/env node
/* ============================================================
   QA PREVIEW GATE — automated pre-outreach check for a
   generated preview site.
   ------------------------------------------------------------
   Run BEFORE sharing a preview with a prospect:

     node scripts/qa-preview.js examples/preview-site.example.json
     node scripts/qa-preview.js <record.json> [--out <dir>] [--shots <dir>]
     node scripts/qa-preview.js <slug>                       # already generated

   What it verifies (each line is one gate check):
     artifact  generation, slug dir, noindex metas (exact directives,
               no duplicates/conflicts), static <title> = record.meta.
               title, embedded JSON parses, shared assets resolve,
               domain-root robots.txt + nginx header config generated,
               no template demo-data script ref
     http      X-Robots-Tag (exact directives) on every response via
               the local host simulator — page in /{slug} and
               /previews/{slug}/ shapes, trailing-slash variant,
               assets, 404s, robots.txt — plus domain-root robots.txt
               content. Same policy files the deployed CloudPanel/
               Nginx vhost loads; deployed-host verification stays a
               manual checklist step.
     desktop   generated marker + renderer ran, identity (banner/
               phone/tel:), hero <em>, section counts match the
               record, honest-copy polarity (sections hidden IFF
               their data is empty — and visible when real data
               exists), no template-business leak in rendered text,
               link validation (tel: digits == record phone, every
               #anchor target exists, no javascript: hrefs), offer
               CTA label matches campaign.offerSnapshot.primaryCta,
               question form prefill + endpoint policy, drawer
               open/close flow, zero runtime errors
     mobile    true 390px viewport (CDP emulation), hamburger nav
               open/close, compact banner copy, single-column
               hero/services/process, launch sheet width, zero
               runtime errors

   Exit code 0 = PASS, 1 = FAIL. Fast (<30s): two headless Edge
   sessions against a local static server of the output tree.

   Reuses scripts/cdp-harness.js (the test/verify.js engine) —
   node stdlib only, no network access beyond localhost.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const vm = require('vm');
const http = require('http');
const H = require('./cdp-harness.js');
const previewServer = require('./preview-server.js');
const G = require('./generate-preview.js');
const evaluate = H.evaluate;
const wait = H.wait;

const ROOT = path.join(__dirname, '..');

/* Browser-visible globals so the shared front-end modules boot in Node. */
global.window = globalThis;
require('../js/preview-data-mapper.js');
require('../js/preview-image-defaults.js');

/* ---------- gate state ---------- */

const results = [];
function check(label, pass, detail) {
  results.push({ label: label, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
  return pass;
}

function failExit(msg) {
  process.stderr.write('qa-preview: ' + msg + '\n');
  process.exit(2);
}

/* ---------- helpers ---------- */

function digits(s) { return String(s || '').replace(/\D+/g, ''); }

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
}

/* The template's static demo business name (leak-sweep needle).
   preview-data.js is a plain `window.PREVIEW_DATA = {...}` literal. */
function templateDemoBusinessName() {
  const code = fs.readFileSync(path.join(ROOT, 'js', 'preview-data.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox);
  return (sandbox.window.PREVIEW_DATA && sandbox.window.PREVIEW_DATA.business &&
    sandbox.window.PREVIEW_DATA.business.name) || 'Cascade Home Remodeling';
}

/* Rendered-text leak sweep: walk visible DOM, skip SCRIPT/STYLE,
   collect text nodes containing the needle. Returns readable hits. */
const LEAK_SWEEP_FN = '(function(needle){' +
  'var hits=[];' +
  'function walk(n){for(var c=n.firstChild;c;c=c.nextSibling){' +
  'if(c.nodeType===1){if(c.tagName==="SCRIPT"||c.tagName==="STYLE")continue;walk(c);}' +
  'else if(c.nodeType===3&&c.nodeValue.indexOf(needle)!==-1){hits.push(c.nodeValue.trim().slice(0,80));}}}' +
  'walk(document.body);return hits;})';

/* Fetch response headers for one URL (Node stdlib). */
function fetchHeaders(url) {
  return new Promise(function (resolve, reject) {
    const req = http.get(url, function (res) {
      res.resume();
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers }); });
    });
    req.on('error', reject);
    req.setTimeout(5000, function () { req.destroy(new Error('header fetch timeout')); });
  });
}

/* ---------- gate: HTTP header + robots.txt checks (local host simulator) ---------- */

async function httpPolicyChecks(slug, httpPort) {
  const base = 'http://127.0.0.1:' + httpPort;
  const D = G.NOINDEX_DIRECTIVES;

  /* The X-Robots-Tag must ride EVERY preview response: the page in
     both public URL shapes, an asset, a 404, and robots.txt itself. */
  const routes = [
    ['/' + slug, 'preview page (/{slug} — backlog public URL shape)'],
    ['/' + slug + '/', 'preview page (/{slug}/ trailing-slash variant)'],
    ['/previews/' + slug + '/', 'preview page (/previews/{slug}/ dist layout)'],
    ['/assets/css/styles.css', 'shared asset (future routes inherit policy)'],
    ['/no-such-route', '404 response (header uses always semantics)'],
    ['/robots.txt', 'robots.txt']
  ];
  for (const r of routes) {
    const got = await fetchHeaders(base + r[0]);
    check('http: X-Robots-Tag on ' + r[1],
      got.status >= 200 && got.status < 500 && got.headers['x-robots-tag'] === D,
      r[0] + ' -> ' + got.status + ' [' + (got.headers['x-robots-tag'] || '(missing)') + ']');
  }

  const robots = await new Promise(function (resolve, reject) {
    http.get(base + '/robots.txt', function (res) {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { body += c; });
      res.on('end', function () { resolve({ status: res.statusCode, body: body, headers: res.headers }); });
    }).on('error', reject);
  });
  check('http: domain-root /robots.txt served (200)',
    robots.status === 200, 'status ' + robots.status);
  check('http: robots.txt disallows all crawlers exactly',
    robots.body === G.ROBOTS_TXT_CONTENT, JSON.stringify(robots.body));
  check('http: robots.txt itself carries X-Robots-Tag',
    robots.headers['x-robots-tag'] === D, robots.headers['x-robots-tag'] || '(missing)');
}

/* ---------- gate: artifact checks (no browser) ---------- */

function artifactChecks(record, outFile, outRoot) {
  const html = fs.readFileSync(outFile, 'utf8');
  const slug = record.slug;

  const D = G.NOINDEX_DIRECTIVES;
  const robotsMetas = html.match(/<meta name="robots"[^>]*>/gi) || [];
  const googleMetas = html.match(/<meta name="googlebot"[^>]*>/gi) || [];
  const otherBotMetas = (html.match(/<meta[^>]+name="(bingbot|yandex|slurp|duckbot)"[^>]*>/gi) || []);
  check('artifact: page exists at previews/' + slug + '/index.html', true, outFile);
  check('artifact: robots meta carries the exact required directives',
    robotsMetas.length === 1 && robotsMetas[0].indexOf('content="' + D + '"') !== -1,
    robotsMetas[0] || '(missing)');
  check('artifact: googlebot meta carries the exact required directives',
    googleMetas.length === 1 && googleMetas[0].indexOf('content="' + D + '"') !== -1,
    googleMetas[0] || '(missing)');
  check('artifact: no duplicate or conflicting indexing metas',
    robotsMetas.length === 1 && googleMetas.length === 1 && otherBotMetas.length === 0,
    otherBotMetas.length ? otherBotMetas.join(' | ') : '');
  check('artifact: static <title> is this record (HTML-escaped rewrite)',
    html.indexOf('<title>' + String(record.meta && record.meta.title || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</title>') !== -1,
    document0Title(html));
  check('artifact: embedded record JSON parses', (function () {
    const m = html.match(/<script id="preview-data" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) return false;
    try { return JSON.parse(m[1].replace(/\\u003c/g, '<')).slug === slug; } catch (e) { return false; }
  })(), 'slug=' + slug);
  check('artifact: template demo-data script not referenced', html.indexOf('js/preview-data.js') === -1, '');
  check('artifact: shared assets resolve from the out tree',
    fs.existsSync(path.join(outRoot, 'assets', 'css', 'styles.css')) &&
    fs.existsSync(path.join(outRoot, 'assets', 'js', 'preview-render.js')) &&
    fs.existsSync(path.join(outRoot, 'assets', 'js', 'preview-data-mapper.js')),
    path.join(outRoot, 'assets'));
  check('artifact: domain-root robots.txt generated (deploy to web root)',
    fs.readFileSync(path.join(outRoot, 'robots.txt'), 'utf8') === G.ROBOTS_TXT_CONTENT,
    'User-agent: * / Disallow: /');
  check('artifact: nginx header config generated (include in PREVIEW vhost only)',
    fs.readFileSync(path.join(outRoot, '_nginx.preview.conf'), 'utf8')
      .indexOf('add_header X-Robots-Tag "' + G.NOINDEX_DIRECTIVES + '" always;') !== -1,
    '_nginx.preview.conf');
  check('artifact: phone link matches record', (function () {
    const want = digits(record.business && record.business.phoneHref || record.business && record.business.phone);
    return want.length >= 7 && html.indexOf('tel:' + want) !== -1;
  })(), 'tel:' + digits(record.business && record.business.phone));
}

function document0Title(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1] : '(none)';
}

/* ---------- gate: desktop session ---------- */

async function desktopChecks(record, runSession, httpPort, demoName) {
  const live = window.PreviewDataMapper.mapRecord(record);
  const phoneWant = digits(record.business.phoneHref || record.business.phone);
  const offerCta = (record.campaign && record.campaign.offerSnapshot && record.campaign.offerSnapshot.primaryCta) || '';

  const sess = await runSession(9321, 1440, 960, false, '/previews/' + record.slug + '/index.html', httpPort);
  try {
    const ws = sess.ws;
    await evaluate(ws, 'window.__errors=[];window.onerror=function(m){window.__errors.push(String(m));};1');

    const d = await evaluate(ws, `(function(){
      var q=function(s){return document.querySelector(s);};
      var qa=function(s){return document.querySelectorAll(s);};
      var sectionHidden=function(s){var el=q(s);return !el||el.hidden;};
      var heroImg=q('.ph--hero img.ph__img');
      return {
        generated: document.documentElement.getAttribute('data-generated-preview'),
        rendered: document.documentElement.getAttribute('data-preview-rendered'),
        robots: (q('meta[name="robots"]')||{}).content||'',
        bannerText: (q('.preview-banner__text--desktop')||{}).textContent||'',
        phone: (q('.site-header__phone span')||{}).textContent||'',
        phoneHref: (q('.site-header__phone')||{}).getAttribute? q('.site-header__phone').getAttribute('href'):'',
        heroEm: !!q('.hero__title em'),
        servicesCount: qa('.service-card').length,
        processCount: qa('.process-step').length,
        communitiesCount: qa('.area-chips li').length,
        claimsHidden: sectionHidden('[data-preview-section="claims"]'),
        projectsHidden: sectionHidden('[data-preview-section="projects"]'),
        reviewsHidden: sectionHidden('[data-preview-section="reviews"]'),
        reviewCount: qa('.review-card').length,
        claimCount: qa('[data-preview-section="claims"] .trust-item').length,
        projectCount: qa('[data-preview-list="projects"] .ph--proj').length,
        learnMoreVisible: qa('.service-card a:not([hidden])').length,
        serviceCardLinks: qa('.service-card a').length,
        stylesApplied: getComputedStyle(q('.top-stack')).position==='sticky' &&
          getComputedStyle(q('.site-header')).backgroundColor!=='rgba(0, 0, 0, 0)'
      };
    })()`);

    const leaks = await evaluate(ws, LEAK_SWEEP_FN + '(' + JSON.stringify(demoName) + ')');
    const links = await evaluate(ws, `(function(){
      var out={tel:[],badAnchor:[],jsHref:[],ext:[]};
      var as=document.querySelectorAll('a[href]');
      for(var i=0;i<as.length;i++){
        var h=as[i].getAttribute('href')||'';
        if(h.indexOf('tel:')===0) out.tel.push(h);
        else if(h.indexOf('javascript:')===0) out.jsHref.push(h);
        else if(h.charAt(0)==='#'&&h.length>1&&!document.querySelector(h)) out.badAnchor.push(h);
        else if(/^https?:/.test(h)) out.ext.push(h);
      }
      var sa=document.querySelector('[data-preview-services-anchor]');
      out.servicesAnchor=sa?sa.getAttribute('href'):'';
      out.servicesAnchorOk=!sa||['#services','#projects','#contact'].indexOf(sa.getAttribute('href'))!==-1;
      return out;
    })()`);

    check('desktop: generated marker + renderer ran', d.generated === 'true' && d.rendered === 'true', '');
    check('desktop: noindex served to the browser', d.robots.indexOf('noindex') !== -1, d.robots);
    check('desktop: template styling applied (assets resolve)', d.stylesApplied, '');
    check('desktop: banner greets this business', d.bannerText.indexOf(record.business.name) !== -1, d.bannerText.trim());
    check('desktop: header phone + tel: link match record',
      d.phone === record.business.phone && digits(d.phoneHref) === phoneWant, d.phone + ' / ' + d.phoneHref);
    check('desktop: hero headline rendered (accent word intact)',
      d.heroEm === ((record.hero && record.hero.headline || '').indexOf('<em>') !== -1), '');
    check('desktop: services render to match record',
      live.services.length === 0 ? d.servicesCount === 0 : d.servicesCount === live.services.length,
      d.servicesCount + ' rendered / ' + live.services.length + ' in record');
    check('desktop: services with detail show Learn more; others hide it', (function () {
      var withDetail = live.services.filter(function (s) { return s.detail; }).length;
      return withDetail === 0 ? d.learnMoreVisible === 0 : d.learnMoreVisible === withDetail;
    })(), d.learnMoreVisible + ' of ' + d.serviceCardLinks + ' card links visible');
    check('desktop: process steps render to match record',
      live.process.length === 0 ? d.processCount === 0 : d.processCount === live.process.length,
      d.processCount + ' / ' + live.process.length);
    check('desktop: service-area chips match record',
      d.communitiesCount === live.serviceArea.communities.length,
      d.communitiesCount + ' / ' + live.serviceArea.communities.length);
    check('desktop: honest-copy — claims section hidden iff no claims',
      d.claimsHidden === (live.claims.length === 0),
      d.claimsHidden ? 'hidden' : 'visible (' + d.claimCount + ' chips)');
    check('desktop: honest-copy — projects section hidden iff no projects',
      d.projectsHidden === (live.projects.length === 0),
      d.projectsHidden ? 'hidden' : 'visible (' + d.projectCount + ' figures, ' + live.projects.length + ' in record)');
    check('desktop: honest-copy — reviews section hidden iff no reviews',
      d.reviewsHidden === (live.reviews.length === 0),
      d.reviewsHidden ? 'hidden' : 'visible (' + d.reviewCount + ' cards)');
    check('desktop: no template-business leak in rendered text', leaks.length === 0,
      leaks.length ? JSON.stringify(leaks.slice(0, 3)) : 'clean');
    check('desktop: no javascript: links', links.jsHref.length === 0, '');
    check('desktop: every #anchor points at a real section', links.badAnchor.length === 0,
      links.badAnchor.length ? links.badAnchor.join(', ') : links.tel.length + ' tel: / ' + links.ext.length + ' external links ok');
    check('desktop: services CTA retargets to a live section', links.servicesAnchorOk, links.servicesAnchor);
    check('desktop: final CTA links the record phone', links.tel.indexOf('tel:' + phoneWant) !== -1, '');

    /* Drawer flow: launch offer -> question view -> close. */
    await evaluate(ws, `document.querySelector('[data-open-drawer="launch"]').click(); new Promise(r=>setTimeout(r,350)).then(()=>1)`);
    const drawer = await evaluate(ws, `(function(){
      var q=function(s){return document.querySelector(s);};
      return {
        open: q('.drawer-root').classList.contains('is-open'),
        launchVisible: !q('[data-drawer-view="launch"]').hidden,
        cta: (q('[data-purchase]')||{}).textContent||''
      };
    })()`);
    check('desktop: drawer opens with launch offer', drawer.open && drawer.launchVisible, '');
    check('desktop: offer CTA matches campaign snapshot', !offerCta || drawer.cta.trim() === offerCta,
      drawer.cta.trim() + (offerCta ? ' (expected: ' + offerCta + ')' : ' (no offer snapshot in record)'));

    await evaluate(ws, `document.querySelector('[data-drawer-view-trigger="question"]').click(); new Promise(r=>setTimeout(r,300)).then(()=>1)`);
    const qform = await evaluate(ws, `(function(){
      var q=function(s){return document.querySelector(s);};
      return {
        visible: !q('[data-drawer-view="question"]').hidden,
        prefill: document.getElementById('question-business').value,
        endpoint: document.getElementById('question-form').getAttribute('data-form-endpoint')
      };
    })()`);
    const wantEndpoint = (record.contact && record.contact.formAction) || '';
    check('desktop: Ask a Question opens with business prefilled',
      qform.visible && qform.prefill === record.business.name, qform.prefill);
    check('desktop: question form endpoint policy (blank until central endpoint)',
      qform.endpoint === wantEndpoint, qform.endpoint || '(blank)');

    await evaluate(ws, `document.querySelector('[data-close-drawer][data-purchase]').click(); new Promise(r=>setTimeout(r,400)).then(()=>1)`);
    const closed = await evaluate(ws, `!document.querySelector('.drawer-root').classList.contains('is-open')`);
    check('desktop: drawer CTA closes the sheet', closed, '');

    const errs = await evaluate(ws, 'window.__errors||[]');
    check('desktop: zero runtime errors', errs.length === 0, errs.length ? JSON.stringify(errs) : '');
  } finally {
    sess.killTree();
  }
}

/* ---------- gate: mobile session (true 390px via CDP) ---------- */

async function mobileChecks(record, runSession, httpPort) {
  const sess = await runSession(9322, 1280, 900, true, '/previews/' + record.slug + '/index.html', httpPort);
  try {
    const ws = sess.ws;
    await evaluate(ws, 'window.__errors=[];window.onerror=function(m){window.__errors.push(String(m));};1');
    const setupId = Math.floor(Math.random() * 1e9);
    ws.send({ id: setupId, method: 'Emulation.setDeviceMetricsOverride', params: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } });
    for (;;) { const m = await ws.next(); if (m.id === setupId) break; }
    await H.wait(400);

    const m = await evaluate(ws, `(function(){
      var q=function(s){return document.querySelector(s);};
      var visible=function(s){var el=q(s);return el&&getComputedStyle(el).display!=='none';};
      var cols=function(s){return getComputedStyle(q(s)).gridTemplateColumns.split(' ').length;};
      return {
        width: document.documentElement.clientWidth,
        hamburger: visible('.nav-toggle'),
        desktopNav: visible('.site-nav'),
        bannerMobile: visible('.preview-banner__text--mobile'),
        launchMobile: visible('.preview-banner__launch-mobile'),
        hero1: cols('.hero__grid')===1,
        services1: cols('.services__grid')===1,
        process1: cols('.process__grid')===1
      };
    })()`);
    check('mobile: true 390px viewport', m.width <= 400, m.width + 'px');
    check('mobile: hamburger shown / desktop nav hidden', m.hamburger && !m.desktopNav, '');
    check('mobile: compact banner copy + Launch button', m.bannerMobile && m.launchMobile, '');

    await evaluate(ws, `document.querySelector('.nav-toggle').click(); new Promise(r=>setTimeout(r,300)).then(()=>1)`);
    const navOpen = await evaluate(ws, `!document.getElementById('mobile-nav').hidden`);
    await evaluate(ws, `document.querySelector('.mobile-nav__link').click(); new Promise(r=>setTimeout(r,500)).then(()=>1)`);
    const navClosed = await evaluate(ws, `document.getElementById('mobile-nav').hidden`);
    check('mobile: hamburger menu opens and closes', navOpen && navClosed, '');

    await evaluate(ws, `document.querySelector('.preview-banner__launch-mobile').click(); new Promise(r=>setTimeout(r,600)).then(()=>1)`);
    const sheet = await evaluate(ws, `(function(){
      var d=document.querySelector('.drawer');
      var r=d.getBoundingClientRect();
      return { w: Math.round(r.width), winW: window.innerWidth };
    })()`);
    check('mobile: launch sheet near full width', sheet.w >= sheet.winW - 4, sheet.w + 'px of ' + sheet.winW);

    const errs = await evaluate(ws, 'window.__errors||[]');
    check('mobile: zero runtime errors', errs.length === 0, errs.length ? JSON.stringify(errs) : '');
  } finally {
    sess.killTree();
  }
}

/* ---------- CLI ---------- */

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--shots') args.shots = argv[++i];
    else args._.push(argv[i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args._.length) failExit('usage: node scripts/qa-preview.js <record.json|slug> [--out <dir>] [--shots <dir>]');

  const outRoot = path.resolve(args.out || path.join(ROOT, 'dist'));
  const first = args._[0];
  const isRecordPath = /\.json$/i.test(first);
  let record = null;
  let slug;

  if (isRecordPath) {
    record = readJson(path.resolve(first));
    if (!record) failExit('record is not valid JSON: ' + first);
    slug = record.slug;
    /* Always regenerate: the gate must test the artifact a prospect
       would receive, not a stale build. Slug dirs are force-safe. */
    const G = require('./generate-preview.js');
    const errors = G.validateRecord(record);
    if (errors.length) failExit('record invalid: ' + errors.join('; '));
    G.generatePreview(record, { outRoot: outRoot, force: true });
  } else {
    slug = first;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) failExit('not a valid slug: ' + slug);
    record = null;
  }

  const outFile = path.join(outRoot, 'previews', slug, 'index.html');
  if (!fs.existsSync(outFile)) failExit('no generated preview at ' + outFile);

  /* Record needed for record-driven checks; recover it from the page. */
  if (!record) {
    const html = fs.readFileSync(outFile, 'utf8');
    const m = html.match(/<script id="preview-data" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) failExit('page has no embedded record JSON');
    record = JSON.parse(m[1].replace(/\\u003c/g, '<'));
  }

  console.log('QA preview gate — ' + slug);
  console.log(new Array(60).join('='));

  artifactChecks(record, outFile, outRoot);

  const server = previewServer.createPreviewServer(outRoot);
  const httpPort = await new Promise(function (resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function () { resolve(server.address().port); });
  });
  const runSession = H.createSessionFactory({
    browserPath: H.resolveBrowserPath(),
    tmpDir: fs.mkdtempSync(path.join(os.tmpdir(), 'qa-preview-')),
    defaultPort: httpPort
  });
  const demoName = templateDemoBusinessName();
  /* When the record IS the template business (the Cascade example),
     the demo name is legitimate content — sweep for template fallback
     text instead. */
  const leakNeedle = demoName === record.business.name ? 'This Business' : demoName;

  try {
    /* HTTP layer first (cheap, no browser): headers + robots.txt via
       the local host simulator — SAME policy files the deployed
       CloudPanel/Nginx vhost loads. Deployed-host verification is a
       separate manual step (docs/preview-qa-checklist.md §2). */
    await httpPolicyChecks(slug, httpPort);
    await desktopChecks(record, runSession, httpPort, leakNeedle);
    await mobileChecks(record, runSession, httpPort);
  } finally {
    server.close();
  }

  /* ---------- report ---------- */

  console.log('');
  const failed = results.filter(function (r) { return !r.pass; });
  for (const r of results) {
    console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.label + (r.detail ? '  — ' + r.detail : ''));
  }
  console.log(new Array(60).join('='));
  console.log('QA: ' + (failed.length ? 'FAIL' : 'PASS') + ' — ' +
    (results.length - failed.length) + '/' + results.length + ' checks' +
    (failed.length ? ' — failed: ' + failed.map(function (r) { return r.label; }).join(' | ') : ''));
  process.exit(failed.length ? 1 : 0);
}

main().catch(function (e) {
  process.stderr.write('qa-preview error: ' + (e && e.message || e) + '\n');
  process.exit(2);
});
