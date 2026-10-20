// Headless verification for the preview template.
// Usage: node test/verify.js
// Requires Edge/Chrome (path resolved by scripts/cdp-harness.js).
// Serves files from the project dir.
const fs = require('fs');
const path = require('path');
const H = require('../scripts/cdp-harness.js');
const { wait, evaluate, waitReady, key, killTree } = H;

const ROOT = path.join(__dirname, '..');
const PORT = 3111;
const GEN_PORT = 3112;
const DIST_ROOT = path.join(__dirname, '..', 'dist');

// Minimal HTML fixture served at /minimal.html: the real page minus the
// data file, so the renderer runs against an EMPTY dataset on FIRST
// render. Proves the first-render fallback contract: no business data
// from index.html's template defaults may survive (phone, title, claims).
const MINIMAL_HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  .replace('<script src="js/preview-data.js"></script>', '');

let endpointHits = 0;
let endpointAborts = 0;

const server = H.createStaticServer(ROOT, {
  routes: {
    '/slow-endpoint': (req, res) => {
      // Track cancellation: if the socket closes before the response was
      // written, the client aborted the fetch (this is what AbortController
      // produces; a delivered response would set writableEnded first).
      endpointHits++;
      res.on('close', () => { if (!res.writableEnded) endpointAborts++; });
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); }, 1200);
    },
    // /count-endpoint increments a counter; /hits reads-and-resets so tests
    // can assert delivery counts regardless of run order.
    '/count-endpoint': (req, res) => { endpointHits++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); },
    '/hits': (req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ hits: endpointHits, aborted: endpointAborts })); endpointHits = 0; endpointAborts = 0; },
    '/minimal.html': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(MINIMAL_HTML); }
  }
});

