/* ============================================================
   PREVIEW IMAGE DEFAULTS — template image slots (JUS-52)
   ------------------------------------------------------------
   Single configuration + resolution point for preview images.
   Loaded by BOTH the template page (before preview-render.js) and
   the wizard (before wizard-core.js) so defaults live here, never
   scattered through renderer logic.

   Resolution order (explicit, tested):
     1. prospect override   (record images.<slot>.url)
     2. template default    (defaultsFor(templateId)[slot].url)
     3. styled placeholder  (renderer keeps the .ph line-art figure)

   URL-based only (MVP): no uploads, no transformations, no media
   library, no network validation. Only http(s)/protocol-relative/
   root-relative URLs pass normalizeImageUrl; anything else
   (javascript:, data:, ftp:, plain text) is treated as blank.

   Honest-copy rule for imagery: alt text stays generic unless the
   image is really the prospect's. Never imply a pictured project was
   completed by the business (see docs/preview-site-data-model.md
   §7a for the full rules).
   ============================================================ */

(function (global) {
  'use strict';

  /* ---------- slot keys (canonical: images.<slot>*) ---------- */

  var SLOTS = ['hero', 'projectFeatured', 'projectKitchen', 'projectBath', 'projectWholeHome'];

  /* ---------- template defaults ---------- */

  // remodeling-contractor-v1 image slots. Ship EMPTY: the styled
  // line-art placeholders stay visible until the studio drops
  // approved, license-cleared stock URLs here. Anything filled in
  // renders on EVERY preview that lacks a prospect override.
  //
  // alt: optional studio-written alt for the default image; blank
  // falls back to safeAltText(slot).
  var TEMPLATE_DEFAULTS = {
    'remodeling-contractor-v1': {
      hero:             { url: '', alt: '' },
      projectFeatured:  { url: '', alt: '' },
      projectKitchen:   { url: '', alt: '' },
      projectBath:      { url: '', alt: '' },
      projectWholeHome: { url: '', alt: '' }
    }
  };

  function defaultsFor(templateId) {
    return TEMPLATE_DEFAULTS[templateId || 'remodeling-contractor-v1'] ||
           TEMPLATE_DEFAULTS['remodeling-contractor-v1'];
  }

  /* ---------- safe alt text (generic, never proof claims) ---------- */

  var SAFE_ALT = {
    hero:             'Home remodeling inspiration image',
    projectFeatured:  'Home remodeling inspiration image',
    projectKitchen:   'Kitchen remodeling inspiration image',
    projectBath:      'Bathroom remodeling inspiration image',
    projectWholeHome: 'Whole-home remodeling inspiration image'
  };

  // Generic safe alt for a slot. `trade` only adjusts the two
  // whole-home slots (a roofing preview should not read "remodeling");
  // room-specific slots describe the template's sections and stay.
  function safeAltText(slot, trade) {
    var t = String(trade || '').trim().toLowerCase();
    if ((slot === 'hero' || slot === 'projectFeatured') && t && t !== 'remodeling') {
      var words = t.split(/\s+/).map(function (w) {
        return w ? w.charAt(0).toUpperCase() + w.slice(1) : '';
      });
      return words.join(' ') + ' inspiration image';
    }
    return SAFE_ALT[slot] || SAFE_ALT.hero;
  }

  /* ---------- URL safety ---------- */

  // Accept http(s), protocol-relative (//), and root-relative (/)
  // URLs. Reject anything executable or exotic — a bad value is
  // treated exactly like a blank one (placeholder fallback).
  function normalizeImageUrl(raw) {
    var v = String(raw === undefined || raw === null ? '' : raw).trim();
    if (!v) return '';
    if (/^(javascript|data|blob|file|vbscript)\s*:/i.test(v)) return '';
    if (!/^(https?:\/\/|\/\/|\/)/i.test(v)) return '';
    return v;
  }

  /* ---------- resolution (the tested contract) ---------- */

  // resolvePreviewImage(slotKey, previewImages, templateDefaults, trade)
  //   -> { url?, alt, source: 'prospect'|'template_default'|'placeholder', slot }
  //
  // previewImages:    record-level images block (authored overrides)
  // templateDefaults: defaultsFor(templateId) output
  // url is OMITTED for placeholder sources; alt is always present.
  function resolvePreviewImage(slotKey, previewImages, templateDefaults, trade) {
    var slot = (previewImages && typeof previewImages === 'object') ? previewImages[slotKey] : null;
    var overrideUrl = normalizeImageUrl(slot && slot.url);
    if (overrideUrl) {
      return {
        url: overrideUrl,
        alt: (slot && slot.alt && String(slot.alt).trim()) || safeAltText(slotKey, trade),
        source: 'prospect',
        slot: slotKey
      };
    }
    var def = (templateDefaults && typeof templateDefaults === 'object') ? templateDefaults[slotKey] : null;
    var defUrl = normalizeImageUrl(def && def.url);
    if (defUrl) {
      return {
        url: defUrl,
        alt: (def && def.alt && String(def.alt).trim()) || safeAltText(slotKey, trade),
        source: 'template_default',
        slot: slotKey
      };
    }
    return { alt: safeAltText(slotKey, trade), source: 'placeholder', slot: slotKey };
  }

  /* ---------- exports ---------- */

  global.PreviewImageDefaults = {
    SLOTS: SLOTS,
    TEMPLATE_DEFAULTS: TEMPLATE_DEFAULTS,
    defaultsFor: defaultsFor,
    safeAltText: safeAltText,
    normalizeImageUrl: normalizeImageUrl,
    resolvePreviewImage: resolvePreviewImage
  };

})(typeof window !== 'undefined' ? window : globalThis);
