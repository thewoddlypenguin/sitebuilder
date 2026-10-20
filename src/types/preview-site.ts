/**
 * Canonical Preview Site data model — Preview Site Generator MVP
 * ------------------------------------------------------------
 * Source of truth: docs/preview-site-data-model.md
 * Template hook map:   docs/template-variable-map.md
 * Example record:      examples/preview-site.example.json
 *
 * This file is type-only. The current template project is a static
 * HTML/CSS/JS site with no TypeScript build step; these types are
 * intentionally uncompiled and serve as the contract for the future
 * CSV importer, wizard UI, database model, and static exporter.
 * Importers should validate against these shapes at runtime.
 *
 * Honest-copy rule (enforced everywhere data flows):
 *   reviews / projects / claims render ONLY with real data.
 *   Empty optional arrays hide their sections — never placeholders,
 *   never invented licenses, awards, guarantees, or urgency.
 */

/* ============================================================
   1. Top-level lifecycle + identity
   ============================================================ */

/**
 * Workflow state of a preview site.
 *
 * - ready         — preview is complete enough for outreach.
 * - needs_review  — generated, but needs manual QA or cleanup.
 * - blocked       — missing/invalid required data prevents use.
 * - purchased     — client purchased / approved the preview.
 * - launched      — site deployed to production.
 */
export type PreviewStatus =
  | "ready"
  | "needs_review"
  | "blocked"
  | "purchased"
  | "launched";

/**
 * Projects section can hold real entries but be intentionally hidden
 * (e.g. photos not yet available). "hidden" keeps data in the record
 * while the section stays out of the rendered page and nav.
 */
export type ProjectMode = "auto" | "hidden";

/* ============================================================
   2. Snapshots
   ============================================================ */

export interface TemplateSnapshot {
  /** Stable template identifier, e.g. "remodeling-contractor-v1". */
  id: string;
  /** Human-readable name, e.g. "Remodeling Contractor One-Pager". */
  name?: string;
  /** Template version, informational. */
  version?: string;
}

/**
 * Offer values shown in the owner-facing launch drawer, snapshotted
 * at generation time so later campaign edits never rewrite a preview
 * the prospect already saw.
 */
export interface OfferSnapshot {
  /** Launch price in major units, e.g. 500. */
  price: number;
  /** ISO 4217 currency code, default "USD". */
  currency: string;
  /** Display label, e.g. "$500" or "500 USD". */
  priceLabel: string;
  /** Internal offer name, e.g. "Starter one-page launch". */
  offerName?: string;
  /** Primary checkout CTA, e.g. "Launch for $500". */
  primaryCta: string;
  /** Secondary CTA, e.g. "Ask a Question". */
  secondaryCta?: string;
  /** Checkout/payment URL for the primary CTA. */
  checkoutUrl?: string;
  /** Terms fine-print label shown near the CTA. */
  termsLabel?: string;
}

/**
 * Campaign provenance + offer snapshot. Snapshot semantics: the preview
 * preserves the price and offer shown at generation time, even if the
 * campaign config changes later.
 */
export interface CampaignSnapshot {
  /** Campaign identifier this preview was generated from. */
  id: string;
  /** Human-readable campaign name. */
  name?: string;
  /** ISO 8601 timestamp the preview was generated. */
  generatedAt?: string;
  /** Acquisition source, e.g. "csv_import", "manual", "outreach_2026_10". */
  source?: string;
  offerSnapshot: OfferSnapshot;
}

/* ============================================================
   3. Identity + configuration blocks
   ============================================================ */

export interface MetaData {
  /** <title> text. Derived default: "{name} — {city}, {state} (Preview)". */
  title?: string;
  /** Meta description. Derived default is trade-generic and safe. */
  description?: string;
}

