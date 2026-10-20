LOCAL-ONLY DATA DIRECTORY — DO NOT COMMIT
==========================================

This directory holds private PreviewSiteRecord JSON files for real prospects
and customers. Everything in here stays on this machine.

Why it must never enter Git:
- A preview record is a live business profile (owner name, phone, address,
  offer pricing, claim copy). Committing one publishes private customer data
  to the repository, and Git history keeps it there even after deletion.

How to work with it:
- Save canonical records here, e.g.  records/smith-plumbing-bend-or.json
- Generate + QA against it from the project root:
      node scripts/generate-preview.js records/smith-plumbing-bend-or.json
      node scripts/qa-preview.js records/smith-plumbing-bend-or.json
  (or by slug once generated:  node scripts/qa-preview.js smith-plumbing-bend-or)
- .gitignore excludes this whole directory (and *.private.json anywhere).

What belongs in examples/ instead:
- Synthetic, explicitly-labeled test records only:
    examples/preview-site.example.json        (empty-list honest-copy path)
    examples/preview-site.test-plumbing.json  (populated QA path; $comment says
                                               test-data, never outreach)
  Never save a real business under examples/.

Reminder: dist/ is generated from these records and is also ignored — even
after the record is deleted, its data would remain embedded in the generated
HTML, so dist/ must never be committed either.
