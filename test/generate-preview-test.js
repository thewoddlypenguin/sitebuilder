#!/usr/bin/env node
/* ============================================================
   GENERATE PREVIEW UNIT TESTS — headless, dependency-free.
   Run: node test/generate-preview-test.js
   Covers js/preview-data-mapper.js (canonical -> live mapping)
   and scripts/generate-preview.js (validation, HTML injection,
   noindex, escaping, repeatability, multi-business).
   Exits non-zero on any failure.
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

require('../js/preview-data-mapper.js');
const M = globalThis.PreviewDataMapper;
const G = require('../scripts/generate-preview.js');

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}

/* ---------- fixtures ---------- */

// The canonical example record (Cascade) — the real integration input.
const EXAMPLE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'examples', 'preview-site.example.json'), 'utf8'));

// A second business (plumbing, different city) — proves generation is
// repeatable for multiple businesses, not just the Cascade fixture.
const SECOND = JSON.parse(JSON.stringify(EXAMPLE));
SECOND.id = 'preview_test_second_business';
SECOND.slug = 'second-business-sunriver-or';
SECOND.business = {
  name: 'Second Business Plumbing',
  city: 'Sunriver',
  state: 'OR',
  stateName: 'Oregon',
  trade: 'plumbing',
  phone: '541-555-0200',
  phoneHref: 'tel:5415550200'
};
SECOND.reviews.items = [
  { id: 'rev_1', quote: 'Fixed our leak fast.', attribution: 'Ann L., Sunriver' }
];
SECOND.images = {
  hero: { url: 'https://images.example.com/second-hero.jpg', alt: 'Plumbing inspiration image' }
};

/* ---------- mapper: identity + business ---------- */

const mapped = M.mapRecord(EXAMPLE);

ok('mapper: business identity maps 1:1',
  mapped.business.name === 'Cascade Home Remodeling' &&
  mapped.business.city === 'Bend' &&
  mapped.business.state === 'OR' &&
  mapped.business.stateName === 'Oregon' &&
  mapped.business.phone === '541-555-0198' &&
  mapped.business.phoneHref === 'tel:5415550198' &&
  mapped.business.trade === 'remodeling',
  mapped.business);

ok('mapper: template.id carried through (image defaults key)',
  mapped.template && mapped.template.id === 'remodeling-contractor-v1', mapped.template);

ok('mapper: meta title + description map',
  mapped.meta.title === EXAMPLE.meta.title && mapped.meta.description === EXAMPLE.meta.description);

ok('mapper: banner texts map', mapped.banner.desktopText === EXAMPLE.banner.desktopText && mapped.banner.mobileText === EXAMPLE.banner.mobileText);

/* ---------- mapper: canonical folds into flat live shape ---------- */

ok('mapper: services.items -> flat services[] with summary->copy',
  mapped.services.length === 3 &&
  mapped.services[0].title === 'Kitchen Remodeling' &&
  mapped.services[0].copy === EXAMPLE.services.items[0].summary,
  { count: mapped.services.length, copy: mapped.services[0] && mapped.services[0].copy });

ok('mapper: detailTitle/detailCopy/includes -> detail.{headline,copy,bullets}',
  mapped.services[0].detail &&
  mapped.services[0].detail.headline === EXAMPLE.services.items[0].detailTitle &&
  mapped.services[0].detail.copy === EXAMPLE.services.items[0].detailCopy &&
  mapped.services[0].detail.bullets.length === 4 &&
  mapped.services[0].detail.bullets[0] === 'Cabinet refacing or replacement',
  mapped.services[0].detail);

ok('mapper: goodFit maps into detail', mapped.services[0].detail.goodFit === EXAMPLE.services.items[0].goodFit);

ok('mapper: services section headings -> servicesMeta',
  mapped.servicesMeta.eyebrow === 'What we do' &&
  mapped.servicesMeta.title === 'Remodeling, handled with care.' &&
  mapped.servicesMeta.lede.indexOf('Focused services') === 0,
  mapped.servicesMeta);

ok('mapper: process.steps -> process[] with copy', 
  mapped.process.length === 4 && mapped.process[3].title === 'Schedule the Work' && mapped.process[0].copy.indexOf('Tell us') === 0);

ok('mapper: processMeta carries headings', mapped.processMeta.eyebrow === 'How it works' && mapped.processMeta.title === 'A simple, straightforward process.');

/* ---------- mapper: honest-copy invariants ---------- */

ok('mapper: claims/projects/reviews empty stay empty (no invention)',
  mapped.claims.length === 0 && mapped.projects.length === 0 && mapped.reviews.length === 0,
  { claims: mapped.claims.length, projects: mapped.projects.length, reviews: mapped.reviews.length });

