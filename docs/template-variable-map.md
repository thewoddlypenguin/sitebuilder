# Template Variable Map

Project: Preview Site Generator MVP
Last updated: 2026-10-14
Canonical schema: `src/types/preview-site.ts`
Data model rules: `docs/preview-site-data-model.md`

This document maps every replaceable hook in the current template
(`index.html`, template `remodeling-contractor-v1`) to its canonical
schema path. It is the contract between the template and the canonical
data model — the CSV importer, wizard, and static exporter should treat
this table as authoritative for "what the template can receive."

Legend:

- **Required?** — Yes = required for a usable record (importer blocks
  without it); Recommended = strongly expected, safe fallback exists;
  Optional = renderer clears/hides gracefully when absent.
- **Behavior** — what the renderer does with the value. "Clears" means
  the keyed element is emptied (honest-copy safe), never left with
  template demo content.

## 1. Fill hooks — `data-preview-key`

Plain text fill unless a modifier attribute is present.

| Template Hook / Selector | Canonical Schema Path | Required? | Behavior |
|---|---|---:|---|
| `data-preview-key="meta.title"` | `meta.title` | Recommended | Sets `<title>` text; derived default `{name} — {city}, {state} (Preview)` |
| `data-preview-key="meta.description"` + `data-preview-attr="content"` | `meta.description` | Recommended | Sets meta description `content` attr; derived trade-generic default |
| `data-preview-key="banner.desktopText"` | `banner.desktopText` | Recommended | Preview banner text (desktop); derived `Preview prepared for {name}. Like this direction?` |
| `data-preview-key="banner.mobileText"` | `banner.mobileText` | Recommended | Preview banner text (mobile); default `Like this direction?` |
| `data-preview-key="header.wordmarkLabel"` + `data-preview-attr="aria-label"` | `header.wordmarkLabel` | Recommended | Wordmark `aria-label`; derived `{name} — home` |
| `data-preview-key="business.name"` | `business.name` | Yes | Text fill (header, owner card); also fills question-form input via `data-preview-value`; fallback `This Business` |
| `data-preview-key="business.nameFirst"` | `business.nameFirst` (derived) | Recommended | Wordmark first word; derived from `business.name` |
| `data-preview-key="business.nameRest"` | `business.nameRest` (derived) | Recommended | Wordmark remaining words; derived from `business.name` |
| `data-preview-key="business.phone"` | `business.phone` | Optional | Display phone text; clears when absent |
| `data-preview-key="business.phoneHref"` + `data-preview-attr="href"` | `business.phoneHref` (derived) | Optional | Updates `href` for `tel:` links; derived from `phone` when omitted |
| `data-preview-key="business.cityState"` | `business.cityState` (derived) | Recommended | `{city}, {stateName/state}` composite; footer + hero location |
| `data-preview-key="hero.eyebrow"` | `hero.eyebrow` | Recommended | Kicker line; clears when absent |
| `data-preview-key="hero.headline"` + `data-preview-html` | `hero.headline` | Recommended | H1 innerHTML — **only trusted-HTML key** (one `<em>`); derived default |
| `data-preview-key="hero.lede"` | `hero.lede` | Recommended | Hero paragraph; derived default |
| `data-preview-key="hero.location"` | `hero.location` (derived) | Optional | `Serving {cityState} and nearby communities.` |
| `data-preview-key="hero.badgeTitle"` | `hero.badgeTitle` | Optional | Badge title; default `Free estimates` |
| `data-preview-key="hero.badgeSub"` | `hero.badgeSub` | Optional | Badge subtitle; default `Honest scope, clear pricing` |
| `data-preview-key="services.eyebrow"` | `services.eyebrow` | Optional | Default `What we do` |
| `data-preview-key="services.title"` | `services.title` | Optional | Default `Remodeling, handled with care.` |
| `data-preview-key="services.lede"` | `services.lede` | Optional | Section lede; derived default |
| `data-preview-key="projects.eyebrow"` | `projects.eyebrow` | Optional | Default `Project showcase` |
| `data-preview-key="projects.title"` | `projects.title` | Optional | Default `See what's possible for your home.` |
| `data-preview-key="projects.lede"` | `projects.lede` | Optional | Section lede; derived default |
| `data-preview-key="process.eyebrow"` | `process.eyebrow` | Optional | Default `How it works` |
| `data-preview-key="process.title"` | `process.title` | Optional | Default `A simple, straightforward process.` |
| `data-preview-key="reviews.eyebrow"` | `reviews.eyebrow` | Optional | Default `What homeowners say` |
| `data-preview-key="reviews.title"` | `reviews.title` | Optional | Default `Word of mouth, in writing.` |
| `data-preview-key="serviceArea.eyebrow"` | `serviceArea.eyebrow` | Optional | Default `Service area` |
| `data-preview-key="serviceArea.title"` | `serviceArea.title` | Optional | Derived `Serving {cityState} and nearby communities.` |
| `data-preview-key="serviceArea.lede"` | `serviceArea.lede` | Recommended | Derived `{name} works with homeowners throughout {cityState}.` |
| `data-preview-key="serviceArea.chip"` | `serviceArea.chip` (derived) | Optional | Legend chip; derived `{communities[0]} service area` |
| `data-preview-key="finalCta.eyebrow"` | `finalCta.eyebrow` | Optional | Derived `Free estimates · {cityState}` |
| `data-preview-key="finalCta.headline"` | `finalCta.headline` | Optional | Default `Ready to talk about your remodel?` |
| `data-preview-key="finalCta.copy"` | `finalCta.copy` | Optional | Derived default |
| `data-preview-key="finalCta.micro"` | `finalCta.micro` | Optional | Default `No pressure, no obligation — just a clear next step.` |
| `data-preview-key="business.name"` + `data-preview-value` | `business.name` | Yes | Question-form input `value` attr **and** `.value` property sync |

