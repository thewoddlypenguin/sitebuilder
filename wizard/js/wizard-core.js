/* ============================================================
   WIZARD CORE — pure logic for the preview site wizard (JUS-45)
   ------------------------------------------------------------
   No DOM, no persistence. Everything here is a pure function over
   the wizard's flat form state so it can be unit-tested headlessly
   and later reused by a CSV importer / API route.

   The flat state mirrors docs/preview-site-input-template.csv on
   purpose: parseCsv() + stateFromCsvRow() map a template row directly
   into this state (same column names, same multi-value "|" and
   "quote::attribution" conventions); wizard-app.js prefills the form
   via loadState().

   Canonical contract: src/types/preview-site.ts
   Schema rules:       docs/preview-site-data-model.md
   ============================================================ */

(function (global) {
  'use strict';

  /* ---------- string helpers ---------- */

  function isBlank(v) {
    return v === undefined || v === null || String(v).trim() === '';
  }

  // Split on | AND newlines (textarea entry), trim, drop empties.
  function splitMulti(value) {
    if (isBlank(value)) return [];
    return String(value).split(/[|\n\r]+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // reviewLine := quote::attribution  (first "::" wins; no line breaks)
  function parseReviewLine(line) {
    var idx = line.indexOf('::');
    if (idx === -1) return { quote: line.trim(), attribution: '' };
    return { quote: line.slice(0, idx).trim(), attribution: line.slice(idx + 2).trim() };
  }

  // Multi-line textarea-friendly value from review lines: one
  // "quote::attribution" per line (never uses |, which quotes may
  // legitimately contain).
  function joinReviews(reviews) {
    return (reviews || []).map(function (r) {
      return r.attribution ? r.quote + '::' + r.attribution : r.quote;
    }).join('\n');
  }

  /* ---------- id + slug generation ---------- */

  // Internal record id. No database layer exists yet; this adapter
  // generates "preview_<random>" ids that a future DB can adopt as
  // its primary key (or map to its own). See docs/preview-site-data-
  // model.md §4: id is never used in URLs and never derived from slug.
  function generateId() {
    var rnd = '';
    for (var i = 0; i < 12; i++) {
      rnd += Math.floor(Math.random() * 36).toString(36);
    }
    return 'preview_' + rnd + Date.now().toString(36);
  }

  // slugify: lowercase, URL-safe [a-z0-9-], collapse separators.
  // Diacritics fold to base letters (café -> cafe) and apostrophes
  // join words (O'Brien -> obrien) instead of splitting them.
  function slugify(str) {
    return String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/['\u2018\u2019]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // Durable public slug: business_name + city + state.
  //   "Cascade Home Remodeling" + "Bend" + "OR"
  //     -> "cascade-home-remodeling-bend-or"
  function buildSlug(name, city, state) {
    var parts = [name, city, state].filter(function (p) { return !isBlank(p); });
    var s = slugify(parts.join(' '));
    return s || null;
  }

  // Collision strategy: a deterministic suffix is appended and the
  // ORIGINAL base stays stable (slug is never regenerated from edited
  // business data). Uniqueness enforcement lives in the store adapter
  // (it knows about existing records); this helper is pure.
  function ensureUniqueSlug(base, takenSlugs) {
    var taken = takenSlugs || [];
    if (taken.indexOf(base) === -1) return base;
    for (var n = 2; n < 1000; n++) {
      var candidate = base + '-' + n;
      if (taken.indexOf(candidate) === -1) return candidate;
    }
    // Extremely unlikely; caller should still persist and retry.
    return base + '-' + Date.now().toString(36);
  }

  /* ---------- state <-> form ---------- */

  // Canonical flat shape (matches CSV column names; camelCase for the
  // few compound ones the CSV spells with underscores the same way).
  function blankState() {
    return {
      businessName: '', city: '', state: '', trade: '',
      websiteUrl: '', ownerName: '', notes: '', sourceUrl: '',

      services: '',            // multi-value textarea (titles)
      ctaCopy: '',
      heroHeadline: '', heroLede: '', positioningNotes: '',

      phone: '', email: '', address: '',
      serviceAreas: '',        // multi-value
      businessHours: '', licenseNumber: '',
      reviews: '',             // real reviews only; "quote::attribution" per line

      // Image overrides (JUS-52). Blank -> template default ->
      // styled placeholder at render time. Alt blank -> safe generic.
      heroImageUrl: '', heroImageAlt: '',
      projectFeaturedImageUrl: '', projectFeaturedImageAlt: '',
      projectKitchenImageUrl: '', projectKitchenImageAlt: '',
      projectBathImageUrl: '', projectBathImageAlt: '',
      projectWholeHomeImageUrl: '', projectWholeHomeImageAlt: '',

      templateId: 'remodeling-contractor-v1',
      status: 'needs_review', // wizard-assigned; also user-selectable
      primaryCta: 'Request a Free Estimate',
      secondaryCta: 'Ask a Question'
    };
  }

  // loadState merges a partial (e.g. from localStorage draft or a
  // future CSV row mapping) over blankState, dropping unknown keys.
  function loadState(partial) {
    var base = blankState();
    var p = partial || {};
    for (var k in base) {
      if (Object.prototype.hasOwnProperty.call(p, k) && !isBlank(p[k])) {
        base[k] = String(p[k]);
      } else if (Object.prototype.hasOwnProperty.call(p, k)) {
        base[k] = '';
      }
    }
    return base;
  }

  /* ---------- CSV import (docs/preview-site-input-template.csv) ---------- */

  // Parse a full CSV document into an array of row objects keyed by
  // header cell. Deliberately small: RFC-4180 double-quote handling
  // (quoted delimiters, escaped "" quotes, newlines inside quotes),
  // comma or semicolon delimiter auto-sniff on the header row, CRLF
  // tolerance, and a `#`-comment skip. Single-pass index scanning.
  function parseCsv(text) {
    var src = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (src === '') return [];

    // Delimiter sniff on the first row (outside quotes): semicolons
    // must strictly outnumber commas to win.
    var firstEnd = 0;
    var q = false;
    while (firstEnd < src.length && (q || src.charAt(firstEnd) !== '\n')) {
      if (src.charAt(firstEnd) === '"') q = !q;
      firstEnd++;
    }
    var head0 = src.slice(0, firstEnd);
    var commas = 0, semis = 0;
    q = false;
    for (var k = 0; k < head0.length; k++) {
      var hc = head0.charAt(k);
      if (hc === '"') q = !q;
      else if (!q && hc === ',') commas++;
      else if (!q && hc === ';') semis++;
    }
    var delim = semis > commas ? ';' : ',';

    // Single pass: split cells/rows while honoring quotes (a newline
    // or delimiter inside quotes is literal data).
    var rows = [];
    var cells = [];
    var cell = '';
    var inQuotes = false;
    function endCell() { cells.push(cell); cell = ''; }
    function endRow() { endCell(); rows.push(cells); cells = []; }
    for (var i = 0; i < src.length; i++) {
      var ch = src.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (src.charAt(i + 1) === '"') { cell += '"'; i++; }
          else inQuotes = false;
        } else cell += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        endCell();
      } else if (ch === '\n') {
        endRow();
      } else {
        cell += ch;
      }
    }
    if (cell !== '' || cells.length) endRow();

    // Drop blank rows and # comments; first remaining row is the header.
    var data = [];
    for (var j = 0; j < rows.length; j++) {
      var nonEmpty = rows[j].some(function (c) { return String(c).trim() !== ''; });
      if (!nonEmpty) continue;
      if (String(rows[j][0]).trim().charAt(0) === '#') continue;
      data.push(rows[j]);
    }
    if (data.length === 0) return [];

    var headers = data[0].map(function (h) { return h.trim().toLowerCase(); });
    var out = [];
    for (var n = 1; n < data.length; n++) {
      var cellsN = data[n];
      var obj = {};
      var any = false;
      for (var p = 0; p < headers.length; p++) {
        var val = cellsN[p] !== undefined ? String(cellsN[p]).trim() : '';
        if (val !== '') any = true;
        obj[headers[p]] = val;
      }
      if (any) out.push(obj);
    }
    return out;
  }

  // Map one CSV row (parseCsv output) into flat wizard state. Unknown
  // keys ignored; values flow through the same conventions the manual
  // form uses (multi-value stays pipe-joined; reviews keep :: pairs on
  // separate lines). Missing keys leave defaults from blankState.
  function stateFromCsvRow(row) {
    var s = blankState();
    var map = {
      business_name: 'businessName', city: 'city', state: 'state',
      trade: 'trade', phone: 'phone', website_url: 'websiteUrl',
      services: 'services', service_areas: 'serviceAreas',
      owner_name: 'ownerName', email: 'email',
      reviews: 'reviews',
      address: 'address', business_hours: 'businessHours',
      license_number: 'licenseNumber', notes: 'notes', source_url: 'sourceUrl',

      // Image overrides (JUS-52): first-class preview slots now, not
      // operator notes. hero_image_url migrated from the notes-only
      // convention; alt columns fall back to safe generic alts.
      hero_image_url: 'heroImageUrl',
      hero_image_alt: 'heroImageAlt',
      project_featured_image_url: 'projectFeaturedImageUrl',
      project_featured_image_alt: 'projectFeaturedImageAlt',
      project_kitchen_image_url: 'projectKitchenImageUrl',
      project_kitchen_image_alt: 'projectKitchenImageAlt',
      project_bath_image_url: 'projectBathImageUrl',
      project_bath_image_alt: 'projectBathImageAlt',
      project_whole_home_image_url: 'projectWholeHomeImageUrl',
      project_whole_home_image_alt: 'projectWholeHomeImageAlt'
    };
    for (var csvKey in map) {
      if (Object.prototype.hasOwnProperty.call(row, csvKey) && !isBlank(row[csvKey])) {
        s[map[csvKey]] = String(row[csvKey]).trim();
      }
    }
    // Legacy asset columns (pre-JUS-52): logo stays outside the image
    // slot system, and project_images is a pipe-list with no per-slot
    // home — both stay source references in operator notes, never
    // rendered and never turned into project claims.
    var refs = [];
    if (!isBlank(row.logo_url)) refs.push('logo: ' + row.logo_url);
    if (!isBlank(row.project_images)) refs.push('project images: ' + row.project_images);
    if (refs.length) {
      s.notes = (s.notes ? s.notes + ' | ' : '') + 'Asset refs (not rendered): ' + refs.join(', ');
    }
    // Reviews: keep the :: pair per line (splitMulti handles newlines).
    s.reviews = s.reviews.replace(/\|/g, '\n');
    return s;
  }

  /* ---------- image helpers (JUS-52) ---------- */

  // Image helpers live in js/preview-image-defaults.js (shared with
  // the template renderer). This shim keeps the core headless-testable
  // when that file is absent (e.g. bare Node unit tests).
  var IMG = (typeof global.PreviewImageDefaults === 'object' && global.PreviewImageDefaults) || (function () {
    function safeAltText(slot, trade) {
      var t = String(trade || '').trim().toLowerCase();
      if ((slot === 'hero' || slot === 'projectFeatured') && t && t !== 'remodeling') {
        return t.split(/\s+/).map(function (w) {
          return w ? w.charAt(0).toUpperCase() + w.slice(1) : '';
        }).join(' ') + ' inspiration image';
      }
      var base = {
        hero: 'Home remodeling inspiration image',
        projectFeatured: 'Home remodeling inspiration image',
        projectKitchen: 'Kitchen remodeling inspiration image',
        projectBath: 'Bathroom remodeling inspiration image',
        projectWholeHome: 'Whole-home remodeling inspiration image'
      };
      return base[slot] || base.hero;
    }
    function normalizeImageUrl(raw) {
      var v = String(raw === undefined || raw === null ? '' : raw).trim();
      if (!v) return '';
      if (/^(javascript|data|blob|file|vbscript)\s*:/i.test(v)) return '';
      if (!/^(https?:\/\/|\/\/|\/)/i.test(v)) return '';
      return v;
    }
    return { safeAltText: safeAltText, normalizeImageUrl: normalizeImageUrl };
  })();

  function safeAltText(slot, trade) { return IMG.safeAltText(slot, trade); }
  function normalizeImageUrl(raw) { return IMG.normalizeImageUrl(raw); }

  // Pure 3-tier resolution: prospect override -> template default ->
  // placeholder. Mirrors the renderer's resolvePreviewImage; used by
  // the review screen + tests. templateDefaults comes from
  // PreviewImageDefaults.defaultsFor(templateId).
  function resolvePreviewImage(slotKey, previewImages, templateDefaults, trade) {
    if (typeof global.PreviewImageDefaults === 'object' && global.PreviewImageDefaults) {
      return global.PreviewImageDefaults.resolvePreviewImage(slotKey, previewImages, templateDefaults, trade);
    }
    var slot = (previewImages && typeof previewImages === 'object') ? previewImages[slotKey] : null;
    var overrideUrl = normalizeImageUrl(slot && slot.url);
    if (overrideUrl) {
      return { url: overrideUrl, alt: (slot && slot.alt && String(slot.alt).trim()) || safeAltText(slotKey, trade), source: 'prospect', slot: slotKey };
    }
    var def = (templateDefaults && typeof templateDefaults === 'object') ? templateDefaults[slotKey] : null;
    var defUrl = normalizeImageUrl(def && def.url);
    if (defUrl) {
      return { url: defUrl, alt: (def && def.alt && String(def.alt).trim()) || safeAltText(slotKey, trade), source: 'template_default', slot: slotKey };
    }
    return { alt: safeAltText(slotKey, trade), source: 'placeholder', slot: slotKey };
  }

  // Record-level images block from flat state. Every slot is written
  // (url omitted when blank); the renderer + template defaults cover
  // missing values, so no slot is required on the record.
  var IMAGE_SLOT_FIELDS = {
    hero:             ['heroImageUrl', 'heroImageAlt'],
    projectFeatured:  ['projectFeaturedImageUrl', 'projectFeaturedImageAlt'],
    projectKitchen:   ['projectKitchenImageUrl', 'projectKitchenImageAlt'],
    projectBath:      ['projectBathImageUrl', 'projectBathImageAlt'],
    projectWholeHome: ['projectWholeHomeImageUrl', 'projectWholeHomeImageAlt']
  };

  function buildImages(state) {
    var images = {};
    for (var slot in IMAGE_SLOT_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(IMAGE_SLOT_FIELDS, slot)) continue;
      var fields = IMAGE_SLOT_FIELDS[slot];
      images[slot] = {
        url: normalizeImageUrl(state[fields[0]]) || undefined,
        alt: String(state[fields[1]] || '').trim() || safeAltText(slot, state.trade)
      };
    }
    return images;
  }

  /* ---------- validation ---------- */

  var REQUIRED = [
    { key: 'businessName', label: 'Business name', step: 0 },
    { key: 'city',         label: 'City',          step: 0 },
    { key: 'state',        label: 'State',         step: 0 },
    { key: 'trade',        label: 'Trade',         step: 0 }
  ];

  function validate(state) {
    var errors = REQUIRED.filter(function (f) {
      return isBlank(state[f.key]);
    }).map(function (f) {
      return { key: f.key, label: f.label, step: f.step,
               message: f.label + ' is required.' };
    });
    return { ok: errors.length === 0, errors: errors };
  }

  // Recommended-field warnings. Never block generation; the record
  // status reflects them (needs_review) instead.
  function warnings(state) {
    var w = [];
    if (isBlank(state.phone)) w.push('No phone number — the preview will not show a call CTA.');
    if (isBlank(state.websiteUrl)) w.push('No website URL stored.');
    if (splitMulti(state.services).length === 0) w.push('No services entered — safe defaults for the trade will be generated.');
    if (splitMulti(state.serviceAreas).length === 0) w.push('No service areas entered — the communities chip list will stay hidden.');
    if (isBlank(state.heroHeadline) || isBlank(state.heroLede)) w.push('Hero copy not entered — trade-generic defaults will be generated.');
    w.push('No real reviews/projects collected — those sections will stay hidden (honest-copy rule).');
    return w;
  }

  /* ---------- honest defaults (generic, never proof claims) ---------- */

  var TRADE_SERVICE_DEFAULTS = {
    remodeling: ['Kitchen Remodeling', 'Bathroom Remodeling', 'Whole-Home Updates'],
    roofing: ['Roof Replacement', 'Roof Repair', 'Gutter Installation'],
    plumbing: ['Plumbing Repair', 'Water Heater Service', 'Drain Cleaning'],
    hvac: ['AC Installation', 'Furnace Repair', 'Maintenance Plans'],
    landscaping: ['Lawn Care', 'Hardscaping', 'Irrigation Systems'],
    painting: ['Interior Painting', 'Exterior Painting', 'Cabinet Refinishing'],
    electrical: ['Electrical Repair', 'Panel Upgrades', 'Lighting Installation']
  };

  function defaultServicesFor(trade) {
    var t = slugify(trade || '');
    return (TRADE_SERVICE_DEFAULTS[t] || TRADE_SERVICE_DEFAULTS.remodeling).slice();
  }

  function titleCaseTrade(trade) {
    return String(trade || '').toLowerCase().split(/\s+/).map(function (w) {
      return w ? w.charAt(0).toUpperCase() + w.slice(1) : '';
    }).join(' ');
  }

  // Safe, honest copy defaults. Every string here is generic process/
  // positioning language — no licenses, awards, guarantees, urgency,
  // years-in-business, or result claims.
  function defaults(state) {
    var trade = titleCaseTrade(state.trade);
    var name = isBlank(state.businessName) ? 'This Business' : state.businessName;
    var city = isBlank(state.city) ? 'your area' : state.city;
    var stateName = isBlank(state.state) ? '' : state.state.toUpperCase();
    var cityState = stateName ? city + ', ' + stateName : city;
    var serviceTitles = splitMulti(state.services);
    if (!serviceTitles.length) serviceTitles = defaultServicesFor(state.trade);
    var primaryService = serviceTitles[0] || trade + ' Services';

    return {
      meta: {
        title: name + ' \u2014 ' + cityState + ' (Preview)',
        description: trade + ' services for ' + cityState + ' homeowners. Clear estimates, clean work, and a smoother experience.'
      },
      hero: {
        eyebrow: serviceTitles.slice(0, 3).join(' \u00b7 ') || trade,
        headline: trade + ' for ' + city + ' homeowners, done right.',
        lede: isBlank(state.heroLede)
          ? 'Clear communication, clean work, and a straightforward experience from first call to finished ' + (slugify(state.trade) || 'project') + '.'
          : state.heroLede,
        badgeTitle: 'Free estimates',
        badgeSub: 'Honest scope, clear pricing'
      },
      banner: {
        desktopText: 'Preview prepared for ' + name + '. Like this direction?',
        mobileText: 'Like this direction?'
      },
      header: { wordmarkLabel: name + ' \u2014 home' },
      finalCta: {
        eyebrow: 'Free estimates \u00b7 ' + cityState,
        headline: isBlank(state.ctaCopy)
          ? 'Ready to talk about your ' + (slugify(state.trade) || 'project') + '?'
          : state.ctaCopy,
        copy: 'Tell us what you have in mind and we\u2019ll help you take the next step.',
        micro: 'No pressure, no obligation \u2014 just a clear next step.'
      },
      services: serviceTitles,
      processSteps: [
        { id: 'step_request_estimate', title: 'Request an Estimate', copy: 'Tell us what you\u2019re hoping to improve and the best way to reach you.' },
        { id: 'step_walk_through', title: 'Walk Through the Project', copy: 'We review the space, goals, timeline, and details that matter most.' },
        { id: 'step_review_proposal', title: 'Review a Clear Proposal', copy: 'You get a straightforward scope so you can make a confident decision.' },
        { id: 'step_schedule_work', title: 'Schedule the Work', copy: 'Once approved, we coordinate the next steps and keep the project moving.' }
      ]
    };
  }

  /* ---------- record building (flat state -> canonical record) ---------- */

  // resolveStatus: blocked when required fields missing; needs_review
  // when warnings apply (incomplete optional data); ready when the
  // recommended core is present. purchased/launched are NOT assigned
  // by this wizard (later workflow states).
  function resolveStatus(state) {
    var v = validate(state);
    if (!v.ok) return 'blocked';
    var w = warnings(state);
    var significant = w.filter(function (msg) {
      // The reviews/projects hidden notice always applies (honest
      // default) and alone does not force needs_review.
      return msg.indexOf('reviews/projects') === -1;
    });
    return significant.length ? 'needs_review' : 'ready';
  }

  function buildRecord(state, opts) {
    var options = opts || {};
    var v = validate(state);
    if (!v.ok) {
      return { ok: false, errors: v.errors, record: null };
    }

    var id = options.id || generateId();
    var baseSlug = buildSlug(state.businessName, state.city, state.state);
    var slug = ensureUniqueSlug(baseSlug, options.takenSlugs || []);
    var status = options.status || resolveStatus(state);
    var d = defaults(state);
    var now = new Date().toISOString();

    var serviceTitles = splitMulti(state.services);
    var usingDefaultServices = serviceTitles.length === 0;
    if (usingDefaultServices) serviceTitles = d.services;

    var record = {
      id: id,
      slug: slug,
      status: status,

      template: {
        id: state.templateId || 'remodeling-contractor-v1',
        name: 'Remodeling Contractor One-Pager',
        version: '1.0.0'
      },

      business: {
        name: state.businessName,
        city: state.city,
        state: String(state.state || '').toUpperCase().slice(0, 2),
        trade: slugify(state.trade),
        phone: state.phone || undefined,
        phoneHref: state.phone ? 'tel:' + String(state.phone).replace(/[^0-9+]/g, '') : undefined,
        website: state.websiteUrl || undefined,
        email: state.email || undefined
      },

      contact: { fallbackContactMethod: isBlank(state.phone) ? 'form' : 'phone' },
      tracking: { siteId: id, formId: 'question_main' },

      meta: { title: d.meta.title, description: d.meta.description },
      banner: d.banner,
      header: d.header,
      hero: {
        eyebrow: isBlank(state.heroHeadline) ? d.hero.eyebrow : d.hero.eyebrow,
        headline: isBlank(state.heroHeadline) ? d.hero.headline : state.heroHeadline,
        lede: isBlank(state.heroLede) ? d.hero.lede : state.heroLede,
        badgeTitle: d.hero.badgeTitle,
        badgeSub: d.hero.badgeSub
      },

      // Image slots (JUS-52): prospect overrides + safe alt text;
      // blank urls fall through to template defaults / placeholders
      // at render time. Never a proof claim — see data-model §7a.
      images: buildImages(state),

      claims: [], // honest-copy: only real, collected claims
      services: {
        items: serviceTitles.map(function (title, i) {
          return {
            id: 'svc_' + slugify(title) + '_' + (i + 1),
            title: title,
            // Safe generic summary; per-service details come later
            // (owner confirmation / trade copy library).
            summary: title + ' handled with clear communication, clean work, and a straightforward process.'
          };
        })
      },
      projects: { mode: 'auto', items: [] },   // hidden until real photos exist
      reviews: {
        items: state.reviews ? splitMulti(state.reviews).map(function (line, i) {
          var r = parseReviewLine(line);
          return { id: 'rev_' + (i + 1), quote: r.quote, attribution: r.attribution || undefined };
        }) : []                                  // real reviews only (CSV/wizard entry)
      },
      process: { eyebrow: 'How it works', title: 'A simple, straightforward process.', steps: d.processSteps },
      serviceArea: {
        communities: splitMulti(state.serviceAreas)
      },
      finalCta: d.finalCta,

      ownerOffer: {
        eyebrow: 'Launch offer',
        title: 'Make this site yours',
        primaryCta: state.primaryCta || 'Request a Free Estimate',
        secondaryCta: state.secondaryCta || 'Ask a Question'
      },

      visibility: {
        claims: false,
        services: true,
        projects: false,
        process: true,
        reviews: splitMulti(state.reviews).length > 0,
        serviceAreaChips: splitMulti(state.serviceAreas).length > 0
      },

      metadata: {
        createdAt: now,
        updatedAt: now,
        notes: (state.notes || '') + (isBlank(state.positioningNotes) ? '' : (state.notes ? ' | ' : '') + 'Positioning: ' + state.positioningNotes),
        sourceUrl: state.sourceUrl || undefined,
        // Research-only fields — never rendered publicly by default.
        ownerName: state.ownerName || undefined,
        address: state.address || undefined,
        businessHours: state.businessHours || undefined,
        licenseNumber: state.licenseNumber || undefined,
        flags: usingDefaultServices ? ['default_services'] : []
      }
    };

    // Drop undefined values so JSON stays clean.
    function prune(obj) {
      for (var k in obj) {
        if (obj[k] === undefined) delete obj[k];
        else if (obj[k] && typeof obj[k] === 'object') prune(obj[k]);
      }
    }
    prune(record);

    return {
      ok: true,
      errors: [],
      record: record,
      warnings: warnings(state),
      slugBase: baseSlug
    };
  }

  /* ---------- exports ---------- */

  global.WizardCore = {
    isBlank: isBlank,
    splitMulti: splitMulti,
    parseReviewLine: parseReviewLine,
    joinReviews: joinReviews,
    generateId: generateId,
    slugify: slugify,
    buildSlug: buildSlug,
    ensureUniqueSlug: ensureUniqueSlug,
    blankState: blankState,
    loadState: loadState,
    parseCsv: parseCsv,
    stateFromCsvRow: stateFromCsvRow,
    safeAltText: safeAltText,
    normalizeImageUrl: normalizeImageUrl,
    resolvePreviewImage: resolvePreviewImage,
    buildImages: buildImages,
    REQUIRED: REQUIRED,
    validate: validate,
    warnings: warnings,
    defaults: defaults,
    defaultServicesFor: defaultServicesFor,
    resolveStatus: resolveStatus,
    buildRecord: buildRecord
  };

})(typeof window !== 'undefined' ? window : globalThis);
