#!/usr/bin/env node
/* ============================================================
   WIZARD CORE UNIT TESTS — headless, dependency-free.
   Run: node test/wizard-core-test.js
   Loads wizard/js/wizard-core.js via require and reads the
   globalThis.WizardCore namespace it installs (see verify.js
   wizard phase notes). Exits non-zero on any failure.
   ============================================================ */
'use strict';
require('../wizard/js/wizard-core.js');
const C = globalThis.WizardCore;

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('PASS  ' + name); }
  else { failed++; console.log('FAIL  ' + name + (extra !== undefined ? ' — ' + JSON.stringify(extra) : '')); }
}

/* ---------- slugify ---------- */
ok('slugify: basic', C.slugify('Cascade Home Remodeling') === 'cascade-home-remodeling');
ok('slugify: diacritics fold + apostrophes join', C.slugify("O'Brien & Sons — Café, LLC!") === 'obrien-sons-cafe-llc', C.slugify("O'Brien & Sons — Café, LLC!"));

/* ---------- slugs + ids ---------- */
ok('buildSlug: name+city+state', C.buildSlug('Cascade Home Remodeling', 'Bend', 'OR') === 'cascade-home-remodeling-bend-or');
ok('ensureUniqueSlug: free base kept', C.ensureUniqueSlug('a-b', ['x']) === 'a-b');
ok('ensureUniqueSlug: -2 on collision', C.ensureUniqueSlug('a-b', ['a-b']) === 'a-b-2');
ok('ensureUniqueSlug: -3 skips taken -2', C.ensureUniqueSlug('a-b', ['a-b', 'a-b-2']) === 'a-b-3');
ok('generateId: internal preview_ prefix, not slug-like', /^preview_[a-z0-9]+$/.test(C.generateId()));

/* ---------- state ---------- */
const blank = C.blankState();
ok('blankState: mirrors CSV columns (has required 4 + reviews)', ['businessName','city','state','trade','reviews'].every(k => k in blank));
const loaded = C.loadState({ businessName: 'Acme', bogusKey: 'dropped' });
ok('loadState: merges known, drops unknown', loaded.businessName === 'Acme' && !('bogusKey' in loaded));

/* ---------- validation + status ---------- */
ok('validate: blank state has 4 errors on step 0', C.validate(blank).errors.length === 4 && C.validate(blank).errors.every(e => e.step === 0));
ok('resolveStatus: blocked when required missing', C.resolveStatus(blank) === 'blocked');

/* ---------- CSV parseCsv ---------- */
const basic = C.parseCsv('a,b,c\n1,2,3\n4,5,6');
ok('parseCsv: rows keyed by header', basic.length === 2 && basic[0].a === '1' && basic[1].c === '6', basic);
const quoted = C.parseCsv('business_name,city,state,trade\n"Smith & Sons, LLC","Portland, OR",OR,remodeling');
ok('parseCsv: quoted commas stay in-cell', quoted[0].business_name === 'Smith & Sons, LLC' && quoted[0].city === 'Portland, OR', quoted);
const escq = C.parseCsv('a,b\n"He said ""hi"" there",x');
ok('parseCsv: doubled quotes unescape', escq[0].a === 'He said "hi" there', escq);
const crlf = C.parseCsv('a,b\r\n1,2\r\n');
ok('parseCsv: CRLF tolerated', crlf.length === 1 && crlf[0].b === '2');
const commented = C.parseCsv('\uFEFF# note\na,b\n\n1,2\n# another\n3,4');
ok('parseCsv: BOM + comments + blank rows skipped', commented.length === 2 && commented[0].a === '1' && commented[1].b === '4', commented);
const semi = C.parseCsv('a;b;c\n1;2;3');
ok('parseCsv: semicolon delimiter sniffed', semi[0].b === '2', semi);
const mixedCase = C.parseCsv('Business_Name,CITY\nX,Y');
ok('parseCsv: header case-insensitive', mixedCase[0].business_name === 'X' && mixedCase[0].city === 'Y', mixedCase);
const multilineCell = C.parseCsv('a,b\n"line1\nline2",z');
ok('parseCsv: newline inside quotes stays in cell', multilineCell[0].a === 'line1\nline2', multilineCell);
ok('parseCsv: empty text -> []', C.parseCsv('').length === 0 && C.parseCsv(null).length === 0);

