# Preview Site QA Checklist — Before Any Outreach

**Rule: no preview link goes to a prospect until the automated gate passes AND the 5-minute manual pass below is done for that business.**

The automated gate catches everything machine-checkable (links, noindex, hidden sections, mobile layout, runtime errors). The manual pass catches what only a human eye can (tone, placeholder art feeling "unfinished", image choices that imply the wrong thing). Together they take under 10 minutes per preview.

---

## 1. Automated gate (~60 seconds, run this first)

```
node scripts/qa-preview.js <record.json>          # regenerates + tests
node scripts/qa-preview.js <slug>                 # tests what's already in dist/
```

Exit code 0 = pass. 50 checks across four layers:

**Indexing policy — HTTP layer (local host simulator)**
- [ ] `X-Robots-Tag: noindex,nofollow,noarchive,nosnippet` on the page in **every URL shape**: `/{slug}` (the public preview URL), `/{slug}/`, `/previews/{slug}/`
- [ ] Header also on shared assets, 404s (nginx `always` semantics — future routes inherit protection), and robots.txt itself
- [ ] Domain-root `/robots.txt` served with exactly `User-agent: *` / `Disallow: /`
- ⚠ These run against `scripts/preview-server.js`, which loads the SAME policy files (`robots.txt`, `_nginx.preview.conf`) the deployed CloudPanel/Nginx vhost uses — it verifies the artifacts and local behavior, **not the live host**. §2 step 0 covers the deployed check.

**Indexing policy — artifact layer**
- [ ] `robots` meta carries the exact directives `noindex,nofollow,noarchive,nosnippet` — once, no duplicates
- [ ] `googlebot` meta likewise; no other bot-specific metas (no conflicting directives)
- [ ] `robots.txt` + `_nginx.preview.conf` generated at the deployment root (web root of the preview domain — NOT per-slug dirs, NOT production)

**Artifact (static HTML)**
- [ ] Static `<title>` is THIS business's title (never the template business)
- [ ] Embedded record JSON parses; template `preview-data.js` demo script is not referenced
- [ ] Shared assets resolve from the out tree; `tel:` link digits match the record's phone

**Desktop (headless Edge, real rendering)**
- [ ] Renderer ran; styles actually applied (not unstyled HTML)
- [ ] Banner greets this business; header phone + `tel:` match the record
- [ ] Section counts match the record (services / process / communities)
- [ ] Honest-copy polarity — claims/projects/reviews hidden **iff** their data is empty; visible with real data
- [ ] Zero text leaks from the template business anywhere in rendered copy
- [ ] No `javascript:` hrefs; every `#anchor` points at a real section; services CTA retargets to a live section
- [ ] Final CTA dials the record's phone
- [ ] Drawer: Launch offer opens, CTA label matches `campaign.offerSnapshot.primaryCta`, Ask-a-Question prefills the business, form endpoint policy holds (blank until the central endpoint exists), drawer closes
- [ ] Zero runtime errors

**Mobile (true 390px viewport via CDP emulation)**
- [ ] Hamburger shown / desktop nav hidden; menu opens and closes
- [ ] Compact banner copy + Launch button
- [ ] Hero/services/process stack to one column
- [ ] Launch sheet goes near full width
- [ ] Zero runtime errors

**Gate template for a new trade vertical:** copy `examples/preview-site.test-plumbing.json`, swap the business identity, and keep its populated claims/projects/reviews — the gate then verifies the *visible* honest-copy path too (the example record only exercises the hidden path).

## 2. Manual visual pass (~5 minutes, once per business)

**Step 0 — deployed-host indexing check (once per preview domain, and after any vhost change):**

```
curl -sI https://preview.yourdomain.com/{slug}        # expect X-Robots-Tag: noindex,nofollow,noarchive,nosnippet
curl -s   https://preview.yourdomain.com/robots.txt   # expect User-agent: * / Disallow: /
```

- [ ] Preview vhost includes `_nginx.preview.conf` (generated file — inside the preview server block ONLY; production vhosts must never include it)
- [ ] `/{slug}` resolves to the preview page on the live domain
- The local gate cannot verify DNS/vhost wiring — these two curls are the authoritative check on the actual host.

**Then the visual pass.** Serve the tree with the same URL shape the prospect will see:

```
node scripts/preview-server.js            # → http://localhost:4173/{slug}  (sets the real headers too)
```

**Desktop width, then drag to ~380px (or devtools mobile mode):**