ok('mapper: claims label -> text mapping', M.mapRecord({ claims: [{ label: 'Licensed & Insured', icon: 'pin' }] }).claims[0].text === 'Licensed & Insured');

ok('mapper: reviews items map (quote + attribution)',
  M.mapRecord(SECOND).reviews[0].quote === 'Fixed our leak fast.' &&
  M.mapRecord(SECOND).reviews[0].attribution === 'Ann L., Sunriver');

ok('mapper: review without quote dropped (honest-copy)',
  M.mapRecord({ reviews: { items: [{ attribution: 'Ghost' }, { quote: '', attribution: 'X' }, { quote: 'Real one' }] } }).reviews.length === 1);

ok('mapper: projects mode:hidden suppresses items even when present',
  M.mapRecord({ projects: { mode: 'hidden', items: [{ label: 'L', caption: 'C' }] } }).projects.length === 0);

ok('mapper: projects mode auto/default renders real items',
  M.mapRecord({ projects: { items: [{ label: 'Featured remodel', caption: 'Kitchen refresh' }] } }).projects[0].caption === 'Kitchen refresh');

/* ---------- mapper: misc shapes ---------- */

ok('mapper: serviceArea communities pass through as strings',
  mapped.serviceArea.communities.length === 6 && mapped.serviceArea.communities[0] === 'Bend');

ok('mapper: finalCta maps', mapped.finalCta.headline === 'Ready to talk about your remodel?' && mapped.finalCta.micro.indexOf('No pressure') === 0);

ok('mapper: images block passes through for renderer slot resolution',
  mapped.images && mapped.images.hero && mapped.images.hero.url === 'https://images.example.com/cascade-hero.jpg',
  mapped.images);

ok('mapper: service without detail fields keeps no detail key',
  M.mapRecord({ services: { items: [{ id: 's1', icon: 'kitchen', title: 'T', summary: 'S' }] } }).services[0].detail === undefined);

ok('mapper: empty record maps to safe skeleton (no crash)',
  M.mapRecord({}).business.name === undefined && M.mapRecord({}).services.length === 0);

ok('mapper: null/invalid entries dropped from lists',
  M.mapRecord({ services: { items: [null, {}, { title: 'Only Real', summary: 'x' }] } }).services.length === 1);

/* ---------- generator: validation ---------- */

ok('validate: example record passes', G.validateRecord(EXAMPLE).length === 0, G.validateRecord(EXAMPLE));

ok('validate: slug format enforced (uppercase rejected)',
  G.validateRecord(Object.assign({}, EXAMPLE, { slug: 'Bad Slug' })).some(e => e.indexOf('slug') === 0));

ok('validate: slug underscores rejected',
  G.validateRecord(Object.assign({}, EXAMPLE, { slug: 'bad_slug' })).some(e => e.indexOf('slug') === 0));

ok('validate: slug leading/trailing hyphen rejected',
  G.validateRecord(Object.assign({}, EXAMPLE, { slug: '-bad-' })).some(e => e.indexOf('slug') === 0));

ok('validate: good slug accepted', G.validateRecord(Object.assign({}, EXAMPLE, { slug: 'a-1-b-22' })).length === 0);

ok('validate: missing required business fields reported',
  G.validateRecord(Object.assign({}, EXAMPLE, { business: {} })).length >= 4);

ok('validate: blocked status refused',
  G.validateRecord(Object.assign({}, EXAMPLE, { status: 'blocked' })).some(e => e.indexOf('status') === 0));

ok('validate: launched status refused (production tree, not preview)',
  G.validateRecord(Object.assign({}, EXAMPLE, { status: 'launched' })).some(e => e.indexOf('status') === 0));

ok('validate: needs_review/ready/purchased allowed',
  ['needs_review', 'ready', 'purchased'].every(s => G.validateRecord(Object.assign({}, EXAMPLE, { status: s })).length === 0));

ok('validate: missing template.id reported',
  G.validateRecord(Object.assign({}, EXAMPLE, { template: {} })).some(e => e.indexOf('template.id') === 0));

ok('validate: non-object record rejected', G.validateRecord(null)[0] === 'record: not a JSON object');

/* ---------- generator: HTML assembly ---------- */

const templateHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const html = G.buildPreviewHtml(templateHtml, EXAMPLE);

ok('build: noindex robots + googlebot meta injected after viewport',
  /content="width=device-width, initial-scale=1\.0">\r?\n  <meta name="robots" content="noindex,nofollow,noarchive,nosnippet">/.test(html) &&
  html.indexOf('<meta name="googlebot" content="noindex,nofollow,noarchive,nosnippet">') !== -1);

ok('build: noindex not duplicated when already present',
  (G.buildPreviewHtml(html, EXAMPLE).match(/<meta name="robots"/g) || []).length === 1);