/* ---------- stateFromCsvRow ---------- */
const row = {
  business_name: 'Cascade Home Remodeling', city: 'Bend', state: 'OR', trade: 'remodeling',
  phone: '541-555-0198', website_url: 'https://example.com',
  services: 'Kitchen Remodeling|Bathroom Remodeling',
  service_areas: 'Bend|Redmond', email: 'hi@example.com',
  reviews: 'Great crew, fair price::Sarah M., Bend|Finished on schedule::Tom R.',
  owner_name: 'Pat Doe', address: '12 Main St', business_hours: 'M-F 8-5',
  license_number: 'CCB-204555', notes: 'referral',
  hero_image_url: 'https://cdn.example/hero.jpg', logo_url: 'https://cdn.example/logo.png',
  project_images: 'a.jpg|b.jpg', source_url: 'https://source.example'
};
const s = C.stateFromCsvRow(row);
ok('csvRow: identity mapping', s.businessName === 'Cascade Home Remodeling' && s.city === 'Bend' && s.state === 'OR' && s.trade === 'remodeling');
ok('csvRow: recommended columns map', s.phone === '541-555-0198' && s.websiteUrl === 'https://example.com' && s.email === 'hi@example.com');
ok('csvRow: multi-value stays pipe-joined', s.services === 'Kitchen Remodeling|Bathroom Remodeling' && s.serviceAreas === 'Bend|Redmond');
ok('csvRow: reviews | -> newlines, :: kept', s.reviews === 'Great crew, fair price::Sarah M., Bend\nFinished on schedule::Tom R.', s.reviews);
ok('csvRow: research fields mapped', s.ownerName === 'Pat Doe' && s.licenseNumber === 'CCB-204555' && s.address === '12 Main St' && s.businessHours === 'M-F 8-5');
ok('csvRow: legacy asset refs (logo/project_images) fold into notes; hero now first-class', s.notes.indexOf('Asset refs (not rendered)') !== -1 && s.notes.indexOf('logo.png') !== -1 && s.notes.indexOf('a.jpg|b.jpg') !== -1 && s.notes.indexOf('hero.jpg') === -1, s.notes);
ok('csvRow: sourceUrl mapped', s.sourceUrl === 'https://source.example');
const emptyRow = C.stateFromCsvRow({});
ok('csvRow: blank row -> blank state (safe)', emptyRow.businessName === '' && emptyRow.reviews === '' && emptyRow.status === 'needs_review');

/* ---------- buildRecord from CSV row (honest-copy paths) ---------- */
const rec = C.buildRecord(s);
ok('csvRecord: builds + slug from name+city+state', rec.ok && rec.record.slug === 'cascade-home-remodeling-bend-or');
ok('csvRecord: id internal, not slug', rec.record.id.startsWith('preview_') && rec.record.id !== rec.record.slug);
ok('csvRecord: services from CSV row', rec.record.services.items.length === 2 && rec.record.services.items[0].title === 'Kitchen Remodeling');
ok('csvRecord: communities from service_areas', JSON.stringify(rec.record.serviceArea.communities) === JSON.stringify(['Bend','Redmond']));
ok('csvRecord: real reviews flow into record (honest data)', rec.record.reviews.items.length === 2 && rec.record.reviews.items[0].quote === 'Great crew, fair price' && rec.record.reviews.items[0].attribution === 'Sarah M., Bend', rec.record.reviews.items);
ok('csvRecord: visibility.reviews true only with real reviews', rec.record.visibility.reviews === true);
ok('csvRecord: claims/projects stay empty (honest-copy)', rec.record.claims.length === 0 && rec.record.projects.items.length === 0);
ok('csvRecord: research-only license under metadata, not business', rec.record.metadata.licenseNumber === 'CCB-204555' && !('license' in rec.record.business));
ok('csvRecord: hero override first-class (JUS-52), legacy refs stay in notes', rec.record.images.hero.url === 'https://cdn.example/hero.jpg' && rec.record.metadata.notes.indexOf('logo.png') !== -1 && rec.record.metadata.notes.indexOf('a.jpg') !== -1 && rec.record.metadata.notes.indexOf('hero.jpg') === -1, rec.record.metadata.notes);
ok('csvRecord: no default_services flag when CSV supplies services', JSON.stringify(rec.record.metadata.flags) === '[]');

