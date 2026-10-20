# Preview Site Data Model

Project: Preview Site Generator MVP
Last updated: 2026-10-14
Type definitions: `src/types/preview-site.ts`
Example record: `examples/preview-site.example.json`
Template hook map: `docs/template-variable-map.md`
Operational decisions: `docs/launch-architecture-decisions.md`

## 1. Purpose

This document defines the canonical data model for a generated preview
site — the single contract that the CSV importer, wizard UI, database
model, preview renderer, and static exporter all rely on.

It describes the **target canonical shape**, not the current shape of
`js/preview-data.js`. The current template's renderer already
understands most of these fields (with renderer-derived fallbacks); the
canonical model formalizes them, adds lifecycle/snapshot/tracking
fields the static template does not yet carry, and normalizes naming
for future niches.

Related decisions (noindex policy, hosting, central form endpoint,
Turnstile, launch checklists) live in `docs/launch-architecture-decisions.md`
and are referenced here only where the schema must reserve fields.

## 2. Top-level schema shape

```ts
PreviewSiteRecord {
  // Identity + lifecycle
  id: string                       // platform-internal, never in URLs
  slug: string                     // durable public preview identifier
  status: PreviewStatus

  // Snapshots
  template: TemplateSnapshot       // required
  campaign?: CampaignSnapshot      // includes offerSnapshot

  // Core content
  business: BusinessData           // name/city/state/trade required
  contact?: ContactData            // notification/form/Turnstile placeholders
  tracking?: TrackingData

  // Page chrome + meta
  meta?: MetaData
  banner?: BannerData
  header?: HeaderData
  hero?: HeroData
  images?: PreviewImages

  // Customer-facing sections (items arrays)
  claims: ClaimItem[]
  services: ServicesSection
  projects: ProjectsSection
  process: ProcessSection
  reviews: ReviewsSection
  serviceArea: ServiceAreaSection
  finalCta?: FinalCtaSection

  // Owner-facing layer
  ownerOffer?: OwnerOfferSnapshot

  // Derived / operational
  visibility?: VisibilityState
  metadata?: PreviewMetadata
}
```

Authoritative field-by-field definitions live in
`src/types/preview-site.ts` (JSDoc comments). This document defines the
rules and rationale; the TS file is the machine-checkable contract.

## 3. Preview status lifecycle

```ts
type PreviewStatus =
  | "ready"         // preview is complete enough for outreach
  | "needs_review"  // generated, but needs manual QA or cleanup
  | "blocked"       // missing/invalid required data prevents use
  | "purchased"     // client purchased/approved the preview
  | "launched";     // site deployed to production
```

Rules (aligned with `docs/launch-architecture-decisions.md` §1):

- Status drives workflow only — it does **not** control whether the
  preview URL responds. Previews are public-if-you-have-the-link and
  always `noindex`.
- Suggested transitions:
  - import/generate -> `needs_review` (default) or `blocked` when
    required fields are missing/invalid
  - `needs_review` -> `ready` after manual QA
  - `ready` -> `purchased` on checkout/approval
  - `purchased` -> `launched` after production deployment
- `blocked` must carry the reason in `metadata.flags` and/or
  `validation` (database model, §10).
- Records may skip states (a manually authored preview can be born
  `ready`), but `launched` must only be set after deployment.

## 4. Durable slug identifier

```ts
slug: string
```

- The slug is the durable **public** preview identifier.
- Preview URL is derived from the slug:
  `https://preview.yourdomain.com/{slug}` — e.g.
  `https://preview.yourdomain.com/cascade-home-remodeling-bend-or`
- Rules:
  - lowercase, URL-safe (`[a-z0-9-]`, hyphen-separated)
  - unique across the platform
  - stable — set at creation, never regenerated from business data
    (renames must not change URLs already sent to prospects)
  - must not depend on the internal database `id`
- Suggested derivation: `{business-name}-{city}-{state}` slugified,
  with a short random/sequential suffix appended on collision.
- Both `id` and `slug` exist because outreach links use the slug while
  internal references (forms, database, exports manifest) use `id`.

## 5. Campaign / offer snapshot