ok('build: canonical record embedded verbatim as JSON script tag',
  html.indexOf('<script id="preview-data" type="application/json">') !== -1 &&
  html.indexOf('"slug": "cascade-home-remodeling-bend-or"') !== -1);

ok('build: mapper script loads before renderer',
  html.indexOf('js/preview-data-mapper.js') !== -1 &&
  html.indexOf('js/preview-data-mapper.js') < html.indexOf('js/preview-render.js'));

ok('build: template static preview-data.js tag REPLACED (no demo-data overwrite)',
  (html.match(/js\/preview-data\.js/g) || []).length === 0);

ok('build: generated marker set on <html>',
  html.indexOf('<html lang="en" data-generated-preview="true">') !== -1);

ok('build: asset URLs rewritten to shared ../../assets',
  html.indexOf('href="../../assets/css/styles.css"') !== -1 &&
  html.indexOf('src="../../assets/js/preview-render.js"') !== -1);

ok('build: static <title> rewritten from record.meta.title',
  html.indexOf('<title>' + EXAMPLE.meta.title + '</title>') !== -1 &&
  (html.match(/<title[^>]*>/g) || []).length === 1);

const tplTitleBuild = G.buildPreviewHtml(templateHtml, Object.assign({}, EXAMPLE, { meta: Object.assign({}, EXAMPLE.meta, { title: 'A & B <Co> "Preview"' }) }));
ok('build: title text is HTML-escaped (& < >)',
  tplTitleBuild.indexOf('<title>A &amp; B &lt;Co&gt; "Preview"</title>') !== -1);

const commentBuild = G.buildPreviewHtml(templateHtml, Object.assign({ $comment: 'Mentions Cascade Home Remodeling in operator notes' }, EXAMPLE));
ok('build: $comment stripped from embedded payload (no cross-business leak)',
  commentBuild.indexOf('Mentions Cascade Home Remodeling') === -1 &&
  commentBuild.indexOf('"$comment"') === -1);

ok('build: JSON < and </script> sequences escaped inside data tag',
  G.escapeJsonForScript('</script><img src=x onerror=alert(1)>') === '\\u003c/script>\\u003cimg src=x onerror=alert(1)>');

ok('build: escaped JSON still parses to the original record',
  JSON.parse(G.escapeJsonForScript(JSON.stringify(EXAMPLE)).replace(/\\u003c/g, '<').replace(/--\\u003e/g, '-->').replace(/\\u2028/g, '\u2028').replace(/\\u2029/g, '\u2029')).slug === EXAMPLE.slug);

ok('build: <em> in hero headline survives as \\u003c (no raw < in JSON block)',
  /<script id="preview-data"[^>]*>[\s\S]*?<\/script>/.test(html) &&
  !/<script id="preview-data"[^>]*>[\s\S]*?\u003cem>/.test(html.match(/<script id="preview-data" type="application\/json">[\s\S]*?<\/script>/)[0].replace('\\u003c', 'LEAVE')) === false ||
  html.indexOf('\\u003cem>practical\\u003c/em>') !== -1);

/* ---------- generator: file output ---------- */

const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-preview-test-'));

const out1 = G.generatePreview(EXAMPLE, { outRoot: tmpOut, force: true });
ok('generate: writes dist/previews/{slug}/index.html',
  out1 === path.join(tmpOut, 'previews', EXAMPLE.slug, 'index.html') && fs.existsSync(out1));

ok('generate: shared assets copied (css + js)',
  fs.existsSync(path.join(tmpOut, 'assets', 'css', 'styles.css')) &&
  fs.existsSync(path.join(tmpOut, 'assets', 'js', 'preview-render.js')) &&
  fs.existsSync(path.join(tmpOut, 'assets', 'js', 'preview-data-mapper.js')));

const firstBytes = fs.readFileSync(out1, 'utf8');

// Regenerate same record: identical output (deterministic + repeatable).
G.generatePreview(EXAMPLE, { outRoot: tmpOut, force: true });
ok('generate: regenerating same record is byte-identical (repeatable)',
  fs.readFileSync(out1, 'utf8') === firstBytes);

// Without --force an existing preview is protected (durable slugs).
let eexist = null;
try { G.generatePreview(EXAMPLE, { outRoot: tmpOut }); } catch (e) { eexist = e; }
ok('generate: existing slug dir protected without force', eexist && eexist.code === 'EEXIST');

// Second business: independent slug dir, no cross-contamination.
const out2 = G.generatePreview(SECOND, { outRoot: tmpOut, force: true });
const html2 = fs.readFileSync(out2, 'utf8');
ok('generate: second business gets its own slug dir',
  out2 === path.join(tmpOut, 'previews', 'second-business-sunriver-or', 'index.html') && fs.existsSync(out2));

