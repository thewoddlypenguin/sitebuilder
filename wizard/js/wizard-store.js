/* ============================================================
   WIZARD STORE — persistence adapter for the preview site wizard
   ------------------------------------------------------------
   Small localStorage-backed adapter. No database layer exists yet;
   this clearly separates persistence concerns so a future DB can
   replace it without touching the wizard UI or core logic:

     - record creation        -> saveRecord(record)
     - id generation          -> WizardCore.generateId() (core)
     - slug generation        -> WizardCore.buildSlug() (core)
     - schema mapping         -> WizardCore.buildRecord() (core)
     - slug uniqueness        -> takenSlugs() here (knows all records)

   Draft autosave keeps in-progress form state across reloads.
   ============================================================ */

(function (global) {
  'use strict';

  var DRAFT_KEY = 'wizard.draft.v1';
  var RECORDS_KEY = 'wizard.records.v1';

  function available() {
    try {
      var k = '__wizard_probe__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  }

  function readJson(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }

  function writeJson(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) { return false; }
  }

  /* ---------- draft (form state autosave) ---------- */

  function saveDraft(state) {
    return writeJson(DRAFT_KEY, state);
  }

  function loadDraft() {
    return readJson(DRAFT_KEY, null);
  }

  function clearDraft() {
    try { global.localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }

  /* ---------- records ---------- */

  function listRecords() {
    var arr = readJson(RECORDS_KEY, []);
    return Array.isArray(arr) ? arr : [];
  }

  function saveRecord(record) {
    if (!record || !record.id) return { ok: false, error: 'invalid record' };
    var records = listRecords().filter(function (r) { return r.id !== record.id; });
    records.push(record);
    writeJson(RECORDS_KEY, records);
    return { ok: true, count: records.length };
  }

  function getRecord(id) {
    var hit = listRecords().filter(function (r) { return r.id === id; });
    return hit.length ? hit[0] : null;
  }

  // All slugs currently in use — passed to WizardCore.ensureUniqueSlug
  // so generation-time collisions resolve deterministically. Note:
  // future DB-backed storage must enforce a UNIQUE index on slug;
  // this localStorage check is best-effort for single-operator use.
  function takenSlugs() {
    return listRecords().map(function (r) { return r.slug; });
  }

  global.WizardStore = {
    available: available,
    saveDraft: saveDraft,
    loadDraft: loadDraft,
    clearDraft: clearDraft,
    listRecords: listRecords,
    saveRecord: saveRecord,
    getRecord: getRecord,
    takenSlugs: takenSlugs
  };

})(typeof window !== 'undefined' ? window : globalThis);