```ts
campaign: {
  id: string
  name?: string
  generatedAt?: string   // ISO 8601
  source?: string        // "csv_import" | "manual" | campaign tag
  offerSnapshot: {
    price: number
    currency: string     // ISO 4217, default "USD"
    priceLabel: string   // display label, e.g. "$500"
    offerName?: string
    primaryCta: string   // e.g. "Launch for $500"
    secondaryCta?: string
    checkoutUrl?: string
    termsLabel?: string
  }
}
```

Why snapshot (vs. referencing the live campaign):

- Campaign config may change later (price bump, new perks, new CTA).
- The preview must preserve the price and offer shown at generation
  time — what the prospect saw is what the owner-facing drawer keeps
  showing, and what the checkout flow charges.
- Outreach links and owner-facing drawer copy stay stable.
- `ownerOffer` mirrors these values for the drawer UI; both are
  written at generation time from the same source.

## 6. Contact / form placeholders

```ts
contact: {
  notificationEmail?: string
  formAction?: string
  turnstileSiteKey?: string
  leadSource?: string
  fallbackContactMethod?: "phone" | "form" | "email"
}
```

- `contact.formAction` is **optional for now**: the current static
  preview ships with a blank endpoint (`data-form-endpoint=""`); the
  question form stays usable as a client-side flow with clear status.
- `contact.turnstileSiteKey` is **optional for now**: Turnstile is
  required later for production form submissions (see
  `docs/launch-architecture-decisions.md` §7); static previews may
  leave it blank.
- `notificationEmail` will later receive form submissions via the
  central platform endpoint.
- `fallbackContactMethod` tells the template which contact route to
  emphasize when no form endpoint is configured (default `phone`).
- Production forms will post to a central platform endpoint
  (`https://api.yourplatform.com/forms/submit`) with hidden
  `site_id` / `form_id` fields — see `tracking.siteId` / `tracking.formId`.

## 7. Section visibility rules

Deterministic rules — no section ever renders placeholder content:

```ts
claims.visible    = claims.length > 0
services.visible  = services.items.length > 0
projects.visible  = projects.items.length > 0 && projects.mode !== "hidden"
process.visible   = process.steps.length > 0
reviews.visible   = reviews.items.length > 0
serviceArea chips = serviceArea.communities.length > 0   // section itself may stay
```

Additional rules:

- **Nav follows sections.** If a section is hidden, the corresponding
  `[data-preview-nav="..."]` items (header + footer) must be hidden
  too. The current renderer already does this; the wizard/exporter must
  apply the same rule when pre-rendering.
- **Honest-copy rule.** Reviews, projects, and claims must not show
  invented content. Invalid entries (`null`, empty objects) are dropped
  by the renderer's `usableEntries()` filter; importers should drop
  them even earlier with a validation error.
- **Empty optional arrays hide their sections** instead of showing
  placeholders.
- `projects.mode: "hidden"` lets a record carry real project data that
  is intentionally held back (e.g. photos pending) without deleting it.
- `visibility` records the resolved state (derived, not authored); it
  is a convenience for the wizard/QA tools and for static export, where
  the render-time decision is frozen into the HTML.

## 7a. Image slots (JUS-52)

The preview supports named image slots with an explicit resolution
order. The system is **URL-based only** (MVP): no uploads, no image
transformations, no media library, no network validation of URLs.

```ts
images?: PreviewImages
// slots: hero | projectFeatured | projectKitchen | projectBath |
//        projectWholeHome
// each slot: { url?, alt?, notes? }
```

### Resolution order (explicit, tested)

```
1. prospect override        images.<slot>.url on the record
2. template default         js/preview-image-defaults.js
                            (TEMPLATE_DEFAULTS[template.id][slot])
3. styled placeholder       renderer keeps the line-art .ph figure
```

- A blank, missing, or invalid URL (anything that is not http(s),
  protocol-relative `//`, or root-relative `/` — `javascript:`,
  `data:`, `blob:` are rejected) is treated exactly like a blank one.
  A missing image can never break the preview: the styled placeholder
  always renders.