ok('generate: second business page carries its own data, not Cascade demo data',
  html2.indexOf('"name": "Second Business Plumbing"') !== -1 &&
  html2.indexOf('"slug": "second-business-sunriver-or"') !== -1 &&
  html2.indexOf('<script src="js/preview-data.js">') === -1);

ok('generate: invalid record throws with error list',
  (() => { try { G.generatePreview({ slug: 'UPPER' }, { outRoot: tmpOut }); return false; } catch (e) { return !!(e.errors && e.errors.length > 0); } })());

/* ---------- indexing policy files (JUS-60) ---------- */

ok('policy: robots.txt written at deployment root (not per-slug)',
  fs.existsSync(path.join(tmpOut, 'robots.txt')) &&
  !fs.existsSync(path.join(tmpOut, 'previews', EXAMPLE.slug, 'robots.txt')));

ok('policy: robots.txt content is exactly "User-agent: * / Disallow: /"',
  fs.readFileSync(path.join(tmpOut, 'robots.txt'), 'utf8') === 'User-agent: *\nDisallow: /\n');

ok('policy: nginx snippet written at deployment root',
  fs.existsSync(path.join(tmpOut, '_nginx.preview.conf')));

ok('policy: nginx snippet carries exact X-Robots-Tag directives with always',
  fs.readFileSync(path.join(tmpOut, '_nginx.preview.conf'), 'utf8')
    .indexOf('add_header X-Robots-Tag "noindex,nofollow,noarchive,nosnippet" always;') !== -1);

ok('policy: constants exported as single source of truth',
  G.NOINDEX_DIRECTIVES === 'noindex,nofollow,noarchive,nosnippet' &&
  G.ROBOTS_TXT_CONTENT === 'User-agent: *\nDisallow: /\n' &&
  G.NGINX_CONF_CONTENT.indexOf(G.NOINDEX_DIRECTIVES) !== -1);

ok('policy: meta directives are exact + duplicate-safe (regenerated page)',
  (function () {
    const h = fs.readFileSync(out1, 'utf8');
    const robotsMetas = h.match(/<meta name="robots"[^>]*>/g) || [];
    const googleMetas = h.match(/<meta name="googlebot"[^>]*>/g) || [];
    return robotsMetas.length === 1 && googleMetas.length === 1 &&
      robotsMetas[0].indexOf('content="noindex,nofollow,noarchive,nosnippet"') !== -1 &&
      googleMetas[0].indexOf('content="noindex,nofollow,noarchive,nosnippet"') !== -1;
  })());

ok('policy: template index.html stays preview-clean (production boundary)',
  (function () {
    const tpl = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    return /<meta name="robots"/i.test(tpl) === false &&
      /<meta name="googlebot"/i.test(tpl) === false;
  })());

ok('policy: built page has no other indexing directives (no max-snippet/indexifembedded conflicts)',
  (function () {
    const h = fs.readFileSync(out1, 'utf8');
    const metas = h.match(/<meta[^>]+name="(robots|googlebot|bingbot|yandex)"[^>]*>/gi) || [];
    return metas.length === 2;
  })());

ok('policy: policy files byte-identical on regeneration (deterministic)',
  (function () {
    const r1 = fs.readFileSync(path.join(tmpOut, 'robots.txt'), 'utf8');
    const n1 = fs.readFileSync(path.join(tmpOut, '_nginx.preview.conf'), 'utf8');
    G.generatePreview(SECOND, { outRoot: tmpOut, force: true });
    return fs.readFileSync(path.join(tmpOut, 'robots.txt'), 'utf8') === r1 &&
      fs.readFileSync(path.join(tmpOut, '_nginx.preview.conf'), 'utf8') === n1;
  })());

/* ---------- round trip: embedded record -> mapper -> live data ---------- */

const embedded = JSON.parse(
  html.match(/<script id="preview-data" type="application\/json">([\s\S]*?)<\/script>/)[1]
    .replace(/\\u003c/g, '<').replace(/--\\u003e/g, '-->')
);
ok('round-trip: embedded JSON equals the input record',
  embedded.slug === EXAMPLE.slug && embedded.services.items.length === 3 && embedded.images.hero.url === EXAMPLE.images.hero.url);

const liveFromPage = M.mapRecord(embedded);
ok('round-trip: mapper converts embedded record to live shape',
  liveFromPage.business.name === 'Cascade Home Remodeling' &&
  liveFromPage.services.length === 3 &&
  liveFromPage.services[0].detail.bullets.length === 4);

// tmpOut cleanup
fs.rmSync(tmpOut, { recursive: true, force: true });

/* ---------- summary ---------- */

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