/* reviews-less row keeps sections hidden */
const sNoRev = C.stateFromCsvRow({ business_name: 'A', city: 'B', state: 'OR', trade: 'plumbing' });
const recNoRev = C.buildRecord(sNoRev);
ok('csvRecord: no reviews -> items empty + visibility false (unchanged honest default)', recNoRev.record.reviews.items.length === 0 && recNoRev.record.visibility.reviews === false);
ok('csvRecord: plumbing defaults when no services in row', recNoRev.record.services.items.length === 3 && recNoRev.record.metadata.flags.includes('default_services'));

/* ---------- joinReviews round-trip ---------- */
const lines = s.reviews.split('\n').map(C.parseReviewLine);
ok('joinReviews: round-trip preserves pairs', C.joinReviews(lines) === s.reviews, C.joinReviews(lines));

/* ---------- images: safeAltText (JUS-52) ---------- */
ok('safeAltText: hero default generic', C.safeAltText('hero', 'remodeling') === 'Home remodeling inspiration image');
ok('safeAltText: room slots generic', C.safeAltText('projectKitchen') === 'Kitchen remodeling inspiration image' && C.safeAltText('projectBath') === 'Bathroom remodeling inspiration image' && C.safeAltText('projectWholeHome') === 'Whole-home remodeling inspiration image');
ok('safeAltText: non-remodeling trade adapts hero alt', C.safeAltText('hero', 'roofing') === 'Roofing inspiration image', C.safeAltText('hero', 'roofing'));
ok('safeAltText: multi-word trade title-cased', C.safeAltText('projectFeatured', 'general contractor') === 'General Contractor inspiration image');
ok('safeAltText: unknown slot falls back to hero default', C.safeAltText('nonsense') === 'Home remodeling inspiration image');

/* ---------- images: normalizeImageUrl ---------- */
ok('normalize: https accepted', C.normalizeImageUrl('https://cdn.example/x.jpg') === 'https://cdn.example/x.jpg');
ok('normalize: trims + accepts // and /-relative', C.normalizeImageUrl('  //cdn.example/x.jpg ') === '//cdn.example/x.jpg' && C.normalizeImageUrl('/img/x.jpg') === '/img/x.jpg');
ok('normalize: javascript/data/blob rejected', C.normalizeImageUrl('javascript:alert(1)') === '' && C.normalizeImageUrl('data:image/png;base64,AAA') === '' && C.normalizeImageUrl('blob:xyz') === '');
ok('normalize: plain text treated as blank', C.normalizeImageUrl('not a url') === '' && C.normalizeImageUrl('') === '' && C.normalizeImageUrl(null) === '');

