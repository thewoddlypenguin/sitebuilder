/* ============================================================
   PREVIEW DATA MAPPER — canonical record -> live PREVIEW_DATA
   ------------------------------------------------------------
   Static preview generation (scripts/generate-preview.js) stores the
   full canonical record (src/types/preview-site.ts) verbatim inside
   the generated page as:

     <script id="preview-data" type="application/json">...</script>

   This module converts that canonical shape into the flat live shape
   js/preview-render.js consumes (js/preview-data.js documents it).
   It runs in the browser (loaded by generated pages, before
   preview-render.js) and in Node (unit tests) — no DOM access.

   Mapping notes (canonical vs live, see docs/template-variable-map.md):
     services.items[].summary    -> services[].copy
     services.items[].detailTitle/detailCopy/includes
                                 -> services[].detail.headline/copy/bullets
     services.eyebrow/title/lede -> servicesMeta.{...} (flat live shape)
     claims[].label              -> claims[].text
     process.steps[].copy        -> process[].copy
     reviews.items[].quote/...   -> reviews[].quote/...
     projects.items[]            -> projects[] (mode "hidden" + no items
                                    stays hidden — honest-copy rule)
     images (JUS-52)             -> images (passed straight through;
                                    renderer resolves slots)
     template.id                 -> template.id (image template defaults)

   Honest-copy rule: this mapper NEVER invents content. Empty lists map
   to empty lists; the renderer hides their sections. Blanks stay
   blank; the renderer clears the keyed elements.
   ============================================================ */

(function (global) {
  'use strict';

  function clean(obj) {
    // Drop undefined values so JSON.stringify output stays tidy; keep
    // empty strings and empty arrays (renderer treats them as blanks).
    var out = {};
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined) out[k] = obj[k];
    }
    return out;
  }

  function mapService(item) {
    if (!item || typeof item !== 'object') return null;
    var entry = {
      icon: item.icon || 'whole-home',
      title: item.title || '',
      copy: item.summary || ''
    };
    // Detail modal fields are optional per service; an entry without
    // any of them keeps its "Learn more" link hidden (renderer rule).
    if (item.detailTitle || item.detailCopy || (item.includes && item.includes.length) || item.goodFit) {
      entry.detail = {
        headline: item.detailTitle || '',
        copy: item.detailCopy || '',
        bullets: (item.includes || []).slice(),
        goodFit: item.goodFit || ''
      };
    }
    return entry.title || entry.copy ? entry : null;
  }

  function mapClaim(item) {
    if (!item) return null;
    if (typeof item === 'string') return { text: item, icon: 'check' };
    if (typeof item !== 'object') return null;
    return item.label ? { text: item.label, icon: item.icon || 'check' } : null;
  }

  function mapReview(item) {
    if (!item || typeof item !== 'object' || !item.quote) return null;
    return { quote: item.quote, attribution: item.attribution || '' };
  }

  function mapProject(item) {
    if (!item || typeof item !== 'object') return null;
    return (item.label || item.caption) ? {
      label: item.label || '',
      caption: item.caption || '',
      highlights: (item.highlights || []).slice()
    } : null;
  }

  function mapProcessStep(item) {
    if (!item || typeof item !== 'object') return null;
    return (item.title || item.copy) ? { title: item.title || '', copy: item.copy || '' } : null;
  }

  function mapList(list, fn) {
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var mapped = fn(list[i]);
      if (mapped) out.push(mapped);
    }
    return out;
  }

  /**
   * Canonical PreviewSiteRecord -> live PREVIEW_DATA object.
   * Unknown record fields are ignored; missing optional values are
   * omitted so the renderer's own defaults (and CLEAR-on-missing
   * behavior) apply.
   */
  function mapRecord(record) {
    record = record && typeof record === 'object' ? record : {};
    var biz = record.business || {};
    var services = record.services || {};
    var projects = record.projects || {};
    var process = record.process || {};
    var reviews = record.reviews || {};
    var serviceArea = record.serviceArea || {};

    // Projects render ONLY when the record both allows the section
    // (mode != "hidden") and carries real items (honest-copy rule).
    var projectItems = projects.mode === 'hidden' ? [] : mapList(projects.items, mapProject);

    var data = {
      template: record.template && record.template.id
        ? { id: record.template.id }
        : undefined,

      business: clean({
        name: biz.name,
        city: biz.city,
        state: biz.state,
        stateName: biz.stateName,
        phone: biz.phone,
        phoneHref: biz.phoneHref,
        trade: biz.trade
      }),

      meta: clean({
        title: record.meta && record.meta.title,
        description: record.meta && record.meta.description
      }),

      banner: clean({
        desktopText: record.banner && record.banner.desktopText,
        mobileText: record.banner && record.banner.mobileText
      }),

      hero: clean({
        eyebrow: record.hero && record.hero.eyebrow,
        headline: record.hero && record.hero.headline,
        lede: record.hero && record.hero.lede,
        location: record.hero && record.hero.location,
        badgeTitle: record.hero && record.hero.badgeTitle,
        badgeSub: record.hero && record.hero.badgeSub
      }),

      claims: mapList(record.claims, mapClaim),
      servicesMeta: clean({
        eyebrow: services.eyebrow,
        title: services.title,
        lede: services.lede
      }),
      services: mapList(services.items, mapService),

      projectsMeta: clean({
        eyebrow: projects.eyebrow,
        title: projects.title,
        lede: projects.lede
      }),
      projects: projectItems,

      processMeta: clean({
        eyebrow: process.eyebrow,
        title: process.title
      }),
      process: mapList(process.steps, mapProcessStep),

      reviewsMeta: clean({
        eyebrow: reviews.eyebrow,
        title: reviews.title
      }),
      reviews: mapList(reviews.items, mapReview),

      serviceArea: clean({
        lede: serviceArea.lede,
        communities: Array.isArray(serviceArea.communities) ? serviceArea.communities.slice() : []
      }),

      finalCta: clean({
        eyebrow: record.finalCta && record.finalCta.eyebrow,
        headline: record.finalCta && record.finalCta.headline,
        copy: record.finalCta && record.finalCta.copy,
        micro: record.finalCta && record.finalCta.micro
      }),

      // Image slots (JUS-52) pass straight through: the renderer
      // resolves override -> template default -> placeholder.
      images: record.images && typeof record.images === 'object' ? record.images : undefined
    };

    return data;
  }

  /**
   * Read the canonical record embedded by the generator and expose it
   * as window.PREVIEW_DATA (live shape). Browser bootstrap for
   * generated pages; no-op outside a DOM.
   */
  function boot() {
    if (typeof document === 'undefined') return null;
    var el = document.getElementById('preview-data');
    if (!el) return null;
    var record;
    try {
      record = JSON.parse(el.textContent || el.innerText);
    } catch (e) {
      record = {};
    }
    global.PREVIEW_DATA = mapRecord(record);
    return global.PREVIEW_DATA;
  }

  global.PreviewDataMapper = {
    mapRecord: mapRecord,
    boot: boot
  };

  // Auto-boot in the browser: when this module loads on a generated
  // page it converts the embedded canonical record (#preview-data)
  // into window.PREVIEW_DATA before preview-render.js runs. No-op in
  // Node (unit tests) and on template pages (no #preview-data tag —
  // they load js/preview-data.js instead).
  if (typeof document !== 'undefined') boot();
})(typeof window !== 'undefined' ? window : globalThis);
