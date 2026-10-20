# SMB Website Design Program — Preview Site Generator

A static, dependency-free toolkit for building **personalized one-page preview
websites** for local service businesses (plumbers, remodelers, and similar
trades), running them through an automated pre-outreach QA gate, and protecting
preview URLs from search-engine indexing.

- **No frameworks, no build tools, no runtime dependencies** — plain HTML/CSS/
  vanilla JS plus Node (stdlib only) for generation, QA, and headless testing.
- **One template, many businesses.** Business copy lives entirely in data
  (`js/preview-data.js` for the template or a canonical `PreviewSiteRecord`
  JSON for generated previews) — never hand-edit generated output.
- **Honest-copy rule.** Reviews, projects, and claims render *only* with real
  data supplied per business. Missing values clear template placeholder copy;
  nothing is invented (no fake licenses, guarantees, or urgency). The single
  exception is the synthetic test fixture `examples/preview-site.test-plumbing.json`,
  which exists to exercise the populated render path in QA and is explicitly
  labeled *never for outreach*.

## Repository layout

| Path | What it is |
| --- | --- |
| `index.html` | The one-page template (13 sections in fixed order) |
| `css/`, `js/` | Template styles and render/interaction code |
| `wizard/` | Internal 6-step wizard that turns business details + CSV rows into canonical record JSON |
| `scripts/generate-preview.js` | Static preview generator (record JSON → `dist/previews/{slug}/index.html`) |
| `scripts/qa-preview.js` | Automated pre-outreach QA gate (50 checks, exit 0 = pass) |
| `scripts/preview-server.js` | Local preview-domain simulator (real `X-Robots-Tag` headers + `robots.txt`) |
| `scripts/cdp-harness.js` | Shared headless-Edge CDP harness used by the test suites |
| `test/` | Unit + headless-browser test suites |
| `docs/` | Data model, template-variable map, QA checklist, launch architecture decisions |
| `examples/` | **Synthetic, commit-safe** record fixtures (test-data only) |
| `src/types/preview-site.ts` | Type-only canonical schema contract (not compiled) |
| `records/` | **Local-only.** Private prospect/customer records live here and are git-ignored — see `records/LOCAL-ONLY.md` |
| `dist/` | **Generated output.** Rebuildable, git-ignored, never commit |

## Prerequisites

- **Node.js** ≥ 18 (developed on v22) — used for generation, QA, and tests.
  No `npm install` is needed: every script uses only Node's standard library.
- **Microsoft Edge** at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`
  (default in `scripts/cdp-harness.js`) — required only for the headless
  browser suites (`test/verify.js` and the desktop/mobile layers of
  `scripts/qa-preview.js`). Adjust the path in that file for other setups.
- A static file server for viewing pages (`python -m http.server` works; the
  preview server below is preferred for generated previews).

## Test commands

```bat
node test\generate-preview-test.js   :: 64 unit tests — generator + embedded-data mapper
node test\wizard-core-test.js        :: 64 unit tests — wizard core logic + CSV contract
node test\verify.js                  :: 199 headless-browser checks, 8 phases (~1–2 min, needs Edge)
```

Each suite exits non-zero on failure.

## Generate a preview site

```bat
node scripts\generate-preview.js examples\preview-site.example.json
node scripts\generate-preview.js <record.json> [--out <dir>] [--force]
```

Reads a canonical `PreviewSiteRecord` JSON (see `docs/preview-site-data-model.md`
and `src/types/preview-site.ts`), validates it (slug format, required fields,
template id, status gate), and writes `dist/previews/{slug}/index.html` plus
shared `dist/assets/`. Output is deterministic — the same record and template
always produce byte-identical HTML. Generation refuses to overwrite an existing
output directory unless `--force` is passed.

Where records live:

- **Real prospects/customers** → `records/` (git-ignored; see
  `records/LOCAL-ONLY.md`). Never put real business data under `examples/`.
- **Synthetic test fixtures** → `examples/` only. Both files there are
  synthetic: `preview-site.example.json` (empty lists — the hidden honest-copy
  path) and `preview-site.test-plumbing.json` (populated — the QA gate's
  visible path; its `$comment` marks it test-data, never outreach).

## Pre-outreach QA gate

```bat
node scripts\qa-preview.js examples\preview-site.test-plumbing.json
node scripts\qa-preview.js <record.json|slug> [--out <dir>] [--shots <dir>]
```

50 checks across four layers — HTTP policy (noindex headers + robots.txt via
the local simulator), static artifacts, desktop rendering (headless Edge), and
true-390px mobile emulation. Exit code 0 = pass; runs in under 30 seconds.
Expected values are computed from the record itself, not hardcoded.

The gate is **required but not sufficient**: the full release process —
including the manual visual pass and the deployed-host header check — is in
[`docs/preview-qa-checklist.md`](docs/preview-qa-checklist.md).

## Preview server (local simulator)

```bat
node scripts\preview-server.js [--out <dir>] [--port <n>]
```

Serves `dist/` (default root) the way the deployed Nginx/CloudPanel preview
vhost will: `http://127.0.0.1:4173/{slug}` (plus `/{slug}/` and
`/previews/{slug}/` variants), `X-Robots-Tag: noindex,nofollow,noarchive,nosnippet`
on **every** response including 404s, and `/robots.txt` from the deployment
root. Use it for local review — do not open `dist/.../index.html` via
`file://` or a generic static server for previews.