/* ---------- images: resolvePreviewImage (3-tier) ---------- */
const tdef = { hero: { url: 'https://cdn.example/default-hero.jpg', alt: '' }, projectKitchen: { url: '', alt: '' } };
const rOv = C.resolvePreviewImage('hero', { hero: { url: 'https://cdn.example/mine.jpg', alt: 'Owner photo' } }, tdef, 'remodeling');
ok('resolve: prospect override wins + custom alt', rOv.source === 'prospect' && rOv.url === 'https://cdn.example/mine.jpg' && rOv.alt === 'Owner photo' && rOv.slot === 'hero', rOv);
const rDef = C.resolvePreviewImage('hero', { hero: {} }, tdef, 'remodeling');
ok('resolve: template default second + generated alt', rDef.source === 'template_default' && rDef.url === 'https://cdn.example/default-hero.jpg' && rDef.alt === 'Home remodeling inspiration image', rDef);
const rPh = C.resolvePreviewImage('projectKitchen', { projectKitchen: { url: 'javascript:evil(1)' } }, tdef, 'remodeling');
ok('resolve: invalid override url -> placeholder (never breaks)', rPh.source === 'placeholder' && rPh.url === undefined && rPh.alt === 'Kitchen remodeling inspiration image', rPh);
ok('resolve: no data at all -> placeholder + safe alt', C.resolvePreviewImage('projectBath', {}, null, 'remodeling').source === 'placeholder');
ok('resolve: prospect beats template default', C.resolvePreviewImage('hero', { hero: { url: '/local.jpg' } }, tdef, 'remodeling').url === '/local.jpg');

/* ---------- images: buildImages from state ---------- */
const imgState = C.loadState({ businessName: 'A', city: 'B', state: 'OR', trade: 'roofing', heroImageUrl: 'https://cdn.example/h.jpg', heroImageAlt: 'Owner photo', projectBathImageUrl: 'javascript:x' });
const imgRec = C.buildRecord(imgState);
ok('buildImages: override written + custom alt', imgRec.record.images.hero.url === 'https://cdn.example/h.jpg' && imgRec.record.images.hero.alt === 'Owner photo');
ok('buildImages: trade-aware safe alt when blank', imgRec.record.images.projectFeatured.alt === 'Roofing inspiration image' && imgRec.record.images.projectFeatured.url === undefined);
ok('buildImages: invalid url dropped to safe alt (placeholder path)', imgRec.record.images.projectBath.url === undefined && imgRec.record.images.projectBath.alt === 'Bathroom remodeling inspiration image');
ok('buildImages: all five slots always present', ['hero','projectFeatured','projectKitchen','projectBath','projectWholeHome'].every(k => imgRec.record.images[k] && typeof imgRec.record.images[k].alt === 'string'));
ok('buildRecord: images never create projects/claims (honest-copy)', imgRec.record.projects.items.length === 0 && imgRec.record.claims.length === 0 && imgRec.record.visibility.projects === false);

/* ---------- images: CSV row mapping ---------- */
const imgRow = C.stateFromCsvRow({
  business_name: 'A', city: 'B', state: 'OR', trade: 'remodeling',
  hero_image_url: ' https://cdn.example/hero.jpg ', hero_image_alt: 'Owner photo',
  project_kitchen_image_url: 'https://cdn.example/kitchen.jpg',
  project_bath_image_url: 'javascript:alert(1)'
});
ok('csvRow: hero_image_url + alt map first-class (JUS-52)', imgRow.heroImageUrl === 'https://cdn.example/hero.jpg' && imgRow.heroImageAlt === 'Owner photo');
ok('csvRow: project image columns map', imgRow.projectKitchenImageUrl === 'https://cdn.example/kitchen.jpg');
const imgRowRec = C.buildRecord(C.loadState(imgRow));
ok('csvRow: images land in record images block', imgRowRec.record.images.hero.url === 'https://cdn.example/hero.jpg' && imgRowRec.record.images.projectKitchen.url === 'https://cdn.example/kitchen.jpg');
ok('csvRow: legacy logo/project_images stay notes-only, no fake projects', imgRowRec.record.images.hero.url === 'https://cdn.example/hero.jpg' && imgRowRec.record.projects.items.length === 0);

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
