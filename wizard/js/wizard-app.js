/* ============================================================
   WIZARD APP — step controller + DOM binding (JUS-45)
   ------------------------------------------------------------
   Owns: step navigation, form <-> state binding, review render,
   generation flow, JSON download. All logic lives in wizard-core.js;
   all persistence in wizard-store.js.
   ============================================================ */

(function () {
  'use strict';

  var C = window.WizardCore;
  var S = window.WizardStore;

  var STEP_COUNT = 6;
  var REVIEW_STEP = 5;

  var form = document.getElementById('wizard-form');
  var stepsBar = document.getElementById('wiz-steps');
  var btnBack = document.getElementById('btn-back');
  var btnNext = document.getElementById('btn-next');
  var btnSkip = document.getElementById('btn-skip');
  var btnGenerate = document.getElementById('btn-generate');
  var btnReset = document.getElementById('btn-reset');
  var btnDownload = document.getElementById('btn-download');
  var btnNew = document.getElementById('btn-new');
  var reviewEl = document.getElementById('wiz-review');
  var resultEl = document.getElementById('wiz-result');
  var csvFile = document.getElementById('f-csvFile');
  var importMsg = document.getElementById('wiz-import-msg');
  var resId = document.getElementById('res-id');
  var resSlug = document.getElementById('res-slug');
  var resStatus = document.getElementById('res-status');
  var resUrl = document.getElementById('res-url');

  var state = C.loadState(S.available() ? S.loadDraft() : null);
  var currentStep = 0;
  var lastRecord = null;

  /* ---------- state <-> form ---------- */

  function bindFormToState() {
    var els = form.querySelectorAll('input[name], textarea[name], select[name]');
    Array.prototype.forEach.call(els, function (el) {
      if (Object.prototype.hasOwnProperty.call(state, el.name)) {
        el.value = state[el.name];
      }
      el.addEventListener('input', function () {
        state[el.name] = el.value;
        autosave();
        if (currentStep === REVIEW_STEP) renderReview();
        clearError(el.name);
      });
      el.addEventListener('change', function () {
        state[el.name] = el.value;
        autosave();
        if (currentStep === REVIEW_STEP) renderReview();
      });
    });
  }

  function autosave() {
    if (S.available()) S.saveDraft(state);
  }

  // Push current state into all bound form controls (after import/reset).
  function syncFormFromState() {
    Array.prototype.forEach.call(form.querySelectorAll('input[name], textarea[name], select[name]'), function (el) {
      if (Object.prototype.hasOwnProperty.call(state, el.name)) el.value = state[el.name];
    });
  }

  /* ---------- CSV import (docs/preview-site-input-template.csv) ---------- */

  function showImportMsg(text, isError) {
    if (!importMsg) return;
    importMsg.textContent = text;
    importMsg.hidden = false;
    importMsg.classList.toggle('wiz-import__msg--error', !!isError);
    importMsg.classList.toggle('wiz-import__msg--ok', !isError);
  }

  function importCsvText(text) {
    var rows = C.parseCsv(text);
    if (!rows.length) { showImportMsg('No data rows found in the CSV file.', true); return false; }
    if (rows.length > 1) showImportMsg(rows.length + ' rows found — imported the first row only.', false);

    var imported = C.stateFromCsvRow(rows[0]);
    var skipped = [];
    for (var k in imported) {
      if (imported[k] === '') skipped.push(k);
    }
    // Import REPLACES mapped fields: the CSV row is the source of
    // truth at import time. Fields absent/blank in the CSV fall back
    // to blank-state defaults (reported so nothing is silently lost).
    state = C.loadState(imported);
    syncFormFromState();
    clearAllErrors();
    autosave();
    var fields = 0;
    for (var k2 in imported) {
      if (Object.prototype.hasOwnProperty.call(imported, k2) && imported[k2] !== '') fields++;
    }
    var msg = 'Imported ' + fields + ' field' + (fields === 1 ? '' : 's') + ' from row 1.'
      + (skipped.length ? ' Blank in CSV (left at defaults): ' + skipped.join(', ') + '.' : '');
    showImportMsg(msg, false);
    return true;
  }

  if (csvFile) {
    csvFile.addEventListener('change', function () {
      var file = csvFile.files && csvFile.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { importCsvText(String(reader.result || '')); };
      reader.onerror = function () { showImportMsg('Could not read the file.', true); };
      reader.readAsText(file);
      csvFile.value = '';
    });
  }

  /* ---------- errors ---------- */

  function showError(err) {
    var field = form.querySelector('[data-field="' + err.key + '"]');
    if (!field) return;
    field.classList.add('has-error');
    var msg = field.querySelector('[data-error-for="' + err.key + '"]');
    if (msg) { msg.textContent = err.message; msg.hidden = false; }
  }

  function clearError(key) {
    var field = form.querySelector('[data-field="' + key + '"]');
    if (!field) return;
    field.classList.remove('has-error');
    var msg = field.querySelector('[data-error-for="' + key + '"]');
    if (msg) { msg.textContent = ''; msg.hidden = true; }
  }

  function clearAllErrors() {
    Array.prototype.forEach.call(form.querySelectorAll('.has-error'), function (f) {
      f.classList.remove('has-error');
    });
    Array.prototype.forEach.call(form.querySelectorAll('.wiz-error'), function (m) {
      m.textContent = ''; m.hidden = true;
    });
  }

  /* ---------- step navigation ---------- */

  function showStep(n) {
    currentStep = n;
    Array.prototype.forEach.call(form.querySelectorAll('[data-step-panel]'), function (p) {
      p.hidden = Number(p.getAttribute('data-step-panel')) !== n;
    });
    Array.prototype.forEach.call(stepsBar.querySelectorAll('.wiz-step'), function (li, i) {
      li.classList.toggle('is-current', i === n);
      li.classList.toggle('is-done', i < n);
    });
    btnBack.hidden = n === 0;
    btnSkip.hidden = n === 0 || n === REVIEW_STEP;
    btnNext.hidden = n === REVIEW_STEP;
    btnNext.textContent = n === REVIEW_STEP - 1 ? 'Review \u2192' : 'Continue \u2192';
    if (n === REVIEW_STEP) { clearAllErrors(); renderReview(); }
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function gotoStepFromError(err) {
    showStep(err.step);
    showError(err);
    var field = form.querySelector('[data-field="' + err.key + '"] input, [data-field="' + err.key + '"] textarea');
    if (field) field.focus();
  }

  function next() {
    if (currentStep >= REVIEW_STEP) return;
    if (currentStep === REVIEW_STEP - 1) { showStep(REVIEW_STEP); return; }
    // Validate required fields that live on this step before advancing.
    var stepErrs = C.validate(state).errors.filter(function (e) { return e.step === currentStep; });
    if (stepErrs.length) {
      stepErrs.forEach(showError);
      return;
    }
    showStep(currentStep + 1);
  }

  function back() { if (currentStep > 0) showStep(currentStep - 1); }

  /* ---------- review rendering ---------- */

  function row(dt, dd, mono) {
    return '<div class="wiz-review__row"><dt>' + dt + '</dt><dd' + (mono ? ' class="wiz-review__slug"' : '') + '>' + dd + '</dd></div>';
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderReview() {
    var v = C.validate(state);
    var w = C.warnings(state);
    var slug = C.buildSlug(state.businessName, state.city, state.state);
    var serviceTitles = C.splitMulti(state.services);
    var usingDefaults = serviceTitles.length === 0;
    if (usingDefaults) serviceTitles = C.defaultServicesFor(state.trade);
    var communities = C.splitMulti(state.serviceAreas);

    var html = '';

    if (!v.ok) {
      html += '<div class="wiz-review__blocked"><strong>Generation blocked</strong> \u2014 fix the required fields:<ul>';
      v.errors.forEach(function (e) { html += '<li>' + esc(e.message) + ' (step ' + (e.step + 1) + ')</li>'; });
      html += '</ul></div>';
      btnGenerate.setAttribute('aria-disabled', 'true');
    } else {
      btnGenerate.removeAttribute('aria-disabled');
    }

    if (w.length) {
      html += '<div class="wiz-review__warnings"><p>Warnings (do not block generation)</p><ul>';
      w.forEach(function (msg) { html += '<li>' + esc(msg) + '</li>'; });
      html += '</ul></div>';
    }

    html += '<div class="wiz-review__section"><div class="wiz-review__head">Business</div><dl class="wiz-review__body">';
    html += row('Name', v.ok ? esc(state.businessName) : '<span class="wiz-review__empty">missing</span>');
    html += row('City / State', (state.city ? esc(state.city) : '<span class="wiz-review__empty">missing</span>') + ', ' + (state.state ? esc(state.state) : '\u2014'));
    html += row('Trade', state.trade ? esc(state.trade) : '<span class="wiz-review__empty">missing</span>');
    html += row('Phone', state.phone ? esc(state.phone) : '<span class="wiz-review__empty">none \u2014 call CTA hidden</span>');
    html += '</dl></div>';

    html += '<div class="wiz-review__section"><div class="wiz-review__head">Services' + (usingDefaults ? ' (defaults)' : '') + '</div><div class="wiz-review__body">';
    html += serviceTitles.length
      ? '<ul style="margin:0;padding-left:18px;">' + serviceTitles.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>'
      : '<p class="wiz-review__empty">none</p>';
    html += '</div></div>';

    html += '<div class="wiz-review__section"><div class="wiz-review__head">Service areas</div><div class="wiz-review__body">';
    html += communities.length
      ? esc(communities.join(', '))
      : '<p class="wiz-review__empty">none \u2014 chip list hidden</p>';
    html += '</div></div>';

    // Images: resolution shown per slot (JUS-52). Overrides win over
    // template defaults; blanks resolve to template default or the
    // styled placeholder. Alt shown when it differs from the safe
    // generic default.
    var defaults = (window.PreviewImageDefaults && window.PreviewImageDefaults.defaultsFor(state.templateId)) || null;
    var recordImages = C.buildImages(state);
    var slotLabels = {
      hero: 'Hero',
      projectFeatured: 'Featured project',
      projectKitchen: 'Kitchen',
      projectBath: 'Bathroom',
      projectWholeHome: 'Whole-home'
    };
    html += '<div class="wiz-review__section"><div class="wiz-review__head">Images</div><dl class="wiz-review__body">';
    Object.keys(slotLabels).forEach(function (slot) {
      var res = C.resolvePreviewImage(slot, recordImages, defaults, state.trade);
      var srcLabel = res.source === 'prospect' ? 'prospect override'
        : res.source === 'template_default' ? 'template default'
        : 'placeholder';
      var detail = res.source === 'placeholder' ? 'styled placeholder' : res.url;
      html += row(slotLabels[slot] + ' image', esc(srcLabel) + ' <span class="wiz-review__imgsrc">' + esc(detail) + '</span>');
    });
    html += '</dl></div>';

    html += '<div class="wiz-review__section"><div class="wiz-review__head">Generation</div><dl class="wiz-review__body">';
    html += row('Template', esc(state.templateId));
    html += row('Slug', slug ? esc(slug) : '<span class="wiz-review__empty">needs required fields</span>', true);
    html += row('Status', esc(C.resolveStatus(state)));
    html += '</dl></div>';

    reviewEl.innerHTML = html;
  }

  /* ---------- generation ---------- */

  function generate() {
    clearAllErrors();
    var taken = S.available() ? S.takenSlugs() : [];
    var result = C.buildRecord(state, { takenSlugs: taken });

    if (!result.ok) {
      // Jump to the first offending step and flag every field.
      var first = result.errors[0];
      gotoStepFromError(first);
      result.errors.forEach(showError);
      renderReview();
      return;
    }

    // Honor the status selector only when it upgrades safety (auto
    // resolveStatus is the source of truth for blocked/needs_review).
    var chosen = state.status;
    var record = result.record;
    if (chosen === 'ready' && record.status === 'needs_review') {
      // Operator explicitly vouched for completeness.
      record.status = 'ready';
    }

    if (S.available()) S.saveRecord(record);

    lastRecord = record;
    resId.textContent = record.id;
    resSlug.textContent = record.slug;
    resStatus.textContent = record.status;
    resUrl.textContent = 'Preview URL (future): https://preview.yourdomain.com/' + record.slug;
    resultEl.hidden = false;
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    renderReview();
  }

  function download() {
    if (!lastRecord) return;
    var blob = new Blob([JSON.stringify(lastRecord, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = lastRecord.slug + '.preview-site.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }

  function resetWizard() {
    state = C.blankState();
    if (S.available()) S.clearDraft();
    syncFormFromState();
    clearAllErrors();
    if (csvFile) csvFile.value = '';
    if (importMsg) { importMsg.hidden = true; importMsg.textContent = ''; }
    lastRecord = null;
    resultEl.hidden = true;
    showStep(0);
  }

  /* ---------- wiring ---------- */

  btnNext.addEventListener('click', next);
  btnBack.addEventListener('click', back);
  btnSkip.addEventListener('click', function () { showStep(REVIEW_STEP); });
  btnGenerate.addEventListener('click', generate);
  btnReset.addEventListener('click', resetWizard);
  btnDownload.addEventListener('click', download);
  btnNew.addEventListener('click', resetWizard);

  // Step pills jump directly (allowed for completed steps + current).
  stepsBar.addEventListener('click', function (e) {
    var li = e.target.closest('[data-step-nav]');
    if (!li) return;
    var n = Number(li.getAttribute('data-step-nav'));
    if (n <= currentStep || (C.validate(state).ok && n === REVIEW_STEP)) showStep(n);
  });

  bindFormToState();
  showStep(0);

  // Expose for tests.
  window.__wizard = {
    getState: function () { return state; },
    getStep: function () { return currentStep; },
    getRecord: function () { return lastRecord; },
    importCsv: importCsvText,
    importMsg: function () { return importMsg && !importMsg.hidden ? importMsg.textContent : ''; }
  };
})();