- `safeAltText(slot, trade)` supplies alt text when the record's
  `alt` is blank. Defaults are generic ("Home remodeling inspiration
  image", "Kitchen remodeling inspiration image", ...); the two
  whole-page slots (hero, projectFeatured) adapt to the trade
  ("Roofing inspiration image" for a roofing preview).
- No slot is required on the record. `buildImages()` in the wizard
  core writes every slot with safe alts; template defaults and
  placeholders cover the rest at render time.

### Current template slot mapping (remodeling-contractor-v1)

| Slot | Template location | Notes |
|---|---|---|
| `hero` | hero media frame (`.ph--hero`, `data-preview-img="hero"`) | Always visible — overrides swap the placeholder in place |
| `projectFeatured` | projects collage, position 0 (featured span) | Collage renders only with real `projects[]` entries (honest-copy rule §7) |
| `projectKitchen` | projects collage, position 1 | |
| `projectBath` | projects collage, position 2 | |
| `projectWholeHome` | projects collage, position 3 | Extra entries fall back to this slot |

Renderer hooks: `data-preview-img="<slot>"` marks the placeholder
figure; the renderer swaps in an `<img class="ph__img">` when a URL
resolves and restores the line-art figure when it does not. Re-renders
(`renderPreview(data)`) are repeatable — clones are rebuilt pristine
and the hero figure is restored in place.

### Honest-copy rules for imagery

- **Allowed alt wording**: "Kitchen remodeling inspiration image",
  "Home remodeling design inspiration", "Project image provided by
  business" (only when the business really provided it).
- **Avoid unless explicitly supported by real data**: "Completed
  project by {business.name}", "Our recent remodel in {city}", "Before
  and after", "Award-winning remodel", "Portfolio project", "Our work".
  A generic stock or default image must never read as this business's
  completed project.
- A prospect-provided URL may be labeled neutrally ("Inspiration
  image") unless the data explicitly identifies it as a real business
  project.
- Image slots never create `projects[]` entries, claims, or
  visibility. Overrides change pixels, not proof.
- Production export still copies approved assets locally rather than
  hotlinking (§10); hotlinked URLs are acceptable for preview rendering.

### Migration from the asset-refs convention

`hero_image_url` was previously folded into operator `metadata.notes`
("Asset refs (not rendered)"). It is now a first-class override mapped
to `images.hero.url`. `logo_url` and `project_images` remain source
references in notes (no logo slot contract exists; `project_images` is
a pipe list without per-slot mapping) — see §10.


## 8. Current template coverage (remodeling contractor v1)

The canonical model is a superset of the live template. Mapping notes:

- Field names follow the niche-neutral convention (`services.items`,
  `projects.items`, `reviews.items`, `serviceArea.communities`).
- The current renderer reads a flatter shape (`data.services`,
  `data.projects`, ...) with section metadata in `*Meta` objects
  (`servicesMeta.eyebrow`, ...). The canonical shape folds section
  headings into the section object (`services.eyebrow`, `services.title`).
  `docs/template-variable-map.md` lists the exact current-hook ->
  canonical-path correspondence.
- Derived fields the renderer already computes (`business.cityState`,
  `business.nameFirst/nameRest`, `header.wordmarkLabel`,
  `hero.location`, `serviceArea.chip`, `meta.title` fallback) are
  declared optional in the canonical model: authors may supply them,
  otherwise the renderer derives them.
- `projects[0].highlights` feeds the copy-column bullet list next to
  the collage (`projectHighlights` hook).
- Service detail modal content comes from per-item detail fields
  (canonical: `detailTitle` / `detailCopy` / `includes` / `goodFit`).
- The owner-facing launch drawer copy lives in `ownerOffer` (currently
  hardcoded in the template; canonical model snapshots it).
- `banner`, `header`, `meta` have renderer-derived fallbacks in the
  current template; canonical marks them optional with documented
  default derivations.

## 9. Multi-niche flexibility

The schema is named for reuse across home-service verticals (roofing,
plumbing, HVAC, landscaping, painting, electrical, ...):

- `business.trade` is the primary niche key (e.g. "roofing").
- `business.category` / `business.niche` refine positioning without
  template forks.
- Section names stay generic (`services.items`, `projects.items`,
  `reviews.items`, `finalCta`, `ownerOffer`).
- `ServiceItem` fields are vertical-neutral; icon keys are
  template-defined, with a sensible default (`whole-home`) for
  unknown keys.
- Per-template copy fallbacks live in the template/renderer, not in
  shared schema fields, so a plumbing template can default hero copy
  differently without a schema change.

## 10. CSV import mapping

The CSV input template lives at `docs/preview-site-input-template.csv`
(header row + one Cascade Home Remodeling sample row). It is
**campaign-agnostic**: no campaign, offer, price, checkout, or discount
columns — campaign/offer values enter the record through the
generation workflow (§5), never through prospect research input.

### Column order and requirement tiers

| CSV Column | Required? | Schema Path | Notes |
|---|---:|---|---|
| `business_name` | Yes | `business.name` | Minimum for a usable preview; importer rejects blanks (record `blocked`) |
| `city` | Yes | `business.city` | Used in slug + localized copy |
| `state` | Yes | `business.state` | Code or full name; code preferred |
| `trade` | Yes | `business.trade` | Drives template selection + copy defaults |
| `phone` | Recommended | `business.phone` | `phoneHref` derived when omitted |
| `website_url` | Recommended | `business.website` | Business's own site |
| `services` | Recommended | `services.items[]` | Pipe-separated titles; blank -> generator defaults for the trade |
| `service_areas` | Recommended | `serviceArea.communities` | Pipe-separated community names |
| `hero_image_url` | Optional | `images.hero.url` | Prospect override for the hero image slot (JUS-52); invalid URLs are treated as blank and fall back to template default/placeholder. Not a proof claim |
| `hero_image_alt` | Optional | `images.hero.alt` | Safe generic alt generated when blank |
| `project_featured_image_url` | Optional | `images.projectFeatured.url` | Projects collage slot 0 |
| `project_featured_image_alt` | Optional | `images.projectFeatured.alt` | Safe generic alt generated when blank |
| `project_kitchen_image_url` | Optional | `images.projectKitchen.url` | Projects collage slot 1 |
| `project_kitchen_image_alt` | Optional | `images.projectKitchen.alt` | Safe generic alt generated when blank |
| `project_bath_image_url` | Optional | `images.projectBath.url` | Projects collage slot 2 |
| `project_bath_image_alt` | Optional | `images.projectBath.alt` | Safe generic alt generated when blank |
| `project_whole_home_image_url` | Optional | `images.projectWholeHome.url` | Projects collage slot 3 |
| `project_whole_home_image_alt` | Optional | `images.projectWholeHome.alt` | Safe generic alt generated when blank |
| `owner_name` | Optional | business/contact metadata (research only) | Research metadata for personalized outreach; NOT rendered publicly by default |
| `email` | Optional | `business.email` | Default mapping. Client notification email (`contact.notificationEmail`) is confirmed later during onboarding/purchase — never assumed from research |
| `logo_url` | Optional | operator notes (legacy) | Still a source/asset reference only — no logo slot contract exists; wordmark used when blank |
| `project_images` | Optional | operator notes (legacy) | Pipe-separated source/asset references kept in notes (JUS-44 convention). Must NOT become `projects[]` entries or image-slot overrides — per-slot columns above are the override path |
| `reviews` | Optional | `reviews.items[]` | Pipe-separated entries, `quote::attribution`; real quotes only; no line breaks inside entries |
| `address` | Optional | optional business address metadata (research only) | Research metadata; NOT rendered publicly by default — many home-service businesses don't want a public address shown. Rendering (maps/footers) requires owner confirmation |
| `business_hours` | Optional | optional business metadata | Not rendered in v1 |
| `license_number` | Optional | optional verified credential field | Store-only by default: may be stored if found, but NOT rendered as a public credential/claim until verified in a later workflow. Never guess |
| `notes` | Optional | `metadata.notes` | Operator/research notes, never rendered |
| `source_url` | Optional | `metadata.sourceUrl` | Provenance for research/QA |

### Conventions

- **Multi-value fields use `|` (pipe) separation.** `services`,
  `service_areas`, `project_images` are pipe-separated lists.
- **`services` is a pipe-separated list of service titles.** The
  generator may create safe default summaries/details from the
  trade/template for each title.
- **`reviews` entries use `::` inside each pipe-separated entry:**
  `quote::attribution|quote::attribution` — e.g.
  `Great communication throughout.::Homeowner in Bend|Clean work and clear pricing.::Local customer`.
  Real quotes only — left blank unless real. Avoid line breaks inside
  review text (keep each quote a single line).
- **Unknown fields are left blank.** Blank optional fields are valid and
  rely on generator defaults or hidden sections — never placeholder text.
- **No invented content.** No placeholder claims, fake reviews, fake
  licenses, fake awards, guessed certifications, or fake project images.
  Reviews, licenses, certifications, and claims must not be invented.
- **Research-only fields are not rendered publicly by default.**
  `owner_name`, `address`, and `business_hours` are research metadata
  for outreach/personalization; rendering them requires owner
  confirmation. `license_number` may be stored if found but is not
  rendered as a public credential/claim until verified in a later
  workflow.
- **Image slot overrides (JUS-52) are URL-based first-class fields.**
  `hero_image_url` and the four `project_*_image_url` columns map into
  `images.<slot>.url`; the matching `_alt` columns map into
  `images.<slot>.alt` (safe generic alt when blank). Resolution at
  render time: prospect override -> template default -> styled
  placeholder (§7a). Invalid URLs are treated as blank. Image columns
  never create `projects[]` entries, claims, or visibility — overrides
  change pixels, not proof.
- **Legacy asset columns are source references, not hotlinks.**
  `logo_url` and `project_images` remain operator-note references
  ("Asset refs (not rendered)"); future production export must copy
  approved assets locally rather than hotlinking by default.
- **Campaign-agnostic.** No `campaign_id`, `offer_price`, `checkout_url`,
  or `discount` columns.

### Import rules

- Missing required columns (or blank required cells) -> record status
  `blocked` (never silently guessed).
- `state` normalization: accept "OR" or "Oregon"; store code in
  `state`, full name in `stateName` when known.
- `phone` normalization: keep display format in `phone`; derive
  `phoneHref` as `tel:` + digits.
- `services` splitting: trim, drop empties; each title becomes a
  `ServiceItem` with `id` assigned by the importer; blank -> generator
  derives default services for the trade.
- `service_areas` splitting: trim, drop empties; empty result leaves
  `communities: []` (chip list hidden, section lede remains).
- `reviews` parsing: split on `|`, then each entry on first `::`; entry
  without `::` is treated as quote-only. Reject or flag entries
  containing line breaks. Only pre-collected real reviews belong here.
- `email` maps to `business.email` by default; do not copy it into
  `contact.notificationEmail` (that is confirmed during
  onboarding/purchase).
- Image slot columns (`hero_image_url`, `project_*_image_url` +
  `_alt`) map into `images.<slot>` via `stateFromCsvRow` (§7a);
  invalid URLs are treated as blank at render time. `logo_url` and
  `project_images` stay stored as source references in
  `metadata.notes`; the importer must not inline or hotlink them into
  generated HTML, and `project_images` must never become project
  entries. Local asset copying happens at production export, for
  approved assets only.
- Duplicate slug -> append suffix; original outreach URL stability is
  preserved because slugs are assigned once.

### Generator-derivable display fields

The generator derives these when the CSV leaves them blank (the current
renderer's fallbacks already behave this way — see
`docs/template-variable-map.md`):

- `business.nameFirst`, `business.nameRest` (from `business.name`)
- `business.cityState` (from `business.city` + `stateName`/`state`)
- `business.phoneHref` (from `business.phone`)
- `meta.title`, `meta.description` (trade-generic defaults)
- `hero.*` copy (trade + city aware defaults)
- `finalCta.*` copy
- default `services.items[]` for the trade (titles only, honest-copy)
- section eyebrows/titles/ledes

Optional proof sections (`claims`, `projects`, `reviews`) remain hidden
unless real data exists — blank CSV cells must never produce invented
content.

## 11. Suggested database model (MVP)

Hybrid: queryable identity fields top-level, full content in JSON.

```ts
PreviewSite {
  id: string            // primary key
  slug: string          // unique index
  status: PreviewStatus

  templateId: string
  campaignId?: string

  businessName: string  // denormalized from data.business.name
  city: string
  state: string
  trade: string

  data: Json            // full PreviewSiteRecord (canonical schema)
  validation?: Json     // importer/QA findings: { ok, errors[], warnings[] }

  createdAt: Date
  updatedAt: Date
  purchasedAt?: Date
  launchedAt?: Date
}
```

Why hybrid:

- Queryable fields stay top-level: fast filtering by status, trade,
  city, campaign; no JSON path queries for common admin lists.
- Full preview content lives in one JSON column — the canonical
  `PreviewSiteRecord`. Renderer, wizard, and exporter all consume the
  same shape.
- Avoids over-normalizing too early: sections evolve with templates;
  JSON absorbs that without migrations.
- Supports fast CSV import (one row per business) and future wizard
  editing (read-modify-write the JSON with optimistic locking on
  `updatedAt`).
- `validation` mirrors importer/QA results so `needs_review` /
  `blocked` records carry actionable reasons.

## 12. Example object

See `examples/preview-site.example.json` — a complete, realistic record
using the current Cascade Home Remodeling content in the canonical
schema (`id: preview_example_cascade_home_remodeling`,
`slug: cascade-home-remodeling-bend-or`, `status: ready`).

Intentionally-empty sections in the example:

```json
"claims": [],
"projects": { "mode": "hidden", "items": [] },
"reviews": { "items": [] }
```

These remain hidden per the visibility rules — the example demonstrates
the honest-copy rule: empty proof sections are the correct state for a
business with no collected reviews/projects/claims, not an error.

## 12a. Wizard input flow (JUS-45)

The internal wizard lives at `wizard/index.html` (open directly or via
the project's static server — `python -m http.server 3000` then visit
`/wizard/`). It is a plain HTML/CSS/vanilla-JS internal tool; no AI or
API integration is involved at any point.

- `wizard/js/wizard-core.js` — pure logic: slug/id generation,
  validation, warnings, honest defaults, flat form state -> canonical
  record mapping. Headless-testable; runs in Node and the browser.
- `wizard/js/wizard-store.js` — persistence adapter (localStorage for
  drafts + records, slug uniqueness source). Replace with the database
  layer when it exists; core/UI stay untouched.
- `wizard/js/wizard-app.js` — step controller and DOM binding
  (5 steps, inline validation, review screen, JSON download).

Status behavior in the wizard: `blocked` when required fields are
missing (generation refused, jumps to the offending step with inline
errors), `needs_review` when generated with warnings, `ready` when
recommended data is complete. `purchased`/`launched` are not assigned
by the wizard (later workflow states).

Slug rules: built from `business_name + city + state`
(`Cascade Home Remodeling` + `Bend` + `OR` ->
`cascade-home-remodeling-bend-or`), lowercase/URL-safe/stable, and
independent of the internal id. The localStorage adapter resolves
collisions with a `-2`, `-3`, ... suffix at generation time; a future
database layer must enforce a UNIQUE index on `slug` instead.

CSV prefill: implemented. `WizardCore.parseCsv()` parses a template
file (RFC-4180 quotes, comma/semicolon sniff, BOM/CRLF/#-comment
tolerance, case-insensitive headers) and `stateFromCsvRow()` maps one
row into the wizard's flat state (same column names, same multi-value
conventions). The import control on wizard step 1 prefills the form
via `loadState()`; importing replaces mapped fields and reports what
stayed blank. Image slot columns (`hero_image_url`,
`project_*_image_url` + `_alt`) are first-class overrides mapped into
flat image state (JUS-52) and land in the record's `images` block;
legacy `logo_url`/`project_images` stay source references in the
operator's `notes` ("Asset refs (not rendered): …"). Real reviews
(`quote::attribution|...`) flow into `reviews.items` with
`visibility.reviews` set, per the honest-copy rule; collision suffixes
still resolve only at generation time. Headless
tests: `node test/wizard-core-test.js`.

## 13. Change management

- Field names are a stable contract for CSV, wizard, DB, renderer, and
  export. Renames require a schema version bump.
- Additive optional fields are always safe.
- The template hook map (`docs/template-variable-map.md`) is updated
  in the same change as any renderer hook change.