- [ ] Hero reads naturally out loud — name, city, trade all correct
- [ ] Every visible photo is either a real approved image OR a clean line-art placeholder — no broken-image icons, no stretched pixels
- [ ] Placeholder art never *implies* a completed project (captions like "Your project photo here" are fine; "Featured remodel" next to a real-looking photo is not)
- [ ] Colors/fonts look like the template, not a broken load (terracotta accents, Fraunces headlines)
- [ ] Banner + owner bar are visually distinct (deep slate) from the customer-facing page (cream/linen)

**Drawer + interactive:**

- [ ] "Launch for $500" (or the campaign's actual CTA) opens the launch sheet; price matches what sales quoted
- [ ] "Ask a Question" form: submits a real test message, shows the success state, business name prefilled
- [ ] Escape key and backdrop click both close the drawer
- [ ] Learn-more links (if present) open the service modal with real detail copy — no lorem, no template text

## 3. Copy-safety review (the "no fake claims" gate)

Read every rendered word. Zero tolerance on these:

- [ ] **No invented proof**: reviews only from real customer quotes; attributions are real people/initials; no stock "testimonial" text
- [ ] **No invented credentials**: no license numbers, certifications, years-in-business, or guarantee language the owner didn't confirm
- [ ] **No invented urgency/scarcity**: no "limited time", "only X spots", countdown language
- [ ] **Claims match reality**: every trust-bar chip traces to something the owner said or that's verifiable; when in doubt, delete it
- [ ] **Project figures are honest**: labels say what the placeholder is ("Kitchen inspiration"), never claiming a completed job
- [ ] **No template-business residue**: search the page source for the template business name — must be zero hits outside your own head
- [ ] **Phone/email/URL all belong to this business** — dial the number in the page header yourself
- [ ] **Offer terms match the campaign snapshot** in the record (price, what's included)

### What indexing protection does — and does not — do

The three layers (meta tags, `X-Robots-Tag` header, domain-root `Disallow: /`) reduce indexing exposure, but **none of them makes a preview private**:

- `Disallow: /` in robots.txt prevents *crawling*, which also prevents crawlers from *seeing* the page's noindex meta. A URL discovered through an external link can still appear in search results as a bare URL (no content snippet).
- Meta/header noindex only works on pages a crawler actually fetches — the two mechanisms deliberately overlap for this reason.
- Neither layer blocks a human from opening the URL. Anyone with the link can view the preview.
- If a preview URL was ever indexed before protection was in place, removing it from search results requires a separate removal request (e.g. Google Search Console) — noindex alone will not retract an existing index entry.
- Sharing links unlisted-but-public: treat every preview URL as shareable-by-anyone. Do not put anything in a preview you would not want forwarded.

## 4. Sign-off

| Field | Value |
|---|---|
| Business | ________________ |
| Slug | ________________ |
| Automated gate | PASS — ___/50 checks (date: ________) |
| Deployed-host header check (§2 step 0) | done (date: ________) |
| Manual visual pass | done (initials: ________) |
| Copy-safety review | done (initials: ________) |
| Status in record | needs_review → ready |
| Cleared for outreach by | ________________ |

**If anything fails:** fix the record (not the generated HTML — it's an artifact), regenerate, re-run the gate. The generated page is never hand-edited.

### Deployment notes (preview host — CloudPanel/Nginx)

1. Generate: `node scripts/generate-preview.js <record.json>` — writes `dist/previews/{slug}/index.html`, `dist/robots.txt`, `dist/_nginx.preview.conf`.
2. Point the preview vhost's web root at `dist/` (or rsync `dist/` to it): `rsync -av --delete dist/ user@preview-host:/path/to/preview-webroot/`
3. Inside the **preview** server block only: `include /path/to/preview-webroot/_nginx.preview.conf;` — it adds `X-Robots-Tag ... always` and the `/{slug}` → `previews/{slug}/index.html` mapping.
4. Reload nginx, then run the §2 step-0 curls to verify on the live host.

Production separation: `_nginx.preview.conf` and `robots.txt` are **preview-host artifacts generated into the preview tree only**. A future production export flow must copy the per-slug page tree WITHOUT them (see `docs/launch-architecture-decisions.md` §3 — production gets its own permissive robots.txt and `index,follow`). The template `index.html` ships with no bot metas at all (enforced by unit test), so production pages built from it start clean.

---

### Why both layers

The gate is deterministic but blind to meaning — it can't tell a real review from a plausible fake one if the record contains it, and it can't judge whether a placeholder photo reads as misleading. The manual pass covers judgment; the gate covers everything a rushed morning might skip. A preview that skips the manual pass is not cleared, no matter how green the gate is.