**Always serve generated previews through this layout** (the preview server,
or the deployed vhost configured per `docs/preview-qa-checklist.md`). Generated
pages reference shared assets via `../../assets/`, so serving `dist/` as the
web root — with these routes — is part of the artifact contract, not a nicety.

## Indexing protection — what it does and does not do

Every generated preview carries three layers of noindex protection:
`robots` + `googlebot` metas in the HTML, the `X-Robots-Tag` response header
(with nginx `always` semantics, so 404s and future routes are covered too), and
a domain-root `robots.txt` (`User-agent: * / Disallow: /`). The generator emits
`dist/robots.txt` and `dist/_nginx.preview.conf` for the preview vhost only.

Know the limits before outreach:

- **`noindex` is not privacy.** Anyone with the URL can open a preview. Treat
  preview links as shareable-by-anyone.
- **`Disallow: /` blocks crawling *and* noindex discovery.** A search engine
  that never crawls the URL can't see the `noindex` on it.
- **Already-indexed URLs stay listed** until removed via Search Console
  (Removals tool); robots rules alone don't retract existing entries.

Details and the deployed-host verification step are in
[`docs/preview-qa-checklist.md`](docs/preview-qa-checklist.md) §3.

## Local tests vs. deployed-host verification

Everything above runs **locally**. Verifying the *actual* deployed preview
host (real `X-Robots-Tag` header via `curl -sI`, real `robots.txt`, vhost
routing) is a separate manual step in
[`docs/preview-qa-checklist.md`](docs/preview-qa-checklist.md) §2 step 0, and
is a required sign-off row before any record moves to `ready`. Staging/live
hosting and deployment automation are **not** configured in this repository
yet — see "Remaining work" in that checklist.

## Docs map

- [`docs/preview-site-data-model.md`](docs/preview-site-data-model.md) — canonical record schema, status lifecycle, CSV import mapping
- [`docs/template-variable-map.md`](docs/template-variable-map.md) — every data-preview fill hook → canonical path
- [`docs/preview-qa-checklist.md`](docs/preview-qa-checklist.md) — QA gate + manual pass + sign-off
- [`docs/launch-architecture-decisions.md`](docs/launch-architecture-decisions.md) — hosting separation, form endpoint, Turnstile/Resend decisions
- [`docs/preview-site-input-template.csv`](docs/preview-site-input-template.csv) — 28-column campaign input template with sample row
- [`docs/github-handoff.md`](docs/github-handoff.md) — first-commit guide for this repository