Notes:

- The `hero.headline` `data-preview-html` path is the only innerHTML
  fill. Everything else is `textContent`. Canonical authors must not
  add HTML to other fields.
- The current renderer reads section headings from flat `*Meta`
  objects (`servicesMeta.eyebrow`, ...). The canonical schema folds
  these into the section objects (`services.eyebrow`). The future
  renderer/generator maps canonical -> flat at render time; this table
  is the authoritative correspondence.
- "Derived" paths are computed by the renderer when the canonical
  field is absent; authors may always override.

## 2. List hooks — `data-preview-list` + `data-preview-slot`

Each list clones its first-child template once per entry (templates
captured at first render in `window.__previewTemplates`). Entries are
filtered by `usableEntries()` (null / empty-object entries dropped).

| Template Hook / Selector | Canonical Schema Path | Required? | Behavior |
|---|---|---:|---|
| `data-preview-list="claims"` | `claims[]` (label; icon optional) | Optional | Clones trust chip; icon from `icon` key (`check`/`pin`/`ruler`); hidden when empty |
| `data-preview-list="services"` | `services.items[]` | Recommended | Clones service card; icon slot + `title`/`summary` slots + Learn-more link |
| `data-preview-list="projects"` | `projects.items[]` | Optional | Clones project figure; `label` (chip) + `caption` (figcaption) slots; first entry featured |
| `data-preview-list="projectHighlights"` | `projects.items[0].highlights[]` | Optional | Copy-column bullets; rendered only while projects section visible |
| `data-preview-list="process"` | `process.steps[]` | Recommended | Clones step; `num` auto-derived (`01`, `02`, ...), `title` + `copy` slots |
| `data-preview-list="reviews"` | `reviews.items[]` | Optional | Clones review card; `quote` + `attribution` slots; hidden when empty |
| `data-preview-list="serviceArea.communities"` | `serviceArea.communities[]` | Optional | Plain-string entries; chip list hidden when empty (section lede remains) |

Service card detail fields (modal content, rendered via
`data-service-detail="learn"`):

| Card/Modal element | Canonical Schema Path | Behavior |
|---|---|---|
| Card title | `services.items[].title` | Slot fill |
| Card summary | `services.items[].summary` | Slot fill |
| Card icon | `services.items[].icon` | Template icon key (`kitchen`/`bathroom`/`whole-home`), fallback `whole-home` |
| Learn-more link visibility | presence of any `detailTitle`/`detailCopy`/`includes`/`goodFit` | Link hidden when no detail fields; `aria-label="Learn more about {title}"` when shown |
| Modal headline | `services.items[].detailTitle` | Falls back to `title` |
| Modal copy | `services.items[].detailCopy` | Hidden when absent |
| Modal bullets | `services.items[].includes[]` | Hidden when empty |
| Modal good-fit | `services.items[].goodFit` | Hidden when absent |
| Modal CTA | fixed `#contact` scroll | Close + smooth-scroll (template behavior, not data) |

## 3. Conditional section + nav hooks