export interface BusinessData {
  /** Legal/display name. Required. */
  name: string;
  /** City, e.g. "Bend". Required for slug + localized copy. */
  city: string;
  /** State code or region, e.g. "OR". Required for slug + localized copy. */
  state: string;
  /** Full state name, e.g. "Oregon". Optional display refinement. */
  stateName?: string;
  /** Primary trade, e.g. "remodeling". Required. Drives slug + copy defaults. */
  trade: string;
  /** Marketing category / niche label, e.g. "Kitchen & Bath Remodeler". */
  category?: string;
  /** Secondary niche descriptor, e.g. "residential remodeling". */
  niche?: string;
  /** Display phone, e.g. "541-555-0198". */
  phone?: string;
  /** tel: href. Derived from phone when omitted. */
  phoneHref?: string;
  /** Public website, if any. */
  website?: string;
  /** Contact email. */
  email?: string;
  /** Derived: "Bend, Oregon" (stateName preferred over state). */
  cityState?: string;
  /** Derived: first word of name (wordmark). */
  nameFirst?: string;
  /** Derived: remaining words of name (wordmark). */
  nameRest?: string;
}

/**
 * Contact/notification placeholders. All optional in the MVP: the static
 * preview ships with blank contact fields. Production forms will post to
 * a central platform endpoint, and Cloudflare Turnstile will be required
 * for production submissions (see docs/launch-architecture-decisions.md).
 */
export interface ContactData {
  /** Email that receives form notifications. */
  notificationEmail?: string;
  /** POST endpoint for the question form. Blank in static previews. */
  formAction?: string;
  /** Cloudflare Turnstile site key. Required for production forms later. */
  turnstileSiteKey?: string;
  /** Lead source tag attached to submissions. */
  leadSource?: string;
  /** Which contact method to emphasize when no form endpoint exists. */
  fallbackContactMethod?: "phone" | "form" | "email";
}

export interface TrackingData {
  /** Platform-internal preview id (same as top-level id). */
  siteId?: string;
  /** Stable form identifier for the question form, e.g. "question_main". */
  formId?: string;
  /** Analytics property id, e.g. GA4. */
  analyticsId?: string;
  /** Optional per-campaign UTM campaign tag. */
  utmCampaign?: string;
  /** Ad/conversion pixel id. */
  conversionId?: string;
}

/* ============================================================
   3b. Image slots (JUS-52)
   ============================================================ */

/**
 * Where a rendered image came from. Resolution order is explicit:
 *   1. prospect          — record-level images.<slot>.url (override)
 *   2. template_default  — template config defaults (js/preview-image-defaults.js)
 *   3. placeholder       — styled line-art figure (renderer default)
 * `source` is derived at render time; records never store it.
 */
export type PreviewImageSource = "prospect" | "template_default" | "placeholder";

/**
 * One image slot. Every field is optional — blank/missing urls fall
 * through to template defaults, then the styled placeholder. A bad
 * url (non http(s)/protocol-relative/root-relative) is treated exactly
 * like a blank one; it never breaks the preview.
 */
export interface PreviewImage {
  /** Image URL. URL-based only (MVP): no uploads/transformations. */
  url?: string;
  /**
   * Alt text. Safe default when blank (see safeAltText): generic
   * "inspiration image" wording — never implies a pictured project
   * was completed by the business unless the image really is theirs.
   */
  alt?: string;
  /**
   * Optional operator note about the asset (source page, license,
   * crop guidance). Never rendered publicly.
   */
  notes?: string;
}

/**
 * Named image slots for the current template. Optional on the record:
 * template defaults + placeholders cover missing values. Slots map to
 * template locations (see docs/preview-site-data-model.md §7a):
 * hero -> hero media frame; projectFeatured/projectKitchen/
 * projectBath/projectWholeHome -> projects collage by position.
 */
export interface PreviewImages {
  hero?: PreviewImage;
  projectFeatured?: PreviewImage;
  projectKitchen?: PreviewImage;
  projectBath?: PreviewImage;
  projectWholeHome?: PreviewImage;
}