async function main() {
  await new Promise(r => server.listen(PORT, r));

  // Dist-rooted static server for generated-preview checks. The
  // generated pages reference ../../assets/, which resolves to the
  // dist root — exactly how the real deployment serves them
  // (dist/ as the web root). Serving them from the project ROOT
  // (like the main server) would 404 every stylesheet/script.
  const genApp = H.createStaticServer(DIST_ROOT, { indexPath: '/previews/cascade-home-remodeling-bend-or/index.html' });
  await new Promise(r => genApp.listen(GEN_PORT, r));
  const results = [];
  const ok = (name, pass, extra) => { results.push({ name, pass, extra }); console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  — ' + extra : '')); };

  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'preview-verify-'));
  // Browser sessions come from the shared CDP harness (scripts/cdp-harness.js):
  // fixed debugging port, 3 spawn retries, stderr capture, /json/list poll.
  // tmp doubles as the user-data-dir parent; defaultPort keeps the main
  // template server (PORT) as the default HTTP origin.
  const runSession = H.createSessionFactory({ browserPath: H.resolveBrowserPath(), tmpDir: tmp, defaultPort: PORT });

  const consoleErrors = [];

  // ---------- Desktop session ----------
  {
    const { proc, ws } = await runSession(9223, 1440, 960, false);
    // collect console errors
    ws.send({ id: 901, method: 'Runtime.evaluate', params: { expression: 'window.__errors = []; window.onerror = function(m){ window.__errors.push(String(m)); };', returnByValue: true } });

    const checks = `
      (function(){
        const q = s => document.querySelector(s);
        const qa = s => document.querySelectorAll(s);
        return {
          title: document.title,
          banner: !!q('.preview-banner'),
          header: !!q('.site-header'),
          hero: !!q('.hero'),
          services: qa('.service-card').length,
          process: qa('.process-step').length,
          area: !!q('.service-area'),
          finalCta: !!q('.final-cta'),
          ownerBar: !!q('.owner-bar'),
          footer: !!q('.site-footer'),
          drawer: !!q('.drawer'),
          drawerHidden: getComputedStyle(q('.drawer')).visibility === 'hidden',
          openTriggers: qa('[data-open-drawer]').length,
          navLinks: Array.prototype.filter.call(qa('.site-nav__link'), function (a) { return !a.closest('li[hidden]'); }).length,
          phone: document.body.innerHTML.indexOf('541-555-0198') !== -1,
          bodyOverflowDefault: document.body.style.overflow === '',
          // Data-model contract (preview-data.js ships honest/empty lists):
          renderedFlag: document.documentElement.getAttribute('data-preview-rendered'),
          title: document.title,
          phoneText: (q('.site-header__phone span') || {}).textContent || '',
          phoneHref: q('.site-header__phone').getAttribute('href'),
          claimsHidden: q('[data-preview-section="claims"]').hidden,
          projectsHidden: q('[data-preview-section="projects"]').hidden,
          reviewsHidden: q('[data-preview-section="reviews"]').hidden,
          // Computed visibility, not just the property: CSS must let
          // [hidden] win over display utilities on lists/sections.
          claimsComputed: getComputedStyle(q('[data-preview-section="claims"]')).display === 'none',
          areaComputed: getComputedStyle(q('[data-preview-list="serviceArea.communities"]')).display === 'none',
          projHighlightsComputed: getComputedStyle(q('[data-preview-list="projectHighlights"]')).display === 'none',
          footerNav: { services: document.querySelector('.site-footer__nav [data-preview-nav="services"]').hidden, reviews: document.querySelector('.site-footer__nav [data-preview-nav="reviews"]').hidden, process: document.querySelector('.site-footer__nav [data-preview-nav="process"]').hidden },
          servicesVisible: !q('[data-preview-section="services"]').hidden,
          processVisible: !q('[data-preview-section="process"]').hidden,
          reviewsNavHidden: document.querySelector('[data-preview-nav="reviews"]').hidden,
          projectsNavHidden: document.querySelector('[data-preview-nav="projects"]').hidden,
          servicesNavVisible: !document.querySelector('[data-preview-nav="services"]').hidden,
          titleFilled: document.title.indexOf('Cascade Home Remodeling') !== -1,
          noPlaceholderLeak: document.body.textContent.indexOf('Review space') === -1
                        && document.body.textContent.indexOf('Add your strongest customer feedback') === -1
        };
      })()
    `;
    const dom = await evaluate(ws, checks);
    ok('desktop: preview banner present', dom.banner);
    ok('desktop: header present', dom.header);
    ok('desktop: hero present', dom.hero);
    ok('desktop: 3 service cards rendered from data', dom.services === 3, String(dom.services));
    ok('desktop: 4 process steps rendered from data', dom.process === 4, String(dom.process));
    ok('desktop: service area present', dom.area);
    ok('desktop: final CTA present', dom.finalCta);
    ok('desktop: owner bar present', dom.ownerBar);
    ok('desktop: footer present', dom.footer);
    ok('desktop: phone number present', dom.phone);
    ok('desktop: visible nav links = 3 (services/process/contact)', dom.navLinks === 3, String(dom.navLinks));
    ok('desktop: drawer hidden by default', dom.drawerHidden);
    ok('desktop: >=3 drawer open triggers', dom.openTriggers >= 3, String(dom.openTriggers));
    // Data-model contract: honest defaults (no real reviews/projects/claims).
    ok('desktop: renderer completed (data-preview-rendered)', dom.renderedFlag === 'true');
    ok('desktop: claims/projects/reviews hidden without data (property + computed)', dom.claimsHidden && dom.projectsHidden && dom.reviewsHidden && dom.claimsComputed, JSON.stringify({claimsHidden: dom.claimsHidden, projectsHidden: dom.projectsHidden, reviewsHidden: dom.reviewsHidden, computed: dom.claimsComputed}));
    ok('desktop: services/process sections render with data', dom.servicesVisible && dom.processVisible);
    ok('desktop: nav links hidden for empty sections (header + footer)', dom.reviewsNavHidden && dom.projectsNavHidden && dom.servicesNavVisible && !dom.footerNav.services && dom.footerNav.reviews && !dom.footerNav.process, JSON.stringify({ header: { reviews: dom.reviewsNavHidden, projects: dom.projectsNavHidden, services: dom.servicesNavVisible }, footer: dom.footerNav }));
    ok('desktop: title populated from data model', dom.titleFilled);
    ok('desktop: title built from data model exactly', dom.title === 'Cascade Home Remodeling \u2014 Bend, Oregon (Preview)', dom.title);
    ok('desktop: area chips computed-visible with data; highlights hidden', dom.areaComputed === false && dom.projHighlightsComputed, JSON.stringify({ area: dom.areaComputed, projHighlights: dom.projHighlightsComputed }));
    ok('desktop: no placeholder copy leaks into rendered page', dom.noPlaceholderLeak);

    // Image slots (JUS-52): defaults module + initial placeholder state.
    const imgBase = await evaluate(ws, `(function(){
      const q = s => document.querySelector(s);
      const heroFig = q('[data-preview-img="hero"]');
      return {
        defaultsLoaded: !!window.PreviewImageDefaults,
        heroFig: !!heroFig,
        heroNoImg: heroFig && !heroFig.querySelector('img[data-preview-img-img]'),
        heroNoIsImg: heroFig && !heroFig.classList.contains('is-img'),
        heroAlt: heroFig ? heroFig.getAttribute('aria-label') : ''
      };
    })()`);
    ok('desktop: image defaults module loaded (single config point)', imgBase.defaultsLoaded && imgBase.heroFig, JSON.stringify(imgBase));
    ok('desktop: hero slot renders safe placeholder without images data', imgBase.heroNoImg && imgBase.heroNoIsImg && imgBase.heroAlt === 'Home remodeling inspiration image', JSON.stringify(imgBase));

    // Drawer interaction
    await evaluate(ws, `document.querySelector('.preview-banner [data-open-drawer]').click(); new Promise(r=>setTimeout(r,600)).then(()=>1)`);
    const opened = await evaluate(ws, `(function(){ const d = document.querySelector('.drawer-root'); return { open: d.classList.contains('is-open'), aria: d.getAttribute('aria-hidden'), vis: getComputedStyle(document.querySelector('.drawer')).visibility, bodyLocked: document.body.style.overflow === 'hidden' }; })()`);
    ok('desktop: drawer opens on Launch click', opened.open && opened.vis === 'visible' && opened.bodyLocked, JSON.stringify(opened));

    const drawerSize = await evaluate(ws, `(function(){ const d = document.querySelector('.drawer'); const r = d.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), winH: window.innerHeight }; })()`);
    ok('desktop: drawer <= 960px wide, docked to bottom, not full height', drawerSize.w <= 960 && Math.abs(drawerSize.top + drawerSize.h - drawerSize.winH) <= 6 && drawerSize.h < drawerSize.winH * 0.85, JSON.stringify(drawerSize));

    // screenshot open
    ws.send({ id: 910, method: 'Page.captureScreenshot', params: { format: 'png' } });
    for (;;) { const m = await ws.next(); if (m.id === 910) { fs.writeFileSync(path.join(tmp, 'desktop-drawer-open.png'), Buffer.from(m.result.data, 'base64')); break; } }

    // Escape closes
    await evaluate(ws, `document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); new Promise(r=>setTimeout(r,600)).then(()=>1)`);
    const closedEsc = await evaluate(ws, `(function(){ return { open: document.querySelector('.drawer-root').classList.contains('is-open'), locked: document.body.style.overflow === 'hidden' }; })()`);
    ok('desktop: Escape closes drawer + unlocks scroll', !closedEsc.open && !closedEsc.locked);

    // Backdrop closes
    await evaluate(ws, `document.querySelector('.owner-bar [data-open-drawer]').click(); new Promise(r=>setTimeout(r,600)).then(()=>1)`);
    await evaluate(ws, `document.querySelector('.drawer-backdrop').click(); new Promise(r=>setTimeout(r,600)).then(()=>1)`);
    const closedBackdrop = await evaluate(ws, `!document.querySelector('.drawer-root').classList.contains('is-open')`);
    ok('desktop: backdrop click closes drawer', closedBackdrop);

    // Question form routing and local MVP success state
    await evaluate(ws, `document.querySelector('.preview-banner [data-open-drawer="question"]').click(); new Promise(r=>setTimeout(r,300)).then(()=>1)`);
    const questionOpen = await evaluate(ws, `(function(){
      const q = document.querySelector('[data-drawer-view="question"]');
      const l = document.querySelector('[data-drawer-view="launch"]');
      return {
        open: document.querySelector('.drawer-root').classList.contains('is-open'),
        questionVisible: !q.hidden,
        launchHidden: l.hidden,
        focused: document.activeElement && document.activeElement.id,
        fields: q.querySelectorAll('input:not([type="hidden"]), textarea').length
      };
    })()`);
    ok('desktop: Ask a Question opens question view', questionOpen.open && questionOpen.questionVisible && questionOpen.launchHidden, JSON.stringify(questionOpen));
    ok('desktop: question form focuses name and contains all fields', questionOpen.focused === 'question-name' && questionOpen.fields >= 5, JSON.stringify(questionOpen));

    const invalidBlocked = await evaluate(ws, `(function(){
      const f = document.getElementById('question-form');
      return !f.checkValidity() && document.querySelector('[data-drawer-view="success"]').hidden;
    })()`);
    ok('desktop: required fields block incomplete submission', invalidBlocked);

    await evaluate(ws, `(async function(){
      const f = document.getElementById('question-form');
      f.elements.name.value = 'Taylor';
      f.elements.contact.value = 'taylor@example.com';
      f.elements.message.value = 'Can I use my own project photos?';
      f.requestSubmit();
      await new Promise(r=>setTimeout(r,350));
      return 1;
    })()`);
    const successView = await evaluate(ws, `(function(){
      return {
        successVisible: !document.querySelector('[data-drawer-view="success"]').hidden,
        questionHidden: document.querySelector('[data-drawer-view="question"]').hidden,
        title: document.querySelector('[data-drawer-view="success"] .drawer__title').textContent.trim()
      };
    })()`);
    ok('desktop: local submission shows success state', successView.successVisible && successView.questionHidden && successView.title === 'Question sent', JSON.stringify(successView));
    await evaluate(ws, `document.querySelector('[data-drawer-view="success"] [data-close-drawer]').click(); new Promise(r=>setTimeout(r,300)).then(()=>1)`);

    // Configured endpoint failure should retain values and show the inline error.
    await evaluate(ws, `document.querySelector('.owner-card [data-open-drawer="question"]').click(); new Promise(r=>setTimeout(r,250)).then(()=>1)`);
    await evaluate(ws, `(async function(){
      const f = document.getElementById('question-form');
      f.setAttribute('data-form-endpoint', '/missing-form-endpoint');
      f.elements.name.value = 'Morgan';
      f.elements.contact.value = '541-555-0101';
      f.elements.message.value = 'What happens after launch?';
      f.requestSubmit();
      await new Promise(r=>setTimeout(r,700));
      return 1;
    })()`);
    const errorState = await evaluate(ws, `(function(){
      const f = document.getElementById('question-form');
      const s = document.getElementById('question-form-status');
      const result = { visible: !s.hidden, message: s.textContent, retained: f.elements.message.value };
      f.setAttribute('data-form-endpoint', '');
      return result;
    })()`);
    ok('desktop: endpoint failure shows error and retains values', errorState.visible && /went wrong/i.test(errorState.message) && errorState.retained === 'What happens after launch?', JSON.stringify(errorState));
    await evaluate(ws, `document.querySelector('[data-drawer-view-trigger="launch"]').click(); new Promise(r=>setTimeout(r,200)).then(()=>1)`);
    const backToLaunch = await evaluate(ws, `!document.querySelector('[data-drawer-view="launch"]').hidden && document.querySelector('[data-drawer-view="question"]').hidden`);
    ok('desktop: Back to Launch Details switches views', backToLaunch);
    await evaluate(ws, `document.querySelector('.drawer-root .drawer__close').click(); new Promise(r=>setTimeout(r,250)).then(()=>1)`);

    // --- Overlapping programmatic submissions: while sending, extra submits are ignored ---
    // NOTE: requestSubmit() no-ops while the submit button is disabled, so
    // to exercise the in-flight window we dispatch a real submit event,
    // which bypasses the button-disabled no-op but still runs our handler.
    await evaluate(ws, `document.querySelector('.preview-banner [data-open-drawer="question"]').click(); new Promise(r=>setTimeout(r,250)).then(()=>1)`);
    await evaluate(ws, `(async function(){
      const f = document.getElementById('question-form');
      f.setAttribute('data-form-endpoint', '/count-endpoint');
      f.elements.name.value = 'Overlap';
      f.elements.contact.value = 'overlap@example.com';
      f.elements.message.value = 'overlap check';
      f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));  // submission 1 (in flight)
      f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));  // ignored: pending guard
      await new Promise(r=>setTimeout(r,50));
      f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));  // still ignored
      return 1;
    })()`);
    await wait(1200);
    const overlap = await evaluate(ws, `(function(){
      const f = document.getElementById('question-form');
      const st = { successVisible: !document.querySelector('[data-drawer-view="success"]').hidden, btnReady: !f.querySelector('[type="submit"]').disabled };
      f.setAttribute('data-form-endpoint', '');
      return st;
    })()`);
    const overlapCount = await evaluate(ws, `fetch('/hits').then(r => r.json())`);
    ok('desktop: overlapping submits ignored (exactly one delivery)', overlap.successVisible && overlap.btnReady && overlapCount.hits === 1 && overlapCount.aborted === 0, JSON.stringify(overlapCount));
    await evaluate(ws, `document.querySelector('[data-drawer-view="success"] [data-close-drawer]').click(); new Promise(r=>setTimeout(r,250)).then(()=>1)`);

    // --- Honeypot: bots that fill the hidden field get fake success, no request ---
    await evaluate(ws, `document.querySelector('.preview-banner [data-open-drawer="question"]').click(); new Promise(r=>setTimeout(r,250)).then(()=>1)`);
    await evaluate(ws, `(async function(){
      const f = document.getElementById('question-form');
      f.setAttribute('data-form-endpoint', '/count-endpoint');
      f.elements.name.value = 'Bot';
      f.elements.contact.value = 'bot@spam.example';
      f.elements.message.value = 'buy now';
      f.elements.company_website.value = 'http://spam.example';
      f.requestSubmit();
      await new Promise(r=>setTimeout(r,300));
      return 1;
    })()`);
    const honeypot = await evaluate(ws, `(function(){
      const f = document.getElementById('question-form');
      const state = {
        successVisible: !document.querySelector('[data-drawer-view="success"]').hidden,
        formEmpty: f.elements.name.value === '' && f.elements.contact.value === ''
      };
      f.setAttribute('data-form-endpoint', '');
      return state;
    })()`);
    const honeypotCount = await evaluate(ws, `fetch('/hits').then(r => r.json())`);
    ok('desktop: honeypot submission fakes success without sending', honeypot.successVisible && honeypot.formEmpty && honeypotCount.hits === 0, JSON.stringify(honeypotCount));
    await evaluate(ws, `document.querySelector('[data-drawer-view="success"] [data-close-drawer]').click(); new Promise(r=>setTimeout(r,250)).then(()=>1)`);

    // --- Honeypot invalidation: a honeypot submit while a real request is
    // in flight aborts that request — it must never reach the server. ---
    // Dispatch real submit events (requestSubmit no-ops while the button
    // is disabled, i.e. while the first request is in flight).
    await evaluate(ws, `document.querySelector('.owner-card [data-open-drawer="question"]').click(); new Promise(r=>setTimeout(r,250)).then(()=>1)`);
    await evaluate(ws, `(async function(){
      const f = document.getElementById('question-form');
      f.setAttribute('data-form-endpoint', '/slow-endpoint');
      f.elements.name.value = 'Real Sender';
      f.elements.contact.value = 'real@example.com';
      f.elements.message.value = 'should be aborted';
      f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));  // real request in flight
      await new Promise(r=>setTimeout(r,50));
      f.elements.company_website.value = 'http://spam.example';
      f.elements.name.value = 'Bot';
      f.elements.contact.value = 'bot@spam.example';
      f.elements.message.value = 'buy now';
      f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));  // honeypot: fakes success + aborts
      return 1;
    })()`);
    await wait(1600); // long enough for the aborted request to have arrived if not cancelled
    const honeypotAbort = await evaluate(ws, `(function(){
      const f = document.getElementById('question-form');
      const st = {
        successVisible: !document.querySelector('[data-drawer-view="success"]').hidden,
        btnReady: !f.querySelector('[type="submit"]').disabled
      };
      f.setAttribute('data-form-endpoint', '');
      f.reset();
      return st;
    })()`);
    const abortCount = await evaluate(ws, `fetch('/hits').then(r => r.json())`);
    // The real request must never complete AND the server must have seen
    // the client hang up (AbortController cancellation), proving the
    // in-flight request was truly aborted — not merely ignored.
    ok('desktop: honeypot aborts in-flight real request (server-observed cancellation)', honeypotAbort.successVisible && honeypotAbort.btnReady && abortCount.hits === 1 && abortCount.aborted === 1, JSON.stringify(abortCount));

    // --- Focus trap via REAL trusted keyboard input (CDP Input domain).
    // Synthetic KeyboardEvents don't perform native Tab navigation, so
    // these tests dispatch trusted key events and assert boundary
    // wrapping (Tab from last → first, Shift+Tab from first → last),
    // which only holds while the trap is active. The focusable list is
    // computed with the same selector/scoping as main.js focusables(). ---
    await evaluate(ws, `document.querySelector('.owner-card [data-open-drawer="launch"]').click(); new Promise(r=>setTimeout(r,400)).then(()=>1)`);
    await evaluate(ws, `document.querySelector('[data-drawer-view-trigger="question"]').click(); new Promise(r=>setTimeout(r,300)).then(()=>1)`);

    const trapIdsJson = await evaluate(ws, `(function(){
      function elId(el) { return el.id || (el.className + '').split(' ')[0] || el.tagName; }
      var drawer = document.querySelector('.drawer');
      var items = Array.prototype.filter.call(
        drawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), [tabindex="0"]'),
        function (el) { return !el.closest('[hidden]'); }
      );
      window.__trapItems = items;
      return JSON.stringify({ first: elId(items[0]), last: elId(items[items.length - 1]), count: items.length });
    })()`);
    const trapIds = JSON.parse(trapIdsJson);
    ok('desktop: trap fixture has >=2 focusables in open drawer', trapIds.count >= 2, JSON.stringify(trapIds));

    // Tab from the LAST focusable must wrap to the FIRST.
    await evaluate(ws, `window.__trapItems[window.__trapItems.length - 1].focus(); 1`);
    await key(ws, 'Tab');
    await wait(120);
    const afterTab = await evaluate(ws, `(function(){ var a = document.activeElement; return a.id || (a.className + '').split(' ')[0] || a.tagName; })()`);
    ok('desktop: real Tab from last focusable wraps to first (trap active)', afterTab === trapIds.first, 'last=' + trapIds.last + ' → ' + afterTab);

    // Shift+Tab from the FIRST focusable must wrap to the LAST.
    await evaluate(ws, `window.__trapItems[0].focus(); 1`);
    await key(ws, 'Tab', true);
    await wait(120);
    const afterShift = await evaluate(ws, `(function(){ var a = document.activeElement; return a.id || (a.className + '').split(' ')[0] || a.tagName; })()`);
    ok('desktop: real Shift+Tab from first focusable wraps to last (trap active)', afterShift === trapIds.last, 'first=' + trapIds.first + ' → ' + afterShift);
    await evaluate(ws, `window.__trapItems = null; 1`);

    // --- Async session isolation: stale in-flight request must not clobber a newer session ---
    await evaluate(ws, `(async function(){
      const f = document.getElementById('question-form');
      f.setAttribute('data-form-endpoint', '/slow-endpoint');
      f.elements.name.value = 'First Sender';
      f.elements.contact.value = 'first@example.com';
      f.elements.message.value = 'stale message';
      f.requestSubmit();
      return 1;
    })()`);
    await wait(250); // request is now pending
    await evaluate(ws, `document.querySelector('.drawer-root .drawer__close').click(); new Promise(r=>setTimeout(r,250)).then(()=>1)`);
    const staleClosed = await evaluate(ws, `(function(){
      const f = document.getElementById('question-form');
      return { closed: !document.querySelector('.drawer-root').classList.contains('is-open'), stillSending: f.querySelector('[type="submit"]').disabled };
    })()`);
    await evaluate(ws, `document.querySelector('.owner-card [data-open-drawer="question"]').click(); new Promise(r=>setTimeout(r,350)).then(()=>1)`);
    await evaluate(ws, `(function(){
      const f = document.getElementById('question-form');
      f.elements.name.value = 'Second Sender';
      f.elements.contact.value = 'second@example.com';
      f.elements.message.value = 'fresh message';
      return 1;
    })()`);
    await wait(1500); // let the stale request resolve on the server
    const staleResolved = await evaluate(ws, `(function(){
      const f = document.getElementById('question-form');
      const s = document.getElementById('question-form-status');
      return {
        questionStillVisible: !document.querySelector('[data-drawer-view="question"]').hidden,
        successHidden: document.querySelector('[data-drawer-view="success"]').hidden,
        nameKept: f.elements.name.value === 'Second Sender',
        messageKept: f.elements.message.value === 'fresh message',
        noErrorShown: s.hidden,
        submitReady: !f.querySelector('[type="submit"]').disabled
      };
    })()`);
    ok('desktop: close aborts in-flight submit', staleClosed.closed && !staleClosed.stillSending, JSON.stringify(staleClosed));
    ok('desktop: stale request cannot clobber reopened form', staleResolved.questionStillVisible && staleResolved.successHidden && staleResolved.nameKept && staleResolved.messageKept && staleResolved.noErrorShown && staleResolved.submitReady, JSON.stringify(staleResolved));
    await evaluate(ws, `(function(){
      const f = document.getElementById('question-form');
      f.setAttribute('data-form-endpoint', '');
      f.reset();
      return 1;
    })()`);

    // --- Error status is programmatically focusable ---
    await evaluate(ws, `(async function(){
      const f = document.getElementById('question-form');
      f.setAttribute('data-form-endpoint', '/missing-form-endpoint');
      f.elements.name.value = 'Focus Tester';
      f.elements.contact.value = 'focus@example.com';
      f.elements.message.value = 'focus check';
      f.requestSubmit();
      await new Promise(r=>setTimeout(r,700));
      return 1;
    })()`);
    const errFocus = await evaluate(ws, `(function(){
      const s = document.getElementById('question-form-status');
      const focusedOk = document.activeElement === s;
      document.getElementById('question-form').setAttribute('data-form-endpoint', '');
      return { tabindex: s.getAttribute('tabindex'), focusedOk };
    })()`);
    ok('desktop: error status is focusable and receives focus', errFocus.tabindex === '-1' && errFocus.focusedOk, JSON.stringify(errFocus));
    await evaluate(ws, `document.querySelector('[data-drawer-view-trigger="launch"]').click(); new Promise(r=>setTimeout(r,200)).then(()=>1)`);
    await evaluate(ws, `document.querySelector('.drawer-root .drawer__close').click(); new Promise(r=>setTimeout(r,250)).then(()=>1)`);

    // Anchor nav
    await evaluate(ws, `document.querySelector('.site-nav__link[href="#services"]').click(); 1`);
    let scrolled = false;
    for (let i = 0; i < 20 && !scrolled; i++) { await wait(150); scrolled = await evaluate(ws, `window.scrollY > 300`); }
    ok('desktop: nav anchor scrolls', scrolled);

    const errs = await evaluate(ws, `window.__errors || []`);
    ok('desktop: no runtime errors', errs.length === 0, JSON.stringify(errs));

    // page screenshot (top)
    await evaluate(ws, `window.scrollTo(0,0); 1`);
    await wait(400);
    ws.send({ id: 911, method: 'Page.captureScreenshot', params: { format: 'png' } });
    for (;;) { const m = await ws.next(); if (m.id === 911) { fs.writeFileSync(path.join(tmp, 'desktop-top.png'), Buffer.from(m.result.data, 'base64')); break; } }

    // full-page screenshot
    const pageH = await evaluate(ws, `document.documentElement.scrollHeight`);
    ws.send({ id: 912, method: 'Page.captureScreenshot', params: { format: 'png', captureBeyondViewport: true } });
    for (;;) { const m = await ws.next(); if (m.id === 912) { fs.writeFileSync(path.join(tmp, 'desktop-full.png'), Buffer.from(m.result.data, 'base64')); break; } }
    ok('desktop: page renders substantial content', pageH > 3000, 'height=' + pageH);

    ws.close();

    killTree(proc);
  }

  // ---------- Mobile session ----------
  {
    const { proc, ws } = await runSession(9224, 390, 844, true);
    await evaluate(ws, `window.__errors = []; window.onerror = function(m){ window.__errors.push(String(m)); }; 1`);
    await wait(300);

    const mob = await evaluate(ws, `(function(){
      const q = s => document.querySelector(s);
      return {
        bannerMobileCopy: getComputedStyle(q('.preview-banner__text--mobile')).display !== 'none',
        bannerDesktopCopyHidden: getComputedStyle(q('.preview-banner__text--desktop')).display === 'none',
        launchBtnVisible: getComputedStyle(q('.preview-banner__launch-mobile')).display !== 'none',
        askHidden: getComputedStyle(q('.preview-banner__ask')).display === 'none',
        navToggleVisible: getComputedStyle(q('.nav-toggle')).display !== 'none',
        desktopNavHidden: getComputedStyle(q('.site-nav')).display === 'none'
      };
    })()`);
    ok('mobile: compact banner copy swap', mob.bannerMobileCopy && mob.bannerDesktopCopyHidden);
    ok('mobile: Launch button shown / Ask hidden', mob.launchBtnVisible && mob.askHidden);
    ok('mobile: hamburger shown, desktop nav hidden', mob.navToggleVisible && mob.desktopNavHidden);

    // Mobile nav toggle
    await evaluate(ws, `document.querySelector('.nav-toggle').click(); new Promise(r=>setTimeout(r,300)).then(()=>1)`);
    const navOpen = await evaluate(ws, `!document.getElementById('mobile-nav').hidden`);
    ok('mobile: hamburger opens menu', navOpen);
    await evaluate(ws, `document.querySelector('.mobile-nav__link').click(); new Promise(r=>setTimeout(r,500)).then(()=>1)`);
    const navClosed = await evaluate(ws, `document.getElementById('mobile-nav').hidden`);
    ok('mobile: menu closes on link tap', navClosed);

    // Bottom sheet
    await evaluate(ws, `document.querySelector('.preview-banner__launch-mobile').click(); new Promise(r=>setTimeout(r,600)).then(()=>1)`);
    const sheet = await evaluate(ws, `(function(){ const d = document.querySelector('.drawer'); const r = d.getBoundingClientRect(); return { w: Math.round(r.width), winW: window.innerWidth, h: Math.round(r.height), winH: window.innerHeight, scrollable: d.querySelector('.drawer__body').scrollHeight >= d.querySelector('.drawer__body').clientHeight - 5 }; })()`);
    ok('mobile: sheet near full width', sheet.w >= sheet.winW - 4, JSON.stringify(sheet));
    ok('mobile: sheet height <= 80vh', sheet.h <= sheet.winH * 0.82 + 4, JSON.stringify(sheet));

    ws.send({ id: 913, method: 'Page.captureScreenshot', params: { format: 'png' } });
    for (;;) { const m = await ws.next(); if (m.id === 913) { fs.writeFileSync(path.join(tmp, 'mobile-sheet-open.png'), Buffer.from(m.result.data, 'base64')); break; } }

    await evaluate(ws, `document.querySelector('.drawer-root .drawer__close').click(); new Promise(r=>setTimeout(r,500)).then(()=>1)`);
    const xClosed = await evaluate(ws, `!document.querySelector('.drawer-root').classList.contains('is-open')`);
    ok('mobile: X button closes sheet', xClosed);

    await evaluate(ws, `document.querySelector('.owner-card [data-open-drawer="question"]').click(); new Promise(r=>setTimeout(r,350)).then(()=>1)`);
    const mobileForm = await evaluate(ws, `(function(){
      const q = document.querySelector('[data-drawer-view="question"]');
      const grid = getComputedStyle(document.querySelector('.question-form__grid')).gridTemplateColumns.split(' ').length;
      const input = document.getElementById('question-name').getBoundingClientRect();
      return { visible: !q.hidden, columns: grid, inputHeight: Math.round(input.height), scrollable: document.querySelector('.drawer__body').scrollHeight > document.querySelector('.drawer__body').clientHeight };
    })()`);
    ok('mobile: question form uses one column and tap-friendly inputs', mobileForm.visible && mobileForm.columns === 1 && mobileForm.inputHeight >= 44, JSON.stringify(mobileForm));
    ok('mobile: question form scrollable in sheet', mobileForm.scrollable === true, JSON.stringify({ scrollable: mobileForm.scrollable }));
    await evaluate(ws, `document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); new Promise(r=>setTimeout(r,300)).then(()=>1)`);

    // stacked layouts
    const stacked = await evaluate(ws, `(function(){
      const cols = s => getComputedStyle(document.querySelector(s)).gridTemplateColumns.split(' ').length;
      return { hero1: cols('.hero__grid') === 1, services1: cols('.services__grid') === 1, process1: cols('.process__grid') === 1 };
    })()`);
    ok('mobile: hero/services/process stacked', stacked.hero1 && stacked.services1 && stacked.process1, JSON.stringify(stacked));

    const errs2 = await evaluate(ws, `window.__errors || []`);
    ok('mobile: no runtime errors', errs2.length === 0, JSON.stringify(errs2));

    ws.send({ id: 914, method: 'Page.captureScreenshot', params: { format: 'png' } });
    for (;;) { const m = await ws.next(); if (m.id === 914) { fs.writeFileSync(path.join(tmp, 'mobile-top.png'), Buffer.from(m.result.data, 'base64')); break; } }

    ws.close();

    killTree(proc);
  }

  // ---------- Tablet ----------
  {
    const { proc, ws } = await runSession(9225, 834, 1112, false);
    const tab = await evaluate(ws, `(function(){
      const proj = document.querySelector('[data-preview-section="projects"]');
      const projectsHidden = !proj || proj.hidden;
      const cols = s => { const el = document.querySelector(s); return el ? getComputedStyle(el).gridTemplateColumns.split(' ').length : null; };
      return {
        trust2: cols('.trust-bar__list') === 2,
        proj2: projectsHidden ? null : cols('.projects__collage') === 2,
        process2: cols('.process__grid') === 2,
        projectsHidden
      };
    })()`);
    // Projects render only when real data exists; the collage is 2-col
    // only when the section is actually shown.
    ok('tablet: 2-col trust/process; projects 2-col or hidden', tab.trust2 && tab.process2 && (tab.projectsHidden || tab.proj2 === true), JSON.stringify(tab));
    ws.close();
    killTree(proc);
  }

  // ---------- Data-model: populated-data render (conditional sections, fallbacks) ----------
  {
    const { proc, ws } = await runSession(9226, 1280, 900, false);
    await evaluate(ws, `window.__errors = []; window.onerror = function(m){ window.__errors.push(String(m)); }; 1`);
    await wait(300);

    // Re-render the SAME document with a fully populated dataset.
    const populated = await evaluate(ws, `(function(){
      window.renderPreview({
        business: { name: 'Juniper Woodworks', city: 'Sisters', state: 'OR', stateName: 'Oregon', phone: '541-555-0144' },
        claims: [{ text: 'Licensed & insured', icon: 'check' }, { text: '15 years in Central Oregon', icon: 'pin' }],
        hero: { eyebrow: 'Custom · Carpentry · Remodels', headline: 'Craftsmanship for <em>high-desert</em> homes.', lede: 'Built-to-last carpentry.', badgeTitle: 'On-time builds', badgeSub: 'Clear schedules' },
        services: [
          { icon: 'kitchen', title: 'Custom Cabinetry', copy: 'Built-ins and cabinets made to measure.' },
          { icon: 'bathroom', title: 'Decks & Pergolas', copy: 'Outdoor structures that last.' }
        ],
        projects: [
          { label: 'Featured remodel', caption: 'Featured remodel', highlights: ['White-oak stairs', 'Full kitchen re-face'] },
          { label: 'Deck rebuild', caption: 'Deck rebuild' }
        ],
        images: {
          hero: { url: 'https://images.example.com/juniper-hero.jpg', alt: 'Owner photo' },
          projectFeatured: { url: 'https://images.example.com/juniper-featured.jpg' },
          projectKitchen: { url: 'https://images.example.com/juniper-kitchen.jpg', alt: 'Provided by business' }
        },
        process: [{ title: 'Say hello', copy: 'Reach out.' }, { title: 'Design', copy: 'We plan it.' }, { title: 'Build', copy: 'We build it.' }],
        reviews: [{ quote: 'Flawless work on our deck.', attribution: 'Dana R.' }],
        serviceArea: { lede: 'Sisters and surrounding communities.', communities: ['Sisters', 'Bend'] },
        finalCta: { eyebrow: 'Estimates', headline: 'Start your build?', copy: 'Tell us about it.', micro: 'No obligation.' }
      });
      return 1;
    })()`);
    await wait(400);

    const pop = await evaluate(ws, `(function(){
      const q = s => document.querySelector(s);
      const qa = s => document.querySelectorAll(s);
      return {
        nameFirst: q('.wordmark__name').textContent,
        nameRest: q('.wordmark__tag').textContent,
        title: document.title,
        phone: q('.site-header__phone span').textContent,
        phoneHref: q('.site-header__phone').getAttribute('href'),
        businessInput: document.getElementById('question-business').value,
        heroHeadline: q('.hero__title').textContent,
        heroImg: (function(){ const i = q('[data-preview-img="hero"] img[data-preview-img-img]'); return i ? { src: i.getAttribute('src'), alt: i.getAttribute('alt'), isImg: i.parentElement.classList.contains('is-img'), roleGone: !i.parentElement.hasAttribute('role') } : null; })(),
        projImgs: Array.from(qa('.projects__collage .ph--proj')).map(function (f) {
          const i = f.querySelector('img[data-preview-img-img]');
          return { slot: f.getAttribute('data-preview-img'), src: i ? i.getAttribute('src') : '', alt: f.getAttribute('aria-label') };
        }),
        claimCount: qa('[data-preview-list="claims"] .trust-item').length,
        claimTexts: Array.from(qa('[data-preview-list="claims"] .trust-item span:last-of-type')).map(e => e.textContent),
        serviceCount: qa('.service-card').length,
        serviceTitles: Array.from(qa('.service-card .service-card__title')).map(e => e.textContent),
        projectCount: qa('.projects__collage .ph--proj').length,
        featuredFirst: qa('.projects__collage .ph--proj')[0].classList.contains('ph--proj-featured'),
        processCount: qa('.process-step').length,
        processNums: Array.from(qa('.process-step__num')).map(e => e.textContent),
        reviewCount: qa('.review-card').length,
        reviewQuote: q('.review-card__quote').textContent,
        reviewAttribution: q('.review-card__chip').textContent,
        areaChips: Array.from(qa('.area-chips li')).map(e => e.textContent),
        claimsVisible: !q('[data-preview-section="claims"]').hidden,
        projectsVisible: !q('[data-preview-section="projects"]').hidden,
        reviewsVisible: !q('[data-preview-section="reviews"]').hidden,
        areaVisible: !q('[data-preview-list="serviceArea.communities"]').hidden,
        areaVisibleComputed: getComputedStyle(q('[data-preview-list="serviceArea.communities"]')).display !== 'none',
        projHighlights: Array.from(qa('.project-highlights li')).map(e => e.textContent),
        projHighlightsVisible: getComputedStyle(q('[data-preview-list="projectHighlights"]')).display !== 'none',
        heroEm: !!q('.hero__title em'),
        areaChipLabel: (q('.map-ph .ph__chip') || {}).textContent || '',
        navVisible: ['services','projects','reviews'].map(k => !document.querySelector('[data-preview-nav="' + k + '"]').hidden),
        servicesAnchor: q('[data-preview-services-anchor]').getAttribute('href'),
        servicesAnchorText: q('[data-preview-services-anchor]').textContent,
        noLeaks: document.body.textContent.indexOf('Real customer review goes here') === -1
              && document.body.textContent.indexOf('Customer name') === -1
              && document.body.textContent.indexOf('Featured remodel image area') === -1
              && document.body.textContent.indexOf('Kitchen Remodeling') === -1
              && document.body.textContent.indexOf('Beautiful, practical') === -1
      };
    })()`);
    ok('populated: wordmark splits business name', pop.nameFirst === 'Juniper' && pop.nameRest === 'Woodworks', JSON.stringify({ nameFirst: pop.nameFirst, nameRest: pop.nameRest }));
    ok('populated: title built from business + city/state', pop.title === 'Juniper Woodworks \u2014 Sisters, Oregon (Preview)', pop.title);
    ok('populated: phone text + tel href from data', pop.phone === '541-555-0144' && pop.phoneHref === 'tel:5415550144', JSON.stringify({ phone: pop.phone, href: pop.phoneHref }));
    ok('populated: question form business field from data', pop.businessInput === 'Juniper Woodworks', pop.businessInput);
    ok('populated: hero headline HTML trusted (em kept)', pop.heroHeadline.indexOf('high-desert') !== -1, pop.heroHeadline);
    ok('populated: claims render with icon + text', pop.claimsVisible && pop.claimCount === 2 && pop.claimTexts[0] === 'Licensed & insured' && pop.claimTexts[1] === '15 years in Central Oregon', JSON.stringify({ count: pop.claimCount, texts: pop.claimTexts }));
    ok('populated: services render from data', pop.serviceCount === 2 && pop.serviceTitles[0] === 'Custom Cabinetry' && pop.serviceTitles[1] === 'Decks & Pergolas', JSON.stringify(pop.serviceTitles));
    ok('populated: projects render, first is featured', pop.projectsVisible && pop.projectCount === 2 && pop.featuredFirst, JSON.stringify({ count: pop.projectCount, featuredFirst: pop.featuredFirst }));
    ok('populated: process steps renumbered 01-03', pop.processCount === 3 && pop.processNums.join(',') === '01,02,03', JSON.stringify(pop.processNums));
    ok('populated: reviews render quote + attribution', pop.reviewsVisible && pop.reviewCount === 1 && pop.reviewQuote === 'Flawless work on our deck.' && pop.reviewAttribution === 'Dana R.', JSON.stringify({ count: pop.reviewCount, quote: pop.reviewQuote, attr: pop.reviewAttribution }));
    ok('populated: area chips render and show (property + computed)', pop.areaVisible && pop.areaVisibleComputed && pop.areaChips.join(',') === 'Sisters,Bend', JSON.stringify(pop.areaChips));
    ok('populated: hero headline keeps its em node', pop.heroEm, pop.heroHeadline);
    ok('populated: project highlights come from data (first project)', pop.projHighlightsVisible && pop.projHighlights.join('|') === 'White-oak stairs|Full kitchen re-face', JSON.stringify(pop.projHighlights));
    ok('populated: map chip label follows data', pop.areaChipLabel === 'Sisters service area', pop.areaChipLabel);
    ok('populated: nav links appear for populated sections', pop.navVisible[0] && pop.navVisible[1] && pop.navVisible[2], JSON.stringify(pop.navVisible));
    ok('populated: services anchor retargeted + relabeled', pop.servicesAnchor === '#services' && pop.servicesAnchorText === 'View Services', JSON.stringify({ href: pop.servicesAnchor, text: pop.servicesAnchorText }));
    ok('populated: no template slots leak into output', pop.noLeaks);

    // Image slot overrides (JUS-52): hero + collage positional slots.
    ok('populated: hero override renders as img with custom alt', pop.heroImg && pop.heroImg.src === 'https://images.example.com/juniper-hero.jpg' && pop.heroImg.alt === 'Owner photo' && pop.heroImg.isImg && pop.heroImg.roleGone, JSON.stringify(pop.heroImg));
    ok('populated: collage slots assigned by position (featured/kitchen/bath/whole-home)', pop.projImgs.length === 2 && pop.projImgs[0].slot === 'projectFeatured' && pop.projImgs[1].slot === 'projectKitchen', JSON.stringify(pop.projImgs));
    ok('populated: featured + kitchen overrides render; safe fallback alts where blank', pop.projImgs[0].src === 'https://images.example.com/juniper-featured.jpg' && pop.projImgs[0].alt === 'Home remodeling inspiration image' && pop.projImgs[1].src === 'https://images.example.com/juniper-kitchen.jpg' && pop.projImgs[1].alt === 'Provided by business', JSON.stringify(pop.projImgs));

    // Placeholder restore: re-render without images -> line-art figure
    // comes back (no stuck img, no is-img class) on the same document.
    await evaluate(ws, `window.renderPreview({ business: { name: 'Juniper Woodworks', city: 'Sisters', state: 'OR' }, projects: [{ label: 'Featured remodel', caption: 'Featured remodel' }] }); 1`);
    await wait(300);
    const imgRestore = await evaluate(ws, `(function(){
      const q = s => document.querySelector(s);
      const qa = s => document.querySelectorAll(s);
      const heroFig = q('[data-preview-img="hero"]');
      const projFigs = qa('.projects__collage .ph--proj');
      return {
        heroNoImg: !heroFig.querySelector('img[data-preview-img-img]'),
        heroNoIsImg: !heroFig.classList.contains('is-img'),
        heroArtBack: !!heroFig.querySelector('.ph__art'),
        heroAlt: heroFig.getAttribute('aria-label'),
        projNoImg: Array.from(projFigs).every(function (f) { return !f.querySelector('img[data-preview-img-img]'); }),
        projSlots: Array.from(projFigs).map(function (f) { return f.getAttribute('data-preview-img'); })
      };
    })()`);
    ok('images: re-render without images restores styled placeholder (hero + collage)', imgRestore.heroNoImg && imgRestore.heroNoIsImg && imgRestore.heroArtBack && imgRestore.projNoImg, JSON.stringify(imgRestore));
    ok('images: placeholder alt stays generic inspiration wording', imgRestore.heroAlt === 'Home remodeling inspiration image', imgRestore.heroAlt);

    // Template-default tier (JUS-52): with no record override, a
    // configured default URL renders; clearing it restores placeholder.
    await evaluate(ws, `(function(){
      window.PreviewImageDefaults.TEMPLATE_DEFAULTS['remodeling-contractor-v1'].hero = { url: 'https://images.example.com/studio-default-hero.jpg', alt: 'Studio default hero' };
      window.renderPreview({ business: { name: 'Juniper Woodworks', city: 'Sisters', state: 'OR' } });
      return 1;
    })()`);
    await wait(300);
    const imgDefault = await evaluate(ws, `(function(){
      const fig = document.querySelector('[data-preview-img="hero"]');
      const img = fig.querySelector('img[data-preview-img-img]');
      return {
        src: img ? img.getAttribute('src') : '',
        alt: img ? img.getAttribute('alt') : '',
        aria: fig.getAttribute('aria-label'),
        isImg: fig.classList.contains('is-img')
      };
    })()`);
    ok('images: template default renders when no prospect override (tier 2)', imgDefault.src === 'https://images.example.com/studio-default-hero.jpg' && imgDefault.alt === 'Studio default hero' && imgDefault.isImg && imgDefault.aria === 'Studio default hero', JSON.stringify(imgDefault));
    await evaluate(ws, `(function(){
      window.PreviewImageDefaults.TEMPLATE_DEFAULTS['remodeling-contractor-v1'].hero = { url: '', alt: '' };
      window.renderPreview({ business: { name: 'Juniper Woodworks', city: 'Sisters', state: 'OR' } });
      return 1;
    })()`);
    await wait(300);
    const imgDefaultCleared = await evaluate(ws, `(function(){
      const fig = document.querySelector('[data-preview-img="hero"]');
      return { noImg: !fig.querySelector('img[data-preview-img-img]'), alt: fig.getAttribute('aria-label') };
    })()`);
    ok('images: cleared template default falls back to styled placeholder (tier 3)', imgDefaultCleared.noImg && imgDefaultCleared.alt === 'Home remodeling inspiration image', JSON.stringify(imgDefaultCleared));

    // Fallbacks: partial data — optional fields missing (no services on
    // purpose, so the anchor fallback path is exercised).
    const partial = await evaluate(ws, `(function(){
      window.renderPreview({
        business: { name: 'Solo Contractor', city: 'Redmond' },
        process: [{ title: 'Say hello', copy: 'Reach out.' }]
      });
      return 1;
    })()`);
    await wait(300);
    const fb = await evaluate(ws, `(function(){
      const q = s => document.querySelector(s);
      const qa = s => document.querySelectorAll(s);
      return {
        title: document.title,
        banner: q('.preview-banner__text--desktop').textContent,
        heroHeadline: q('.hero__title').textContent,
        heroLede: q('.hero__lede').textContent,
        location: q('.hero__location span[data-preview-key="hero.location"]').textContent,
        phoneSpan: q('.site-header__phone span').textContent,
        businessInput: document.getElementById('question-business').value,
        metaDesc: document.querySelector('meta[name="description"]').getAttribute('content'),
        claimCount: qa('[data-preview-list="claims"] .trust-item').length,
        claimsHidden: q('[data-preview-section="claims"]').hidden,
        projectsHidden: q('[data-preview-section="projects"]').hidden,
        reviewsHidden: q('[data-preview-section="reviews"]').hidden,
        processHidden: q('[data-preview-section="process"]').hidden,
        processCount: qa('.process-step').length,
        processNums: Array.from(qa('.process-step__num')).map(e => e.textContent),
        processTitle: (q('.process-step__title') || {}).textContent || '',
        processCopy: (q('.process-step__copy') || {}).textContent || '',
        areaListHidden: q('[data-preview-list="serviceArea.communities"]').hidden,
        areaChipsCount: qa('.area-chips li').length,
        anchor: q('[data-preview-services-anchor]').getAttribute('href'),
        anchorText: q('[data-preview-services-anchor]').textContent,
        navReviewsHidden: document.querySelector('[data-preview-nav="reviews"]').hidden,
        visibleProcessCards: Array.prototype.filter.call(qa('.process-step'), function (el) { return getComputedStyle(el).display !== 'none'; }).length
      };
    })()`);
    ok('fallback: missing state omits comma in city line', fb.title === 'Solo Contractor \u2014 Redmond (Preview)', fb.title);
    ok('fallback: banner/hero use neutral defaults', /Preview prepared for Solo Contractor/.test(fb.banner) && fb.heroHeadline.indexOf('Redmond') !== -1 && fb.heroLede.length > 10, JSON.stringify({ banner: fb.banner, headline: fb.heroHeadline }));
    ok('fallback: location line defaults to city only', fb.location === 'Serving Redmond and nearby communities.', fb.location);
    ok('fallback: missing phone leaves header phone empty (no fake data)', fb.phoneSpan === '', 'phone=' + JSON.stringify(fb.phoneSpan));
    ok('fallback: form input .value synced from data (property, not just attribute)', fb.businessInput === 'Solo Contractor', 'input=' + JSON.stringify(fb.businessInput));
    ok('fallback: meta description refreshed from fallback copy', fb.metaDesc.indexOf('Redmond') !== -1 && fb.metaDesc.indexOf('Bend') === -1, fb.metaDesc);
    ok('fallback: claims/projects/reviews hidden when absent', fb.claimsHidden && fb.projectsHidden && fb.reviewsHidden, JSON.stringify({ claims: fb.claimsHidden, projects: fb.projectsHidden, reviews: fb.reviewsHidden }));
    ok('fallback: process section renders single replacement step', !fb.processHidden && fb.processCount === 1 && fb.processNums.join(',') === '01' && fb.processTitle === 'Say hello' && fb.processCopy === 'Reach out.', JSON.stringify({ count: fb.processCount, nums: fb.processNums, title: fb.processTitle, copy: fb.processCopy }));
    ok('fallback: re-rendered step is actually visible (reveal-safe)', fb.visibleProcessCards === 1, String(fb.visibleProcessCards));
    ok('fallback: empty communities restore pristine template and hide list', fb.areaListHidden && fb.areaChipsCount === 1, JSON.stringify({ hidden: fb.areaListHidden, chips: fb.areaChipsCount }));
    ok('fallback: services anchor falls back to contact', fb.anchor === '#contact' && fb.anchorText === 'Get in Touch', JSON.stringify({ href: fb.anchor, text: fb.anchorText }));
    ok('fallback: nav for absent sections re-hides', fb.navReviewsHidden);

    // Second re-render with an EMPTY object: every value the previous
    // datasets filled must be cleared, even without any data at all.
    await evaluate(ws, `window.renderPreview({}); 1`);
    await wait(300);
    const fb2 = await evaluate(ws, `(function(){
      const q = s => document.querySelector(s);
      return {
        title: document.title,
        heroHeadline: q('.hero__title').textContent,
        phoneSpan: q('.site-header__phone span').textContent,
        businessInput: document.getElementById('question-business').value,
        processCount: q('[data-preview-section="process"]').hidden ? 0 : document.querySelectorAll('.process-step').length,
        areaChipsVisible: getComputedStyle(q('[data-preview-list="serviceArea.communities"]')).display === 'none',
        servicesAnchor: q('[data-preview-services-anchor]').getAttribute('href'),
        wordmark: q('.wordmark__name').textContent + '|' + q('.wordmark__tag').textContent
      };
    })()`);
    ok('fallback: empty re-render clears title/wordmark to neutral defaults', fb2.title === 'This Business \u2014 your area (Preview)' && fb2.wordmark === 'This|Business', JSON.stringify({ title: fb2.title, wordmark: fb2.wordmark }));
    ok('fallback: empty re-render clears hero + phone; wordmark/input neutralized', fb2.heroHeadline === 'Remodeling for your area homeowners.' && fb2.phoneSpan === '' && fb2.businessInput === 'This Business' && fb2.wordmark === 'This|Business', JSON.stringify({ hero: fb2.heroHeadline, phone: fb2.phoneSpan, input: fb2.businessInput, wordmark: fb2.wordmark }));
    ok('fallback: empty re-render hides process + area, anchor hits contact', fb2.processCount === 0 && fb2.areaChipsVisible && fb2.servicesAnchor === '#contact', JSON.stringify({ process: fb2.processCount, areaHidden: fb2.areaChipsVisible, anchor: fb2.servicesAnchor }));

    // Image slots under empty re-render (JUS-52): still placeholder,
    // never broken — the third tier always renders.
    const fb3 = await evaluate(ws, `(function(){
      const heroFig = document.querySelector('[data-preview-img="hero"]');
      return {
        noImg: !heroFig.querySelector('img[data-preview-img-img]'),
        artVisible: getComputedStyle(heroFig.querySelector('.ph__art')).display !== 'none',
        alt: heroFig.getAttribute('aria-label')
      };
    })()`);
    ok('images: empty render keeps hero placeholder visible + safe alt', fb3.noImg && fb3.artVisible && fb3.alt === 'Home remodeling inspiration image', JSON.stringify(fb3));

    const errs3 = await evaluate(ws, `window.__errors || []`);
    ok('populated: no runtime errors during re-renders', errs3.length === 0, JSON.stringify(errs3));

    ws.close();

    killTree(proc);
  }

  // ---------- Data-model: FIRST-render fallback (minimal page, no data file) ----------
  {
    const { proc, ws } = await runSession(9227, 1280, 900, false);
    await evaluate(ws, `location.href = 'http://127.0.0.1:${PORT}/minimal.html'`);
    await waitReady(ws, '.preview-banner', 20000);
    await wait(500);
    await evaluate(ws, `window.__errors = []; window.onerror = function(m){ window.__errors.push(String(m)); }; 1`);

    // minimal.html = index.html minus preview-data.js: the renderer's
    // very first render runs with NO data. Nothing from the template
    // business (Cascade) may survive: phone, title, meta, claims.
    const first = await evaluate(ws, `(function(){
      const q = s => document.querySelector(s);
      const qa = s => document.querySelectorAll(s);
      return {
        rendered: document.documentElement.getAttribute('data-preview-rendered'),
        title: document.title,
        phoneHeader: q('.site-header__phone span').textContent,
        phoneFooter: q('.site-footer__phone span').textContent,
        phoneFinalCtaHref: (function(){ var a = q('.final-cta a[data-preview-key="business.phoneHref"]'); return a ? a.getAttribute('href') : null; })(),
        metaDesc: document.querySelector('meta[name="description"]').getAttribute('content'),
        wordmark: q('.wordmark__name').textContent + '|' + q('.wordmark__tag').textContent,
        businessInput: document.getElementById('question-business').value,
        claimsVisible: getComputedStyle(q('[data-preview-section="claims"]')).display !== 'none',
        claimCount: qa('[data-preview-list="claims"] .trust-item').length,
        projectsVisible: getComputedStyle(q('[data-preview-section="projects"]')).display !== 'none',
        reviewsVisible: getComputedStyle(q('[data-preview-section="reviews"]')).display !== 'none',
        servicesVisible: getComputedStyle(q('[data-preview-section="services"]')).display !== 'none',
        serviceCount: qa('.service-card').length,
        servicesAnchor: q('[data-preview-services-anchor]').getAttribute('href'),
        servicesAnchorText: q('[data-preview-services-anchor]').textContent,
        visibleNavLinks: Array.prototype.filter.call(qa('.site-nav__link'), function (a) { return !a.closest('li[hidden]'); }).length,
        phoneAttrLeak: document.body.innerHTML.indexOf('541-555-0198') !== -1,
        phoneHrefLeak: !!q('a[href="tel:5415550198"]'),
        cascadeLeak: document.body.textContent.indexOf('Cascade') !== -1 || document.title.indexOf('Cascade') !== -1,
        heroHeadline: q('.hero__title').textContent
      };
    })()`);
    ok('first-render: renderer completes without data file', first.rendered === 'true');
    ok('first-render: title falls back to neutral default (no Cascade)', first.title === 'This Business \u2014 your area (Preview)', first.title);
    ok('first-render: wordmark falls back to neutral default', first.wordmark === 'This|Business', first.wordmark);
    ok('first-render: phone text cleared in header/footer; CTA tel: href removed', first.phoneHeader === '' && first.phoneFooter === '' && first.phoneFinalCtaHref === null, JSON.stringify({ header: first.phoneHeader, footer: first.phoneFooter, ctaHref: first.phoneFinalCtaHref }));
    ok('first-render: no Cascade phone number or tel: href anywhere', !first.phoneAttrLeak && !first.phoneHrefLeak);
    ok('first-render: meta description uses neutral fallback (no Bend)', first.metaDesc.indexOf('your area') !== -1 && first.metaDesc.indexOf('Bend') === -1, first.metaDesc);
    ok('first-render: question form business input falls back to neutral name', first.businessInput === 'This Business', JSON.stringify(first.businessInput));
    ok('first-render: claims/projects/reviews sections stay hidden', !first.claimsVisible && !first.projectsVisible && !first.reviewsVisible, JSON.stringify({ claims: first.claimsVisible, projects: first.projectsVisible, reviews: first.reviewsVisible }));
    ok('first-render: services hidden too (no data, not template data)', !first.servicesVisible && first.serviceCount === 1, JSON.stringify({ visible: first.servicesVisible, cards: first.serviceCount }));
    ok('first-render: services anchor falls back to contact', first.servicesAnchor === '#contact' && first.servicesAnchorText === 'Get in Touch', JSON.stringify({ href: first.servicesAnchor, text: first.servicesAnchorText }));
    ok('first-render: only contact nav link visible', first.visibleNavLinks === 1, String(first.visibleNavLinks));
    ok('first-render: hero uses neutral city default', first.heroHeadline === 'Remodeling for your area homeowners.', first.heroHeadline);
    ok('first-render: zero Cascade-brand leakage in text', !first.cascadeLeak);

    const errs4 = await evaluate(ws, `window.__errors || []`);
    ok('first-render: no runtime errors', errs4.length === 0, JSON.stringify(errs4));

    ws.close();

    killTree(proc);
  }

  // ---------- Service detail modal (desktop) ----------
  {
    const { proc, ws } = await runSession(9228, 1280, 900, false);
    await evaluate(ws, `window.__errors = []; window.onerror = function(m){ window.__errors.push(String(m)); }; 1`);
    await wait(200);

    // Default data: all 3 Cascade services carry detail objects.
    const base = await evaluate(ws, `(function(){
      const qa = s => document.querySelectorAll(s);
      return {
        moreLinks: qa('.service-card__more').length,
        hiddenMore: Array.from(qa('.service-card__more')).filter(a => a.hidden).length,
        modalExists: !!document.getElementById('service-detail'),
        modalClosed: document.getElementById('service-detail').getAttribute('aria-hidden') === 'true',
        modalNotOpen: !document.getElementById('service-detail').classList.contains('is-open'),
        triggerAria: (qa('.service-card__more')[0] || {}).getAttribute ? qa('.service-card__more')[0].getAttribute('aria-label') : null
      };
    })()`);
    ok('svc-detail: 3 Learn More triggers rendered, none hidden (detail data present)', base.moreLinks === 3 && base.hiddenMore === 0, JSON.stringify({ links: base.moreLinks, hidden: base.hiddenMore }));
    ok('svc-detail: modal present in DOM, closed by default', base.modalExists && base.modalClosed && base.modalNotOpen);
    ok('svc-detail: trigger carries service-specific aria-label', base.triggerAria === 'Learn more about Kitchen Remodeling', base.triggerAria);

    // Open the SECOND service's detail (Bathroom) via a real click.
    // Scroll must NOT move: the page stays exactly where it was so
    // users can click through modals without being jumped.
    const scrollBeforeOpen = await evaluate(ws, `window.scrollY`);
    await evaluate(ws, `document.querySelectorAll('.service-card__more')[1].click(); 1`);
    await wait(450);
    const scrollStable = await evaluate(ws, `window.scrollY`);
    ok('svc-detail: opening a modal does not scroll the page', Math.abs(scrollStable - scrollBeforeOpen) < 2, JSON.stringify({ before: scrollBeforeOpen, after: scrollStable }));
    const opened = await evaluate(ws, `(function(){
      const q = s => document.querySelector(s);
      const r = document.getElementById('service-detail');
      return {
        open: r.classList.contains('is-open'),
        aria: r.getAttribute('aria-hidden'),
        bodyLocked: document.body.style.overflow === 'hidden',
        title: q('.service-detail__title').textContent,
        copy: q('.service-detail__copy').textContent,
        bullets: Array.from(q('.service-detail__bullets').querySelectorAll('li')).map(e => e.textContent),
        fit: q('.service-detail__fit').textContent,
        fitVisible: !q('.service-detail__fit').hidden,
        focused: document.activeElement.className,
        dialogRole: q('.service-detail').getAttribute('role'),
        ariaLabelledBy: q('.service-detail').getAttribute('aria-labelledby')
      };
    })()`);
    ok('svc-detail: modal opens on Learn More click (aria + body lock)', opened.open && opened.aria === 'false' && opened.bodyLocked, JSON.stringify({ open: opened.open, aria: opened.aria, locked: opened.bodyLocked }));
    ok('svc-detail: content filled from the clicked service entry', opened.title === 'Bathrooms that stay practical and feel finished' && opened.copy.indexOf('waterproofing') !== -1 && opened.bullets.length === 4, JSON.stringify({ title: opened.title, bullets: opened.bullets.length }));
    ok('svc-detail: good-fit statement shows', opened.fitVisible && opened.fit.indexOf('A good fit') === 0, opened.fit);
    ok('svc-detail: dialog semantics + focus moves to title', opened.dialogRole === 'dialog' && opened.ariaLabelledBy === 'service-detail-title' && /service-detail__title/.test(opened.focused), JSON.stringify({ role: opened.dialogRole, by: opened.ariaLabelledBy, focused: opened.focused }));

    // CTA: closes the modal and lets the page scroll to #contact.
    const scrollBefore = await evaluate(ws, `window.scrollY`);
    await evaluate(ws, `document.querySelector('[data-service-detail-cta]').click(); new Promise(r=>setTimeout(r,700)).then(()=>1)`);
    const afterCta = await evaluate(ws, `(function(){
      const r = document.getElementById('service-detail');
      return {
        open: r.classList.contains('is-open'),
        aria: r.getAttribute('aria-hidden') === 'true',
        bodyUnlocked: document.body.style.overflow === '',
        scrolled: window.scrollY > ${scrollBefore} + 100,
        focusReturned: document.activeElement.className
      };
    })()`);
    ok('svc-detail: CTA closes modal and scrolls to #contact', !afterCta.open && afterCta.aria && afterCta.bodyUnlocked && afterCta.scrolled, JSON.stringify(afterCta));

    // Re-open (focus target = second Learn More), then close via Escape.
    await evaluate(ws, `window.scrollTo(0, 0); document.querySelectorAll('.service-card__more')[1].click(); new Promise(r=>setTimeout(r,450)).then(()=>1)`);
    await key(ws, 'Escape');
    await wait(450);
    const afterEsc = await evaluate(ws, `(function(){
      const r = document.getElementById('service-detail');
      return {
        open: r.classList.contains('is-open'),
        focusReturned: document.activeElement.className,
        focusIndex: Array.prototype.indexOf.call(document.querySelectorAll('.service-card__more'), document.activeElement)
      };
    })()`);
    ok('svc-detail: Escape closes modal', !afterEsc.open, JSON.stringify(afterEsc));
    ok('svc-detail: focus returns to the triggering Learn More button', afterEsc.focusIndex === 1, JSON.stringify({ idx: afterEsc.focusIndex, cls: afterEsc.focusReturned }));

    // Stale-content guard: content is cleared shortly after close, and
    // opening a DIFFERENT service never shows the previous one.
    await wait(450);
    const cleared = await evaluate(ws, `(function(){
      const q = s => document.querySelector(s);
      return { title: q('.service-detail__title').textContent, bullets: q('.service-detail__bullets').children.length };
    })()`);
    ok('svc-detail: content cleared after close (no stale data)', cleared.title === '' && cleared.bullets === 0, JSON.stringify(cleared));

    await evaluate(ws, `document.querySelectorAll('.service-card__more')[0].click(); new Promise(r=>setTimeout(r,450)).then(()=>1)`);
    const reopened = await evaluate(ws, `(function(){
      const q = s => document.querySelector(s);
      return { open: document.getElementById('service-detail').classList.contains('is-open'), title: q('.service-detail__title').textContent };
    })()`);
    ok('svc-detail: reopening a different service shows ITS content', reopened.open && reopened.title === 'Kitchen remodels, planned around how you cook', reopened.title);

    // Backdrop click closes + focus return.
    await evaluate(ws, `document.querySelector('.service-detail-backdrop').click(); new Promise(r=>setTimeout(r,450)).then(()=>1)`);
    const afterBackdrop = await evaluate(ws, `(function(){
      return {
        open: document.getElementById('service-detail').classList.contains('is-open'),
        focusIndex: Array.prototype.indexOf.call(document.querySelectorAll('.service-card__more'), document.activeElement)
      };
    })()`);
    ok('svc-detail: backdrop click closes; focus returns to trigger', !afterBackdrop.open && afterBackdrop.focusIndex === 0, JSON.stringify(afterBackdrop));

    // Re-render with a dataset whose services have NO detail fields:
    // links hide, modal resets, nothing stale survives.
    await evaluate(ws, `window.renderPreview({
      business: { name: 'Plain Painter', city: 'Redmond' },
      services: [
        { icon: 'kitchen', title: 'Interior Painting', copy: 'Walls, ceilings, trim.' },
        { icon: 'bathroom', title: 'Cabinet Refinishing', copy: 'Sprayed finishes.' }
      ]
    }); 1`);
    await wait(400);
    const afterRender = await evaluate(ws, `(function(){
      const qa = s => document.querySelectorAll(s);
      const q = s => document.querySelector(s);
      return {
        cardCount: qa('.service-card').length,
        moreVisible: Array.from(qa('.service-card__more')).filter(a => !a.hidden).length,
        modalOpen: document.getElementById('service-detail').classList.contains('is-open'),
        modalTitle: q('.service-detail__title').textContent,
        noLeak: document.body.textContent.indexOf('Kitchen remodels, planned') === -1
      };
    })()`);
    ok('svc-detail: re-render hides Learn More when detail absent', afterRender.cardCount === 2 && afterRender.moreVisible === 0, JSON.stringify({ cards: afterRender.cardCount, visible: afterRender.moreVisible }));
    ok('svc-detail: re-render resets modal, no stale content', !afterRender.modalOpen && afterRender.modalTitle === '' && afterRender.noLeak, JSON.stringify({ open: afterRender.modalOpen, title: afterRender.modalTitle, noLeak: afterRender.noLeak }));

    const errs5 = await evaluate(ws, `window.__errors || []`);
    ok('svc-detail: no runtime errors', errs5.length === 0, JSON.stringify(errs5));

    ws.close();

    killTree(proc);
  }

  // ---------- Service detail modal (mobile) ----------
  {
    const { proc, ws } = await runSession(9229, 390, 844, true);
    await evaluate(ws, `window.__errors = []; window.onerror = function(m){ window.__errors.push(String(m)); }; 1`);
    await wait(200);

    await evaluate(ws, `document.querySelectorAll('.service-card__more')[2].click(); new Promise(r=>setTimeout(r,450)).then(()=>1)`);
    const m = await evaluate(ws, `(function(){
      const q = s => document.querySelector(s);
      const d = q('.service-detail');
      const r = d.getBoundingClientRect();
      return {
        open: document.getElementById('service-detail').classList.contains('is-open'),
        fullW: Math.round(r.width) >= window.innerWidth - 4,
        docked: Math.abs(r.top + r.height - window.innerHeight) <= 6,
        heightOk: r.height <= window.innerHeight * 0.82 + 4,
        scrollable: q('.service-detail__body').scrollHeight >= q('.service-detail__body').clientHeight - 5,
        title: q('.service-detail__title').textContent
      };
    })()`);
    ok('svc-detail mobile: opens as full-width bottom sheet', m.open && m.fullW && m.docked && m.heightOk, JSON.stringify(m));
    ok('svc-detail mobile: third service content (Whole-Home)', m.title === 'Coordinated updates, one schedule', m.title);

    await evaluate(ws, `document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true})); new Promise(r=>setTimeout(r,450)).then(()=>1)`);
    const mEsc = await evaluate(ws, `(function(){
      return {
        open: document.getElementById('service-detail').classList.contains('is-open'),
        unlocked: document.body.style.overflow === ''
      };
    })()`);
    ok('svc-detail mobile: Escape closes + unlocks scroll', !mEsc.open && mEsc.unlocked, JSON.stringify(mEsc));

    const errs6 = await evaluate(ws, `window.__errors || []`);
    ok('svc-detail mobile: no runtime errors', errs6.length === 0, JSON.stringify(errs6));

    ws.close();

    killTree(proc);
  }

  // ---------- Wizard session (JUS-45) ----------
  {
    const { proc, ws } = await runSession(9230, 1280, 900, false);
    ws.send({ id: 901, method: 'Runtime.evaluate', params: { expression: 'window.__errors = []; window.onerror = function(m){ window.__errors.push(String(m)); };', returnByValue: true } });

    // The wizard runs a fixed script flow; give its scripts a moment.
    await evaluate(ws, `location.href = 'http://127.0.0.1:${PORT}/wizard/index.html'`);
    await waitReady(ws, '#wizard-form', 20000);
    await wait(600);

    // 1. Wizard loads with 5 steps, step 1 visible, required marked.
    const wizBase = await evaluate(ws, `(function(){
      const q = s => document.querySelector(s);
      const qa = s => document.querySelectorAll(s);
      return {
        steps: qa('.wiz-step').length,
        currentStep: q('.wiz-step.is-current') && q('.wiz-step.is-current').getAttribute('data-step-nav'),
        panel0Visible: !q('[data-step-panel="0"]').hidden,
        panel5Hidden: q('[data-step-panel="5"]').hidden,
        imagesStepPresent: !!q('[data-step-panel="2"] #f-heroImageUrl') && !!q('[data-step-panel="2"] #f-projectWholeHomeImageUrl'),
        reqCount: qa('.wiz-req').length,
        reqKeys: ['businessName','city','state','trade'].every(k => !!q('[data-field="' + k + '"] .wiz-req')),
        backHidden: q('#btn-back').hidden,
        resultHidden: q('#wiz-result').hidden,
        draftRestored: JSON.stringify(window.__wizard.getState())
      };
    })()`);
    ok('wizard: opens on step 1 with 6 steps (Images added)', wizBase.steps === 6 && wizBase.currentStep === '0' && wizBase.panel0Visible && wizBase.panel5Hidden, JSON.stringify({ steps: wizBase.steps, panel5Hidden: wizBase.panel5Hidden }));
    ok('wizard: Images step has the five URL fields', wizBase.imagesStepPresent);
    ok('wizard: all 4 required fields marked with *', wizBase.reqCount === 4 && wizBase.reqKeys);
    ok('wizard: no result panel before generation', wizBase.resultHidden);

    // 2. Empty required fields BLOCK generation from review step.
    await evaluate(ws, `document.getElementById('btn-skip') ? document.getElementById('btn-skip').click() : document.getElementById('btn-next').click(); 1`);
    await wait(150);
    const blockedStep = await evaluate(ws, `(function(){
      document.getElementById('btn-next').click(); // step1 -> step2 (no reqs there)
      return window.__wizard.getStep();
    })()`);
    await evaluate(ws, `document.getElementById('btn-next').click(); 1`); // step2 -> step3 (Images)
    await wait(100);
    await evaluate(ws, `document.getElementById('btn-next').click(); 1`); // step3 -> step4
    await wait(100);
    await evaluate(ws, `document.getElementById('btn-next').click(); 1`); // step4 -> step5
    await wait(100);
    await evaluate(ws, `document.getElementById('btn-next').click(); 1`); // step5 -> review
    await wait(200);
    const reviewBlocked = await evaluate(ws, `(function(){
      const q = s => document.querySelector(s);
      return {
        step: window.__wizard.getStep(),
        blockedShown: !!q('.wiz-review__blocked'),
        generateDisabled: q('#btn-generate').getAttribute('aria-disabled') === 'true',
        slugMissing: q('#wiz-review').textContent.indexOf('needs required fields') !== -1,
        noResult: q('#wiz-result').hidden
      };
    })()`);
    ok('wizard: review shows blocked state when required fields empty', reviewBlocked.step === 5 && reviewBlocked.blockedShown && reviewBlocked.generateDisabled, JSON.stringify(reviewBlocked));
    ok('wizard: blocked review shows slug unavailable + no record', reviewBlocked.slugMissing && reviewBlocked.noResult);

    // 3. Generate from blocked review jumps back to step 1 with errors.
    await evaluate(ws, `document.getElementById('btn-generate').click(); new Promise(r=>setTimeout(r,150)).then(()=>1)`);
    const genBlocked = await evaluate(ws, `(function(){
      const q = s => document.querySelector(s);
      return {
        step: window.__wizard.getStep(),
        errFields: document.querySelectorAll('.has-error').length,
        errMsg: (q('[data-error-for="businessName"]') || {}).textContent || ''
      };
    })()`);
    ok('wizard: generate while blocked returns to step 1 with inline errors', genBlocked.step === 0 && genBlocked.errFields === 4 && /required/i.test(genBlocked.errMsg), JSON.stringify(genBlocked));

    // 4. Fill the happy path via the form fields (state binding).
    await evaluate(ws, `(function(){
      const set = (id, val) => { const el = document.getElementById(id); el.value = val; el.dispatchEvent(new Event('input', {bubbles:true})); };
      set('f-businessName', 'Cascade Home Remodeling');
      set('f-city', 'Bend');
      set('f-state', 'or');
      set('f-trade', 'remodeling');
      set('f-websiteUrl', 'https://example.com');
      return 1;
    })()`);
    await evaluate(ws, `document.getElementById('btn-next').click(); new Promise(r=>setTimeout(r,100)).then(()=>1)`); // -> step 2
    const step2 = await evaluate(ws, `(function(){
      const set = (id, val) => { const el = document.getElementById(id); el.value = val; el.dispatchEvent(new Event('input', {bubbles:true})); };
      set('f-services', 'Kitchen Remodeling\\nBathroom Remodeling|Whole-Home Updates');
      set('f-heroLede', 'Clear communication, clean work, straightforward experience.');
      return { step: window.__wizard.getStep() };
    })()`);
    ok('wizard: advanced to services step after required complete', step2.step === 1);
    await evaluate(ws, `(function(){
      const set = (id, val) => { const el = document.getElementById(id); el.value = val; el.dispatchEvent(new Event('input', {bubbles:true})); };
      set('f-heroLede', 'Clear communication, clean work, straightforward experience.');
      return 1;
    })()`);
    await evaluate(ws, `document.getElementById('btn-next').click(); new Promise(r=>setTimeout(r,100)).then(()=>1)`); // -> step 3 (Images)
    const step3img = await evaluate(ws, `(function(){
      const set = (id, val) => { const el = document.getElementById(id); el.value = val; el.dispatchEvent(new Event('input', {bubbles:true})); };
      set('f-heroImageUrl', 'https://images.example.com/cascade-hero.jpg');
      set('f-heroImageAlt', 'Owner-provided inspiration photo');
      set('f-projectKitchenImageUrl', 'javascript:alert(1)'); // invalid -> dropped
      return { step: window.__wizard.getStep() };
    })()`);
    ok('wizard: Images step entered, overrides entered (incl. invalid url)', step3img.step === 2);
    await evaluate(ws, `document.getElementById('btn-next').click(); 1`); // -> step 4
    await evaluate(ws, `(function(){
      const set = (id, val) => { const el = document.getElementById(id); el.value = val; el.dispatchEvent(new Event('input', {bubbles:true})); };
      set('f-phone', '541-555-0198');
      set('f-serviceAreas', 'Bend|Redmond\\nSisters');
      set('f-licenseNumber', 'CCB-204555');
      return 1;
    })()`);
    await evaluate(ws, `document.getElementById('btn-next').click(); 1`); // -> step 5
    await evaluate(ws, `document.getElementById('btn-next').click(); 1`); // -> review
    await wait(200);

    // 5. Review reflects entered data + computed slug + status.
    const review = await evaluate(ws, `(function(){
      const q = s => document.querySelector(s);
      const t = q('#wiz-review').textContent;
      return {
        step: window.__wizard.getStep(),
        name: t.indexOf('Cascade Home Remodeling') !== -1,
        cityState: t.indexOf('Bend') !== -1 && t.indexOf('or') !== -1,
        trade: t.indexOf('remodeling') !== -1,
        services: t.indexOf('Kitchen Remodeling') !== -1 && t.indexOf('Whole-Home Updates') !== -1,
        phone: t.indexOf('541-555-0198') !== -1,
        areas: t.indexOf('Redmond') !== -1 && t.indexOf('Sisters') !== -1,
        slug: t.indexOf('cascade-home-remodeling-bend-or') !== -1,
        status: (q('#wiz-review').textContent.match(/Status/) && true),
        noBlocked: !q('.wiz-review__blocked'),
        warnings: !!q('.wiz-review__warnings'),
        imgSection: t.indexOf('Images') !== -1,
        imgHeroOverride: t.indexOf('prospect override') !== -1 && t.indexOf('cascade-hero.jpg') !== -1,
        imgPlaceholder: t.indexOf('placeholder') !== -1,
        imgKitchenDropped: t.indexOf('javascript:') === -1
      };
    })()`);
    ok('wizard: review shows business + services + contact + areas', review.name && review.cityState && review.trade && review.services && review.phone && review.areas, JSON.stringify(review));
    ok('wizard: review shows computed slug + status + warnings, not blocked', review.slug && review.status && review.noBlocked && review.warnings);
    ok('wizard: review Images section shows override/placeholder resolution', review.imgSection && review.imgHeroOverride && review.imgPlaceholder, JSON.stringify({ section: review.imgSection, hero: review.imgHeroOverride, placeholder: review.imgPlaceholder }));
    ok('wizard: invalid image URL never reaches review output', review.imgKitchenDropped);

    // 6. Generate the record.
    await evaluate(ws, `document.getElementById('btn-generate').click(); new Promise(r=>setTimeout(r,250)).then(()=>1)`);
    const generated = await evaluate(ws, `(function(){
      const q = s => document.querySelector(s);
      const rec = window.__wizard.getRecord();
      return {
        resultShown: !q('#wiz-result').hidden,
        resId: q('#res-id').textContent,
        resSlug: q('#res-slug').textContent,
        resStatus: q('#res-status').textContent,
        recId: rec && rec.id,
        recSlug: rec && rec.slug,
        recStatus: rec && rec.status,
        recState: rec && rec.business.state,
        recPhoneHref: rec && rec.business.phoneHref,
        recServices: rec && rec.services.items.length,
        recCommunities: rec && JSON.stringify(rec.serviceArea.communities),
        recLicense: rec && rec.metadata.licenseNumber,
        recClaims: rec && rec.claims.length,
        recReviews: rec && rec.reviews.items.length,
        recProjects: rec && rec.projects.items.length,
        recMeta: rec && !!rec.meta.title && !!rec.meta.description,
        recHero: rec && !!rec.hero.headline && !!rec.hero.lede,
        recCta: rec && !!rec.finalCta.headline && !!rec.finalCta.copy && !!rec.finalCta.micro,
        recBanner: rec && !!rec.banner.desktopText && !!rec.banner.mobileText,
        recProcess: rec && rec.process.steps.length === 4,
        recVisibility: rec && JSON.stringify(rec.visibility),
        recFlags: rec && JSON.stringify(rec.metadata.flags),
        recImages: rec && rec.images ? {
          heroUrl: rec.images.hero && rec.images.hero.url,
          heroAlt: rec.images.hero && rec.images.hero.alt,
          kitchenUrl: rec.images.projectKitchen && rec.images.projectKitchen.url,
          bathAlt: rec.images.projectBath && rec.images.projectBath.alt,
          allSlots: ['hero','projectFeatured','projectKitchen','projectBath','projectWholeHome'].every(k => rec.images[k])
        } : null,
        url: q('#res-url').textContent
      };
    })()`);
    ok('wizard: generation produces result panel with id + slug + status', generated.resultShown && generated.resId.startsWith('preview_') && generated.resSlug === 'cascade-home-remodeling-bend-or', JSON.stringify({ id: generated.resId, slug: generated.resSlug, status: generated.resStatus }));
    ok('wizard: record id is internal + independent of slug', generated.recId !== generated.recSlug && generated.recId.startsWith('preview_'));
    ok('wizard: record maps canonical business (state normalized, phoneHref derived)', generated.recState === 'OR' && generated.recPhoneHref === 'tel:5415550198');
    ok('wizard: services parsed from newline+pipe entry', generated.recServices === 3);
    ok('wizard: service areas parsed from pipe+newline entry', generated.recCommunities === JSON.stringify(['Bend','Redmond','Sisters']));
    ok('wizard: research-only license stored in metadata, not business', generated.recLicense === 'CCB-204555');
    ok('wizard: proof sections empty (honest-copy)', generated.recClaims === 0 && generated.recReviews === 0 && generated.recProjects === 0);
    ok('wizard: defaults generated for meta/hero/cta/banner/process', generated.recMeta && generated.recHero && generated.recCta && generated.recBanner && generated.recProcess);
    ok('wizard: visibility computed (services+process shown, proof hidden)', generated.recVisibility === JSON.stringify({ claims:false, services:true, projects:false, process:true, reviews:false, serviceAreaChips:true }));
    ok('wizard: no default_services flag when services entered', generated.recFlags === '[]');
    ok('wizard: result shows future preview URL from slug', generated.url.indexOf('cascade-home-remodeling-bend-or') !== -1);

    // Image record contract (JUS-52).
    ok('wizard: record images.hero carries override + custom alt', generated.recImages && generated.recImages.heroUrl === 'https://images.example.com/cascade-hero.jpg' && generated.recImages.heroAlt === 'Owner-provided inspiration photo', JSON.stringify(generated.recImages));
    ok('wizard: record images drop invalid URL to safe alt (placeholder path)', generated.recImages && generated.recImages.kitchenUrl === undefined && generated.recImages.bathAlt === 'Bathroom remodeling inspiration image', JSON.stringify(generated.recImages));
    ok('wizard: record images include all five slots', generated.recImages && generated.recImages.allSlots, JSON.stringify(generated.recImages));

    // 7. Status: complete recommended data -> ready.
    const statusReady = await evaluate(ws, `(function(){
      // heroHeadline was never filled -> warning -> needs_review expected.
      return window.__wizard.getRecord().status;
    })()`);
    ok('wizard: incomplete optional data -> needs_review status', statusReady === 'needs_review', statusReady);

    // 8. Persisted record: reload survives; second wizard pass (different
    //    business, same city) gets a unique slug via collision suffix.
    const persisted = await evaluate(ws, `(function(){
      const recs = window.WizardStore.listRecords();
      return { count: recs.length, slug: recs[0] && recs[0].slug, id: recs[0] && recs[0].id };
    })()`);
    ok('wizard: record persisted to store', persisted.count === 1 && persisted.slug === 'cascade-home-remodeling-bend-or', JSON.stringify(persisted));

    await evaluate(ws, `document.getElementById('btn-new').click(); new Promise(r=>setTimeout(r,150)).then(()=>1)`);
    const resetOk = await evaluate(ws, `(function(){
      const q = s => document.querySelector(s);
      return {
        step: window.__wizard.getStep(),
        cleared: document.getElementById('f-businessName').value === '',
        resultHidden: q('#wiz-result').hidden,
        stateBlank: window.__wizard.getState().businessName === ''
      };
    })()`);
    ok('wizard: Generate Another resets to blank step 1', resetOk.step === 0 && resetOk.cleared && resetOk.resultHidden && resetOk.stateBlank);

    // Second record: same business+city -> slug collision -> suffix.
    await evaluate(ws, `(function(){
      const set = (id, val) => { const el = document.getElementById(id); el.value = val; el.dispatchEvent(new Event('input', {bubbles:true})); };
      set('f-businessName', 'Cascade Home Remodeling');
      set('f-city', 'Bend');
      set('f-state', 'OR');
      set('f-trade', 'remodeling');
      return 1;
    })()`);
    await evaluate(ws, `document.getElementById('btn-skip').click(); new Promise(r=>setTimeout(r,150)).then(()=>1)`);
    await evaluate(ws, `document.getElementById('btn-generate').click(); new Promise(r=>setTimeout(r,250)).then(()=>1)`);
    const second = await evaluate(ws, `(function(){
      const rec = window.__wizard.getRecord();
      const recs = window.WizardStore.listRecords();
      return { slug: rec && rec.slug, count: recs.length, firstSlug: recs[0].slug, secondSlug: recs[1] && recs[1].slug, id2: recs[1] && recs[1].id, id1: recs[0].id };
    })()`);
    ok('wizard: duplicate business gets unique slug suffix', second.count === 2 && second.secondSlug === 'cascade-home-remodeling-bend-or-2' && second.slug === 'cascade-home-remodeling-bend-or-2', JSON.stringify(second));
    ok('wizard: second record has its own internal id', second.id1 !== second.id2);

    // 9. CSV prefill (JUS-46): import UI present, hook import maps the
    //    template row, form syncs, record carries honest reviews.
    const impUi = await evaluate(ws, `(function(){
      const q = s => document.querySelector(s);
      return {
        block: !!q('.wiz-import'),
        file: !!q('#f-csvFile'),
        note: q('.wiz-import__note') && q('.wiz-import__note').textContent.indexOf('preview-site-input-template.csv') !== -1,
        msgHidden: q('#wiz-import-msg') && q('#wiz-import-msg').hidden
      };
    })()`);
    ok('wizard: CSV import UI on step 1 (file + note + hidden msg)', impUi.block && impUi.file && impUi.note && impUi.msgHidden, JSON.stringify(impUi));

    const impRes = await evaluate(ws, `(function(){
      const csv = [
        'business_name,city,state,trade,phone,website_url,services,service_areas,hero_image_url,hero_image_alt,project_featured_image_url,project_featured_image_alt,project_kitchen_image_url,project_kitchen_image_alt,project_bath_image_url,project_bath_image_alt,project_whole_home_image_url,project_whole_home_image_alt,owner_name,email,logo_url,project_images,reviews,address,business_hours,license_number,notes,source_url',
        'Cascade Home Remodeling,Bend,OR,remodeling,541-555-0198,https://example.com,"Kitchen Remodeling|Bathroom Remodeling|Whole-Home Updates","Bend|Redmond|Sisters",https://cdn.example/hero.jpg,Owner photo,https://cdn.example/feat.jpg,,,,,,https://cdn.example/whole.jpg,,Pat Doe,hi@example.com,https://cdn.example/logo.png,"a.jpg|b.jpg","Great crew, fair price::Sarah M., Bend|Finished on schedule::Tom R.",12 Main St,M-F 8-5,CCB-204555,referral,https://source.example'
      ].join('\\n');
      const imported = window.__wizard.importCsv(csv);
      const st = window.__wizard.getState();
      return {
        imported: imported,
        msg: window.__wizard.importMsg(),
        name: st.businessName,
        city: st.city,
        stateVal: st.state,
        trade: st.trade,
        reviews: st.reviews,
        heroUrl: st.heroImageUrl,
        heroAlt: st.heroImageAlt,
        featuredUrl: st.projectFeaturedImageUrl,
        wholeUrl: st.projectWholeHomeImageUrl,
        formHero: document.getElementById('f-heroImageUrl') ? document.getElementById('f-heroImageUrl').value : null,
        formName: document.getElementById('f-businessName').value,
        formCity: document.getElementById('f-city').value,
        formPhone: document.getElementById('f-phone') ? document.getElementById('f-phone').value : null
      };
    })()`);
    ok('wizard: importCsv hook maps template row into state', impRes.imported === true && impRes.name === 'Cascade Home Remodeling' && impRes.city === 'Bend' && impRes.stateVal === 'OR' && impRes.trade === 'remodeling', JSON.stringify(impRes));
    ok('wizard: import maps reviews (quote::attribution lines)', impRes.reviews.indexOf('Sarah M., Bend') !== -1 && impRes.reviews.indexOf('::') !== -1, impRes.reviews);
    ok('wizard: import maps image URL + alt columns into state (JUS-52)', impRes.heroUrl === 'https://cdn.example/hero.jpg' && impRes.heroAlt === 'Owner photo' && impRes.featuredUrl === 'https://cdn.example/feat.jpg' && impRes.wholeUrl === 'https://cdn.example/whole.jpg', JSON.stringify({ hero: impRes.heroUrl, alt: impRes.heroAlt, featured: impRes.featuredUrl, whole: impRes.wholeUrl }));
    ok('wizard: image import syncs Images-step form control', impRes.formHero === 'https://cdn.example/hero.jpg', JSON.stringify({ formHero: impRes.formHero }));
    ok('wizard: import syncs form controls', impRes.formName === 'Cascade Home Remodeling' && impRes.formCity === 'Bend', { name: impRes.formName, city: impRes.formCity });
    ok('wizard: import shows field-count message', /Imported \d+ fields? from row 1\./.test(impRes.msg), impRes.msg);

    await evaluate(ws, `document.getElementById('btn-skip').click(); new Promise(r=>setTimeout(r,200)).then(()=>1)`);
    const impReview = await evaluate(ws, `(function(){
      const q = s => document.querySelector(s);
      return { slug: q('.wiz-review__slug') ? q('.wiz-review__slug').textContent : '', blocked: !!q('.wiz-review__blocked') };
    })()`);
    ok('wizard: imported row review shows base slug (suffix resolves at generation)', impReview.slug === 'cascade-home-remodeling-bend-or' && !impReview.blocked, JSON.stringify(impReview));

    await evaluate(ws, `document.getElementById('btn-generate').click(); new Promise(r=>setTimeout(r,250)).then(()=>1)`);
    const impRec = await evaluate(ws, `(function(){
      const rec = window.__wizard.getRecord();
      const recs = window.WizardStore.listRecords();
      return {
        slug: rec && rec.slug,
        reviews: rec && rec.reviews.items.length,
        firstQuote: rec && rec.reviews.items[0] && rec.reviews.items[0].quote,
        attribution: rec && rec.reviews.items[0] && rec.reviews.items[0].attribution,
        visReviews: rec && rec.visibility.reviews,
        services: rec && rec.services.items.length,
        communities: rec && rec.serviceArea.communities.length,
        license: rec && rec.metadata.licenseNumber,
        notesHasAssetRefs: rec && rec.metadata.notes.indexOf('Asset refs (not rendered)') !== -1,
        imgHeroUrl: rec && rec.images && rec.images.hero && rec.images.hero.url,
        imgHeroAlt: rec && rec.images && rec.images.hero && rec.images.hero.alt,
        imgFeaturedUrl: rec && rec.images && rec.images.projectFeatured && rec.images.projectFeatured.url,
        imgWholeUrl: rec && rec.images && rec.images.projectWholeHome && rec.images.projectWholeHome.url,
        claims: rec && rec.claims.length,
        projects: rec && rec.projects.items.length,
        storeCount: recs.length
      };
    })()`);
    ok('wizard: imported record keeps slug suffix + real reviews (honest data)', impRec.slug === 'cascade-home-remodeling-bend-or-3' && impRec.reviews === 2 && impRec.firstQuote === 'Great crew, fair price' && impRec.attribution === 'Sarah M., Bend', JSON.stringify(impRec));
    ok('wizard: imported record visibility.reviews true + proof sections still empty', impRec.visReviews === true && impRec.claims === 0 && impRec.projects === 0);
    ok('wizard: imported record maps services/areas/license + legacy refs as notes', impRec.services === 3 && impRec.communities === 3 && impRec.license === 'CCB-204555' && impRec.notesHasAssetRefs, JSON.stringify(impRec));
    ok('wizard: imported record images carry CSV overrides (JUS-52)', impRec.imgHeroUrl === 'https://cdn.example/hero.jpg' && impRec.imgHeroAlt === 'Owner photo' && impRec.imgFeaturedUrl === 'https://cdn.example/feat.jpg' && impRec.imgWholeUrl === 'https://cdn.example/whole.jpg', JSON.stringify({ hero: impRec.imgHeroUrl, alt: impRec.imgHeroAlt, featured: impRec.imgFeaturedUrl, whole: impRec.imgWholeUrl }));
    ok('wizard: imported record persisted (3rd record)', impRec.storeCount === 3);

    const impReset = await evaluate(ws, `(function(){
      document.getElementById('btn-new').click();
      return new Promise(r => setTimeout(() => {
        r({ msgHidden: document.getElementById('wiz-import-msg').hidden, blank: window.__wizard.getState().businessName === '' });
      }, 150));
    })()`);
    ok('wizard: reset clears import message + state', impReset.msgHidden && impReset.blank, JSON.stringify(impReset));

    const wizErrs = await evaluate(ws, `window.__errors || []`);
    ok('wizard: no runtime errors', wizErrs.length === 0, JSON.stringify(wizErrs));

    ws.close();

    killTree(proc);
  }

  /* ==========================================================
     GENERATED PREVIEW phase (static preview generation MVP)
     Runs scripts/generate-preview.js against the canonical example
     record + a second fixture business, then loads both generated
     pages headless: rendering, noindex, drawer + question flow,
     CTA links, responsive layout, asset resolution.
     ========================================================== */
  {
    // 1. Generate both previews into dist/ (regenerated fresh each
    //    run; slug dirs are protected by --force semantics).
    const gen = (recordFile) => {
      try {
        const r = require('child_process').execFileSync(
          process.execPath,
          [path.join(ROOT, 'scripts', 'generate-preview.js'), recordFile, '--out', path.join(ROOT, 'dist'), '--force'],
          { cwd: ROOT, encoding: 'utf8' }
        );
        return { ok: true, out: r.trim() };
      } catch (e) {
        return { ok: false, err: (e.stderr || e.stdout || e.message || '').trim() };
      }
    };
    const gen1 = gen(path.join(ROOT, 'examples', 'preview-site.example.json'));
    ok('gen: example record generates via CLI', gen1.ok, gen1.err || gen1.out);

    // Second fixture: distinct trade/city + a real review (honest
    // data) + hero image override, generated from a temp record file.
    const secondRecord = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'preview-site.example.json'), 'utf8'));
    secondRecord.id = 'preview_test_ridgefield_plumbing';
    secondRecord.slug = 'ridgefield-plumbing-sunriver-or';
    secondRecord.status = 'needs_review';
    // Scrub template-business copy from every free-text field. The
    // renderer only fills hooked elements, but the raw embedded JSON
    // is part of the page (and document title/banner copy comes from
    // these fields) — a second business's preview must not carry the
    // template business's name anywhere.
    secondRecord.meta = { title: 'Ridgefield Plumbing — Sunriver, Oregon (Preview)', description: 'Dependable plumbing repairs, remodels, and new construction plumbing for Sunriver and central Oregon.' };
    secondRecord.banner = { desktopText: 'Preview prepared for Ridgefield Plumbing. Like this direction?', mobileText: 'Like this direction?' };
    secondRecord.header = { wordmarkLabel: 'Ridgefield Plumbing — home' };
    secondRecord.hero.headline = 'Dependable, <em>tidy</em> plumbing for Sunriver homes.';
    secondRecord.hero.lede = 'Repairs, remodels, and new construction plumbing with clear communication and clean workmanship.';
    secondRecord.serviceArea.lede = 'Ridgefield Plumbing serves homeowners throughout Sunriver and the surrounding area.';
    // $comment is stripped by the generator itself; also dropped here
    // so the temp fixture file is clean on its own. metadata.notes is
    // operator documentation — never rendered, but part of the raw
    // embedded JSON, so it must not name another business.
    delete secondRecord.$comment;
    secondRecord.metadata = { createdAt: secondRecord.metadata.createdAt, updatedAt: new Date().toISOString(), notes: 'Test fixture generated by test/verify.js for the static preview generation phase.', flags: ['test-fixture'] };
    secondRecord.business = {
      name: 'Ridgefield Plumbing', city: 'Sunriver', state: 'OR', stateName: 'Oregon',
      trade: 'plumbing', phone: '541-555-0200', phoneHref: 'tel:5415550200'
    };
    secondRecord.reviews.items = [{ id: 'rev_1', quote: 'Fixed our leak fast.', attribution: 'Ann L., Sunriver' }];
    secondRecord.images = { hero: { url: 'https://images.example.com/ridgefield-hero.jpg', alt: 'Plumbing inspiration image' } };
    const secondPath = path.join(tmp, 'ridgefield-plumbing.json');
    fs.writeFileSync(secondPath, JSON.stringify(secondRecord, null, 2));
    const gen2 = gen(secondPath);
    ok('gen: second business generates to its own slug dir', gen2.ok, gen2.err || gen2.out);

    // 2. Load the generated Cascade preview (desktop), served from
    //    the dist-rooted server (assets resolve like real hosting).
    const { proc: gproc, ws: gws, killTree: gkill } = await runSession(9232, 1440, 960, false, '/previews/cascade-home-remodeling-bend-or/index.html', GEN_PORT);
    gws.send({ id: 902, method: 'Runtime.evaluate', params: { expression: 'window.__errors = []; window.onerror = function(m){ window.__errors.push(String(m)); };', returnByValue: true } });

    const gchecks = await evaluate(gws, `(function(){
      const q = s => document.querySelector(s);
      const qa = s => document.querySelectorAll(s);
      const heroImg = q('.ph--hero img.ph__img');
      return {
        generated: document.documentElement.getAttribute('data-generated-preview'),
        robots: (q('meta[name="robots"]') || {}).content || '',
        googlebot: (q('meta[name="googlebot"]') || {}).content || '',
        rendered: document.documentElement.getAttribute('data-preview-rendered'),
        title: document.title,
        banner: !!q('.preview-banner'),
        phone: (q('.site-header__phone span') || {}).textContent || '',
        phoneHref: (q('.site-header__phone') || {}).getAttribute ? q('.site-header__phone').getAttribute('href') : '',
        services: qa('.service-card').length,
        process: qa('.process-step').length,
        communities: qa('.area-chips li').length,
        claimsHidden: q('[data-preview-section="claims"]').hidden,
        projectsHidden: q('[data-preview-section="projects"]').hidden,
        reviewsHidden: q('[data-preview-section="reviews"]').hidden,
        heroEm: !!q('.hero__title em'),
        heroImgSrc: heroImg ? heroImg.getAttribute('src') : null,
        heroImgAlt: heroImg ? heroImg.alt : null,
        // Stylesheet really applied: .top-stack is position:sticky and
        // .site-header gets the linen background — both unset (<static>/
        // transparent) when css/styles.css fails to load.
        stylesApplied: getComputedStyle(q('.top-stack')).position === 'sticky' && getComputedStyle(q('.site-header')).backgroundColor !== 'rgba(0, 0, 0, 0)',
        mapperGlobal: !!window.PreviewDataMapper,
        liveDataName: window.PREVIEW_DATA && window.PREVIEW_DATA.business && window.PREVIEW_DATA.business.name
      };
    })()`);
    ok('gen: generated page marked + renderer ran', gchecks.generated === 'true' && gchecks.rendered === 'true', JSON.stringify(gchecks));
    ok('gen: noindex robots + googlebot present', gchecks.robots === 'noindex,nofollow,noarchive,nosnippet' && gchecks.googlebot === 'noindex,nofollow,noarchive,nosnippet', JSON.stringify({ robots: gchecks.robots, googlebot: gchecks.googlebot }));
    ok('gen: title from canonical record', gchecks.title === 'Cascade Home Remodeling — Bend, Oregon (Preview)', gchecks.title);
    ok('gen: business identity rendered (name/phone/href)', gchecks.phone === '541-555-0198' && gchecks.phoneHref === 'tel:5415550198' && gchecks.liveDataName === 'Cascade Home Remodeling', JSON.stringify(gchecks));
    ok('gen: sections render from mapped data (services/process/communities)', gchecks.services === 3 && gchecks.process === 4 && gchecks.communities === 6, JSON.stringify({ services: gchecks.services, process: gchecks.process, communities: gchecks.communities }));
    ok('gen: honest-copy sections stay hidden (claims/projects/reviews)', gchecks.claimsHidden && gchecks.projectsHidden && gchecks.reviewsHidden, JSON.stringify(gchecks));
    ok('gen: hero <em> headline + image override render', gchecks.heroEm && gchecks.heroImgSrc === 'https://images.example.com/cascade-hero.jpg' && gchecks.heroImgAlt === 'Home remodeling inspiration image', JSON.stringify({ em: gchecks.heroEm, src: gchecks.heroImgSrc, alt: gchecks.heroImgAlt }));
    ok('gen: stylesheet loads + styles applied (assets resolve)', gchecks.stylesApplied, JSON.stringify(gchecks));

    // 3. Drawer + question flow on the generated page.
    await evaluate(gws, `document.querySelector('[data-open-drawer="launch"]').click(); new Promise(r=>setTimeout(r,350)).then(()=>1)`);
    const gdrawer = await evaluate(gws, `(function(){
      const q = s => document.querySelector(s);
      return {
        open: q('.drawer-root').classList.contains('is-open'),
        launchVisible: !q('[data-drawer-view="launch"]').hidden,
        cta: (q('[data-purchase]') || {}).textContent.trim(),
        questionBtn: !!q('[data-drawer-view-trigger="question"]')
      };
    })()`);
    ok('gen: drawer opens with launch offer + CTA', gdrawer.open && gdrawer.launchVisible && /\$500/.test(gdrawer.cta), JSON.stringify(gdrawer));

    await evaluate(gws, `document.querySelector('[data-drawer-view-trigger="question"]').click(); new Promise(r=>setTimeout(r,300)).then(()=>1)`);
    const gquestion = await evaluate(gws, `(function(){
      const q = s => document.querySelector(s);
      return {
        visible: !q('[data-drawer-view="question"]').hidden,
        businessPrefill: document.getElementById('question-business').value,
        endpoint: document.getElementById('question-form').getAttribute('data-form-endpoint')
      };
    })()`);
    ok('gen: question view opens with business prefilled', gquestion.visible && gquestion.businessPrefill === 'Cascade Home Remodeling', JSON.stringify(gquestion));
    ok('gen: question form endpoint blank (central endpoint comes later)', gquestion.endpoint === '' || gquestion.endpoint === null, gquestion.endpoint);

    // CTA link from drawer closes + scrolls to #contact.
    await evaluate(gws, `document.querySelector('[data-close-drawer][data-purchase]').click(); new Promise(r=>setTimeout(r,400)).then(()=>1)`);
    const gcta = await evaluate(gws, `(function(){
      const q = s => document.querySelector(s);
      return { drawerClosed: !q('.drawer-root').classList.contains('is-open'), contactHref: !!q('#contact'), finalCtaBtn: (q('.final-cta a.btn--terra') || {}).getAttribute('href') };
    })()`);
    ok('gen: CTA close + contact section present, final CTA links phone', gcta.drawerClosed && gcta.contactHref && gcta.finalCtaBtn === 'tel:5415550198', JSON.stringify(gcta));

    const gerrs = await evaluate(gws, `window.__errors || []`);
    ok('gen: no runtime errors (Cascade preview)', gerrs.length === 0, JSON.stringify(gerrs));
    gws.close();
    gkill();

    // 4. Second business preview — no cross-contamination + review
    //    section visible (real review data) + hero override. Loaded
    //    at a true 390px viewport via CDP device-metrics override
    //    (headless --window-size clamps small widths ~477px).
    const { proc: g2proc, ws: g2ws, killTree: g2kill } = await runSession(9233, 1280, 900, true, '/previews/ridgefield-plumbing-sunriver-or/index.html', GEN_PORT);
    await evaluate(g2ws, `new Promise(r => { chrome.send ? null : null; (window.chrome || {}); r(1); })`);
    const g2setupId = Math.floor(Math.random() * 1e9);
    g2ws.send({ id: g2setupId, method: 'Emulation.setDeviceMetricsOverride', params: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true } });
    for (;;) { const m = await g2ws.next(); if (m.id === g2setupId) break; }
    await wait(400);
    const g2 = await evaluate(g2ws, `(function(){
      const q = s => document.querySelector(s);
      const qa = s => document.querySelectorAll(s);
      const heroImg = q('.ph--hero img.ph__img');
      return {
        title: document.title,
        phone: (q('.site-header__phone span') || {}).textContent || '',
        reviews: qa('.review-card').length,
        reviewsVisible: !q('[data-preview-section="reviews"]').hidden,
        firstQuote: (q('.review-card__quote') || {}).textContent || '',
        heroImgSrc: heroImg ? heroImg.getAttribute('src') : null,
        titleLeak: document.title.indexOf('Cascade') !== -1,
        // Scoped to rendered UI only: the embedded JSON payload and
        // script/style contents legitimately live in the raw HTML.
        cascadeLeak: (function(){ var el = document.querySelector('[data-generated-preview]'); var root = document.body; var bad = []; var walk = function(node){ for (var n = node.firstChild; n; n = n.nextSibling) { if (n.nodeType === 1) { if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE') continue; walk(n); } else if (n.nodeType === 3 && n.nodeValue.indexOf('Cascade') !== -1) { bad.push(n.nodeValue.trim().slice(0, 80)); } } }; walk(root); return bad.length ? bad.join(' | ') : ''; })(),
        viewportWidth: document.documentElement.clientWidth
      };
    })()`);
    ok('gen: second business renders its own data (no Cascade leak)', g2.phone === '541-555-0200' && !g2.cascadeLeak && !g2.titleLeak && g2.heroImgSrc === 'https://images.example.com/ridgefield-hero.jpg', JSON.stringify(g2));
    ok('gen: second business real review renders (honest data)', g2.reviews === 1 && g2.reviewsVisible && g2.firstQuote.indexOf('Fixed our leak fast.') === 0, JSON.stringify(g2));
    ok('gen: mobile viewport layout intact', g2.viewportWidth <= 400, g2.viewportWidth);
    g2ws.close();
    g2kill();
  }

  server.close();
  genApp.close();
  const failed = results.filter(r => !r.pass);
  console.log('\n' + (failed.length ? failed.length + ' FAILURES' : 'ALL ' + results.length + ' CHECKS PASSED'));
  console.log('screenshots in: ' + tmp);
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error('VERIFY ERROR', e); process.exit(2); });