| Template Hook / Selector | Canonical Schema Path | Required? | Behavior |
|---|---|---:|---|
| `data-preview-section="claims"` | `claims[]` | Optional | Section shown only when list has usable entries |
| `data-preview-section="services"` | `services.items[]` | Optional | Section shown only when items exist |
| `data-preview-section="projects"` | `projects.items[]` + `projects.mode` | Optional | Shown when items exist AND mode `!= "hidden"` |
| `data-preview-section="process"` | `process.steps[]` | Optional | Shown only when steps exist |
| `data-preview-section="reviews"` | `reviews.items[]` | Optional | Shown only when items exist |
| `data-preview-nav="services"` | services visibility | Optional | Header + footer nav `<li>` hidden with its section (3 occurrences each) |
| `data-preview-nav="projects"` | projects visibility | Optional | Same |
| `data-preview-nav="process"` | process visibility | Optional | Same |
| `data-preview-nav="reviews"` | reviews visibility | Optional | Same |
| `data-preview-services-anchor` | services/projects visibility | Optional | Hero/final-CTA "View Services" retargets `#services` -> `#projects` -> `#contact` fallback |

## 3b. Image slot hooks — `data-preview-img` (JUS-52)

Named image slots resolve at render time:
**prospect override (`images.<slot>.url`) → template default
(`js/preview-image-defaults.js`) → styled placeholder** (the existing
line-art `.ph` figure stays). A blank/invalid URL never breaks the
preview — it just falls through. Alt text always resolves (record alt,
else `safeAltText(slot, trade)`).

| Template Hook / Selector | Canonical Schema Path | Required? | Behavior |
|---|---|---:|---|
| `data-preview-img="hero"` (`.ph--hero` figure) | `images.hero` | Optional | Swaps the hero placeholder for a resolved `<img class="ph__img">` (override/template default); placeholder stays when nothing resolves |
| `data-preview-img` on the projects collage template figure | `images.projectFeatured` / `projectKitchen` / `projectBath` / `projectWholeHome` | Optional | Slots assigned by collage position (0=featured, 1=kitchen, 2=bath, 3=whole-home); collage itself still renders only with real `projects[]` entries |

Notes:

- Resolution/defaults live in `js/preview-image-defaults.js`
  (`window.PreviewImageDefaults`), loaded before `preview-render.js`;
  the wizard loads the same file, so template defaults are configured
  in one place, never in renderer logic.
- The slot keys are the canonical `PreviewImages` keys
  (`src/types/preview-site.ts`); rules in data-model doc §7a.

## 4. Drawer / owner-facing hooks (view routing, not data-filled)

Owner layer copy is currently hardcoded in the template; the canonical
schema snapshots it in `ownerOffer` + `campaign.offerSnapshot` so
generation-time values survive campaign changes.

| Template Hook / Selector | Canonical Schema Path | Required? | Behavior |
|---|---|---:|---|
| `data-drawer-view="launch"` | `ownerOffer.*` | Optional | Launch-offer drawer view (hardcoded copy in current template) |
| `data-drawer-view="question"` | — (form view) | — | Question form view; fields: name, business (prefilled), contact, message + honeypot |
| `data-drawer-view="success"` | — | — | Post-submit success view |
| `data-open-drawer="launch"/"question"` | — | — | Open drawer + route to view |
| `data-drawer-view-trigger` | — | — | Switch views inside drawer |
| `data-close-drawer` | — | — | Close drawer (X, backdrop, Escape, CTAs) |
| `data-purchase` | `campaign.offerSnapshot.checkoutUrl` | Optional | Checkout CTA anchor (currently `#top` placeholder) |
| `data-form-endpoint` | `contact.formAction` | Optional | Form POST endpoint; blank in static previews; production posts to central platform endpoint |
| `data-service-detail="learn"` / `data-close-service-detail` / `data-service-detail-cta` | (see §2 modal table) | — | Service detail modal open/close/CTA behaviors |

## 5. Static export / generation notes

- The renderer runs once on load (`preview-render.js` before
  `main.js`) and is re-runnable (`window.renderPreview(data)`) for
  tests and future wizard re-render.
- A future static exporter can pre-render by running the same renderer
  headlessly and serializing the resulting HTML, or by mapping this
  table directly; both must apply the same visibility rules.
- Missing values always CLEAR keyed elements — including on first
  render — so exported HTML never contains the template's demo
  business data.
- `X-Robots-Tag` / noindex meta for preview pages are added by the
  preview host, not by the template (see launch-architecture doc §1);
  production exports flip robots to allow indexing.