export interface BannerData {
  /** Owner-facing desktop preview banner text. */
  desktopText?: string;
  /** Owner-facing mobile banner text (shorter). */
  mobileText?: string;
}

export interface HeaderData {
  /** Wordmark aria-label. Derived: "{name} — home". */
  wordmarkLabel?: string;
}

/* ============================================================
   4. Customer-facing sections
   ============================================================ */

export interface HeroData {
  /** Kicker above the headline, e.g. "Kitchen · Bath · Whole-Home". */
  eyebrow?: string;
  /**
   * Hero H1. May contain ONE <em> for the accent word — this is the
   * only trusted-HTML key (data-preview-html). Plain text otherwise.
   */
  headline?: string;
  /** Supporting paragraph under the headline. */
  lede?: string;
  /** Derived: "Serving {cityState} and nearby communities." */
  location?: string;
  /** Corner badge title, e.g. "Free estimates". */
  badgeTitle?: string;
  /** Corner badge subtitle, e.g. "Honest scope, clear pricing". */
  badgeSub?: string;
}

/**
 * Trust-bar chip. Rendered only when real, verifiable claims exist.
 * Icons: "check" (default) | "pin" | "ruler". No invented claims.
 */
export interface ClaimItem {
  id?: string;
  /** Chip text, e.g. "Licensed & Insured" (only when true). */
  label: string;
  icon?: string;
}

export interface ServiceItem {
  /** Stable id for editing/reordering references. */
  id?: string;
  /** Template icon key: kitchen | bathroom | whole-home (template-defined). */
  icon?: string;
  /** Card + modal title, e.g. "Kitchen Remodeling". */
  title: string;
  /** Card summary paragraph. */
  summary: string;
  /** Service detail modal headline (falls back to title). */
  detailTitle?: string;
  /** Service detail modal paragraph. */
  detailCopy?: string;
  /** Detail modal bullet list. Empty/omitted hides the list. */
  includes?: string[];
  /** Detail modal "good fit" sentence. */
  goodFit?: string;
  /** Overrides the "Learn more" label on the card. */
  ctaLabel?: string;
}

export interface ServicesSection {
  eyebrow?: string;
  title?: string;
  lede?: string;
  /** Service cards. Empty array hides the section + nav link. */
  items: ServiceItem[];
}

export interface ProjectItem {
  id?: string;
  /** Photo chip label, e.g. "Featured remodel". */
  label?: string;
  /** Figcaption text, e.g. "Kitchen refresh — Bend". */
  caption?: string;
  /** Copy-column bullets shown beside the collage. First entry's list. */
  highlights?: string[];
}

export interface ProjectsSection {
  eyebrow?: string;
  title?: string;
  lede?: string;
  /** "auto" shows the section when items exist; "hidden" forces it off. */
  mode?: ProjectMode;
  /** Real project entries only. Empty array hides the section. */
  items: ProjectItem[];
}

export interface ProcessStep {
  id?: string;
  /** Step title, e.g. "Request an Estimate". */
  title: string;
  /** Step paragraph. */
  copy: string;
}

export interface ProcessSection {
  eyebrow?: string;
  title?: string;
  steps: ProcessStep[];
}

export interface ReviewItem {
  id?: string;
  /** The quote itself. Real quotes only — never invented. */
  quote: string;
  /** Attribution, e.g. "Sarah M., Bend". */
  attribution?: string;
}

export interface ReviewsSection {
  eyebrow?: string;
  title?: string;
  /** Real reviews only. Empty array hides the section + nav link. */
  items: ReviewItem[];
}

export interface ServiceAreaSection {
  eyebrow?: string;
  title?: string;
  lede?: string;
  /** Legend chip label. Derived from communities[0] when omitted. */
  chip?: string;
  /** Community names as plain strings. Empty hides the chip list. */
  communities: string[];
}

export interface FinalCtaSection {
  eyebrow?: string;
  headline?: string;
  copy?: string;
  /** Reassurance microcopy under the buttons. */
  micro?: string;
}

