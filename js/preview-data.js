/* ============================================================
   PREVIEW DATA MODEL — single source of truth
   ------------------------------------------------------------
   This file defines the structured business data behind the
   preview site. The renderer in js/preview-render.js reads this
   object and fills every [data-preview-*] hook in index.html.

   HOW TO PERSONALIZE A PREVIEW
   1. Copy this file's structure.
   2. Replace the business values (name, phone, services, ...).
   3. Leave optional values empty ("", [], null) when unknown —
      the renderer clears their slots and hides their sections
      instead of showing broken or fake content.

   PROTECTED IDENTIFIERS (stable across businesses; do not rename):
     - Fill hooks (renderer <-> index.html contract):
         data-preview-key    text/input fill, e.g. "business.name";
                             with data-preview-attr fills that attr,
                             with data-preview-value fills the input,
                             with data-preview-html fills innerHTML
                             (TRUSTED template keys only, e.g. the
                             hero headline's <em>)
         data-preview-attr   which attribute a key fills (href,
                             aria-label, content, value)
         data-preview-value  marks an input to fill via .value
         data-preview-html   marks an element whose value is the
                             one trusted-HTML path (hero.headline)
     - Conditional hooks:
         data-preview-section  section shown/hidden by list data
                               (claims | services | projects |
                               process | reviews)
         data-preview-nav      nav <li> hidden with its section
         data-preview-list     list container cloned from its
                               first-child template, keyed by data
                               path (e.g. "serviceArea.communities")
         data-preview-slot     named field inside a list template
                               (title | copy | quote | attribution |
                               num | label | caption | icon)
         data-preview-services-anchor
                               CTA retargeted to the first section
                               with data (#services -> #projects ->
                               #contact fallback)
     - View routing (drawer): data-drawer-view,
       data-open-drawer, data-drawer-view-trigger,
       data-close-drawer
     - Section ids used by nav anchors: #services #projects
       #process #reviews #contact
   Only the VALUES in this object change between businesses.

   HONEST COPY RULE
   reviews[], projects[], and claims render ONLY when real data
   exists. Empty arrays keep their sections and nav links hidden.
   Invalid entries (null, objects with no values) are dropped.
   Never invent reviews, licenses, guarantees, or urgency.

   OWNER-FACING COPY (launch offer, $500, drawer form) is OUR
   offer, not business data — it stays hardcoded in index.html.
   ============================================================ */

window.PREVIEW_DATA = {
  /* Required core identity — header, banner, owner card, footer,
     question form. Renderer falls back to "This Business" if empty. */
  business: {
    name: 'Cascade Home Remodeling',
    city: 'Bend',
    state: 'OR',
    stateName: 'Oregon',
    phone: '541-555-0198',
    phoneHref: 'tel:5415550198'
  },

  /* Trust bar chips. Only rendered when real claims exist. */
  claims: [],

  /* Hero. headline may contain one <em> for the accent word. */
  hero: {
    eyebrow: 'Kitchen · Bath · Whole-Home',
    headline: 'Beautiful, <em>practical</em> remodeling for Bend homeowners.',
    lede: 'Kitchen, bathroom, and whole-home updates designed around clear communication, clean workmanship, and a smoother renovation experience.',
    badgeTitle: 'Free estimates',
    badgeSub: 'Honest scope, clear pricing'
  },

  /* Services. Empty array hides the section and its nav link.
     Each entry: { icon, title, copy, detail: { headline, copy,
     bullets[], goodFit } }. Entries without a detail object keep
     their "Learn more" link hidden (no invented detail copy). */
  services: [
    {
      icon: 'kitchen',
      title: 'Kitchen Remodeling',
      copy: 'Thoughtful kitchen updates designed around better flow, storage, finishes, and everyday function.',
      detail: {
        headline: 'Kitchen remodels, planned around how you cook',
        copy: 'From refreshed surfaces to full layout changes, we plan the work around your routines — clear timelines, contained dust, and a space that works better the moment it\u2019s done.',
        bullets: [
          'Cabinet refacing or replacement',
          'Countertop and backsplash installation',
          'Island and pantry additions',
          'Lighting and fixture updates'
        ],
        goodFit: 'A good fit if your layout works but the finishes, storage, or workflow no longer do.'
      }
    },
    {
      icon: 'bathroom',
      title: 'Bathroom Remodeling',
      copy: 'Refresh your bathroom with cleaner layouts, updated surfaces, improved fixtures, and a more comfortable feel.',
      detail: {
        headline: 'Bathrooms that stay practical and feel finished',
        copy: 'We handle the details that make a bathroom last — proper waterproofing, ventilation, and surfaces that are easy to keep clean — with a schedule you can plan around.',
        bullets: [
          'Tub and shower replacements',
          'Vanity and storage upgrades',
          'Tile and waterproofing',
          'Accessibility-friendly fixtures'
        ],
        goodFit: 'A good fit if you want a bathroom that works better day to day, not just a new look.'
      }
    },
    {
      icon: 'whole-home',
      title: 'Whole-Home Updates',
      copy: 'Modernize key areas of your home with coordinated improvements that make the space feel more complete.',
      detail: {
        headline: 'Coordinated updates, one schedule',
        copy: 'Instead of juggling separate contractors, we sequence flooring, trim, lighting, and room-by-room updates under one plan — so the house stays livable and the work stays on track.',
        bullets: [
          'Flooring and trim replacement',
          'Interior paint and lighting',
          'Room-by-room refreshes',
          'Pre-listing updates'
        ],
        goodFit: 'A good fit if several areas need attention at once and you want one team coordinating it.'
      }
    }
  ],

  /* Project showcase entries. Empty array keeps the section hidden
     (honest mode). Each: { label, caption } */
  projects: [],

  /* Customer reviews. Empty array keeps the section hidden and
     removes the Reviews nav link. NEVER populate with invented
     reviews — real quotes only. Each: { quote, attribution } */
  reviews: [],

  /* Service area. Empty communities hides the chips list but the
     section remains with the lede. */
  serviceArea: {
    lede: 'Cascade Home Remodeling works with homeowners throughout Bend and the surrounding area.',
    communities: ['Bend', 'Redmond', 'Sisters', 'Sunriver', 'Tumalo', 'La Pine']
  },

  /* Process steps. Safe, factual template copy. */
  process: [
    { title: 'Request an Estimate', copy: 'Tell us what you’re hoping to improve and the best way to reach you.' },
    { title: 'Walk Through the Project', copy: 'We review the space, goals, timeline, and details that matter most.' },
    { title: 'Review a Clear Proposal', copy: 'You get a straightforward scope so you can make a confident decision.' },
    { title: 'Schedule the Work', copy: 'Once approved, we coordinate the next steps and keep the project moving.' }
  ],

  /* Final customer-facing CTA copy. */
  finalCta: {
    eyebrow: 'Free estimates · Bend, Oregon',
    headline: 'Ready to talk about your remodel?',
    copy: 'Tell us what you have in mind and we’ll help you take the next step.',
    micro: 'No pressure, no obligation — just a clear next step.'
  }
};