/**
 * Owner-facing launch offer snapshot (drawer copy). Values mirror the
 * campaign offer snapshot and are snapshotted for the same reason:
 * owner-facing copy must stay stable after generation.
 */
export interface OwnerOfferSnapshot {
  eyebrow?: string;
  title?: string;
  /** Body line, e.g. "Launch this one-page starter site for $500." */
  sub?: string;
  /** Perk lines under the offer. */
  perks?: string[];
  /** Primary CTA label, e.g. "Launch for $500". */
  primaryCta?: string;
  /** Secondary CTA label, e.g. "Ask a Question". */
  secondaryCta?: string;
  /** Fine-print note under the CTAs. */
  note?: string;
  /** Post-checkout explanation note. */
  reassure?: string;
}

/* ============================================================
   5. Visibility + metadata
   ============================================================ */

/**
 * Resolved section visibility. Deterministic rules (see docs):
 *   claims.visible   = claims.length > 0
 *   services.visible = services.items.length > 0
 *   projects.visible = projects.items.length > 0 && mode !== "hidden"
 *   process.visible  = process.steps.length > 0
 *   reviews.visible  = reviews.items.length > 0
 *   serviceArea chips = communities.length > 0
 * Nav items follow their sections.
 */
export interface VisibilityState {
  claims?: boolean;
  services?: boolean;
  projects?: boolean;
  process?: boolean;
  reviews?: boolean;
  /** True when serviceArea.communities.length > 0. */
  serviceAreaChips?: boolean;
}

export interface PreviewMetadata {
  /** ISO 8601 creation timestamp. */
  createdAt?: string;
  /** ISO 8601 last-update timestamp. */
  updatedAt?: string;
  /** Importer/operator notes. Mapped from CSV `notes`. */
  notes?: string;
  /** Source URL the business data was gathered from. */
  sourceUrl?: string;
  /** Importer/operator free-form flags. */
  flags?: string[];

  /* ---- Research-only fields (NOT rendered publicly by default) ---- */

  /** Owner/principal name from research. Outreach personalization only. */
  ownerName?: string;
  /** Street address from research. Rendering requires owner confirmation
   *  (many home-service businesses don't want a public address shown). */
  address?: string;
  /** Business hours from research. Not rendered in v1. */
  businessHours?: string;
  /** License number found during research. STORE-ONLY until verified in
   *  a later workflow; never rendered as a public credential/claim. */
  licenseNumber?: string;
  /** Where the hero image asset was found. Source reference only —
   *  production export copies approved assets locally, never hotlinks. */
  heroImageUrl?: string;
  /** Where the logo asset was found. Source reference only. */
  logoUrl?: string;
  /** Where project photo assets were found. Source references only. */
  projectImageUrls?: string[];
}

/* ============================================================
   6. Root record
   ============================================================ */

export interface PreviewSiteRecord {
  /** Platform-internal id, e.g. "preview_01HXYZ...". Never used in URLs. */
  id: string;
  /** Durable public preview identifier; URL derived from it. */
  slug: string;
  /** Lifecycle status. */
  status: PreviewStatus;

  template: TemplateSnapshot;
  campaign?: CampaignSnapshot;

  /** Required core business identity. */
  business: BusinessData;

  contact?: ContactData;
  tracking?: TrackingData;

  meta?: MetaData;
  banner?: BannerData;
  header?: HeaderData;
  hero?: HeroData;

  /**
   * Image slots (JUS-52). Optional: blank slots resolve to template
   * defaults, then the styled placeholder — never a broken preview.
   */
  images?: PreviewImages;

  claims: ClaimItem[];
  services: ServicesSection;
  projects: ProjectsSection;
  process: ProcessSection;
  reviews: ReviewsSection;
  serviceArea: ServiceAreaSection;
  finalCta?: FinalCtaSection;

  ownerOffer?: OwnerOfferSnapshot;
  visibility?: VisibilityState;
  metadata?: PreviewMetadata;
}
