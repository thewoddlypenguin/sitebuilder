# Launch Architecture Decisions

Project: Preview Site Generator MVP  
Last Updated: 2026-10-07

## Purpose

This document preserves launch, hosting, contact form, DNS, and operational decisions made during planning for the Preview Site Generator MVP.

These decisions are important for the broader product, but most are intentionally out of scope for the immediate template-binding work.

The current active implementation focus remains:

- structured preview data model
- CSV input format
- template variable mapping
- preview generation
- safe fallbacks
- no fake business claims
- preview QA

Production launch systems such as CloudPanel deployment, Resend delivery, Cloudflare setup, and lead reporting should be implemented as separate future tasks.

---

# 1. Preview URL and Indexing Policy

## Decision

Generated preview URLs may be publicly accessible immediately after creation, but every preview page must be protected from search indexing.

The desired behavior is:

```text
Public if someone has the link.
Not discoverable or indexed by search engines.
```

Example preview URL:

```text
https://preview.yourdomain.com/{slug}
```

Example:

```text
https://preview.yourdomain.com/cascade-home-remodeling-bend-or
```

## Requirements

All preview HTML pages should include:

```html
<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
<meta name="googlebot" content="noindex,nofollow,noarchive,nosnippet">
```

Preview responses should also include the HTTP header:

```text
X-Robots-Tag: noindex, nofollow, noarchive, nosnippet
```

The preview domain should also have a restrictive `robots.txt`:

```text
User-agent: *
Disallow: /
```

Important note:

```text
robots.txt alone is not enough.
```

Page-level meta tags and/or HTTP headers are required because search engines may still index URLs they discover externally if they cannot crawl the page to see a noindex tag.

## Routes Covered

The noindex policy applies to all preview routes, including:

```text
/{slug}
/{slug}/contact
/{slug}/schedule
/{slug}/thank-you
```

And any other route that renders preview HTML.

## Preview Status vs URL Visibility

Preview URLs can exist before they are approved for outreach.

Internal statuses determine workflow, not whether the URL can be directly visited.

Recommended statuses:

```text
ready
needs_review
blocked
purchased
launched
```

Rules:

```text
ready = eligible for outreach
needs_review = public URL may exist, but not eligible for outreach
blocked = no usable preview should be sent
purchased = payment received / launch workflow needed
launched = production site is live
```

Only `ready` previews should enter outreach workflows.

---

# 2. Preview and Production Hosting Separation

## Decision

Preview sites and launched production sites must be separate.

Preview phase:

```text
preview.yourdomain.com/{slug}
```

Production phase:

```text
clientdomain.com
```

## Requirements

Preview sites:

- live on a dedicated preview subdomain
- render dynamically or from preview data
- are globally noindexed
- are used for sales, outreach, and QA
- are not considered final production hosting

Production sites:

- use the client’s own domain
- are deployed separately from the preview system
- are intended to be indexable
- are standalone static websites in v1
- should not depend on the preview rendering platform

## Rationale

This separation provides:

- clear boundary between sales previews and launched sites
- easier global noindex protection on previews
- safer production SEO behavior
- easier offboarding and migration
- reduced risk of preview system changes affecting live client websites

---

# 3. Production Static Hosting and Deployment

## Decision

For v1, production sites will be deployed as static files to a CloudPanel-powered Nginx server.

Initial hosting can use the existing CloudPanel/Nginx server. After the model is proven, production sites may be migrated to a new dedicated CloudPanel/Nginx server.

## v1 Deployment Model

```text
Preview platform
↓
static export folder
↓
server-side directory copy or rsync
↓
CloudPanel site web root
↓
client domain live
```

## Manual/Semi-Manual Deployment

For v1, production deployment does not need full automation.

The operator can:

1. Create the CloudPanel site manually.
2. Generate the static export.
3. Copy or rsync the export directory into the live web root.
4. Configure DNS.
5. Issue SSL.
6. Verify launch.
7. Mark the site launched.

Example deployment command:

```bash
rsync -av --delete /srv/site-exports/{slug}/ /home/{cloudpanel-user}/htdocs/{domain}/
```

Example:

```bash
rsync -av --delete \
  /srv/site-exports/cascade-home-remodeling-bend-or/ \
  /home/cascadehome/htdocs/cascadehomeremodeling.com/
```

## Recommended Static Export Structure

```text
/srv/site-exports/{slug}/
  index.html
  contact/
    index.html
  thank-you/
    index.html
  assets/
    logo.webp
    hero.webp
    styles.css
    main.js
  content.json
  sitemap.xml
  robots.txt
  export-manifest.json
```

## Export Manifest

Each export should include an `export-manifest.json` file.

Example:

```json
{
  "previewSlug": "cascade-home-remodeling-bend-or",
  "businessName": "Cascade Home Remodeling",
  "productionDomain": "cascadehomeremodeling.com",
  "exportedAt": "2026-10-07T21:00:00-07:00",
  "templateId": "contractor-preview-v1",
  "campaignId": "starter-sites-v1",
  "exportVersion": "1.0.0",
  "robots": "index,follow",
  "routes": [
    "/",
    "/contact/",
    "/thank-you/"
  ]
}
```

## Production Robots Behavior

Preview pages should use:

```text
noindex,nofollow
```

Production pages should generally use:

```text
index,follow
```

Production `robots.txt` example:

```text
User-agent: *
Allow: /

Sitemap: https://clientdomain.com/sitemap.xml
```

Production static exports must not accidentally retain preview noindex tags.

---

# 4. Contact Form Architecture

## Decision

Production contact forms should submit to a central platform endpoint in v1.

Static site form:

```text
clientdomain.com/contact/
```

Submits to:

```text
https://api.yourplatform.com/forms/submit
```

## Requirements

The central endpoint should:

1. Receive the form submission.
2. Validate the site/form identifiers.
3. Verify Cloudflare Turnstile.
4. Apply honeypot and rate-limit checks.
5. Store the submission in the database.
6. Send notification email through Resend.
7. Redirect or respond with success for the thank-you flow.

Important rule:

```text
Store the lead before attempting email delivery.
```

This ensures a lead is not lost if email delivery fails.

## Static Form Data

Each exported site should include stable hidden identifiers:

```html
<input type="hidden" name="site_id" value="site_123">
<input type="hidden" name="form_id" value="contact_main">
```

The server uses these identifiers to look up:

- production domain
- allowed origin/domain
- notification recipients
- Resend sender configuration
- Turnstile secret reference
- spam protection settings

## Form Endpoint Dependency

The production static site depends on the central form endpoint for contact form functionality in v1.

Offboarding can later be handled by replacing the form action with:

- client-owned endpoint
- PHP form handler
- third-party form provider
- client-owned email provider integration

---

# 5. Resend Email Delivery Strategy

## Decision

For v1, lead notification emails will be sent using a platform-owned Resend account with a dedicated verified sending domain.

Clients do not need to create Resend accounts, SMTP accounts, or email provider accounts.

## Recommended Sending Domain

Use a dedicated subdomain separate from the primary business email domain.

Examples:

```text
leads.yourdomain.com
notify.yourdomain.com
mail.yourdomain.com
```

Recommended sender example:

```text
notifications@leads.yourdomain.com
```

## Email Pattern

Example lead notification:

```text
From: Cascade Home Remodeling Website <notifications@leads.yourdomain.com>
To: owner@cascadehomeremodeling.com
Reply-To: jane.customer@example.com
Subject: New website lead from Cascade Home Remodeling
```

## Important Deliverability Rule

Do not send email using the submitter’s email address as the `From` address.

Bad:

```text
From: jane.customer@gmail.com
```

Good:

```text
From: Website Leads <notifications@leads.yourdomain.com>
Reply-To: jane.customer@gmail.com
```

This protects SPF, DKIM, and DMARC alignment.

## Client Setup Burden

For v1, client setup should be minimal:

```text
Client provides the email address where leads should be delivered.
Operator configures and tests delivery.
```

No required client setup:

- Resend account
- SMTP credentials
- email DNS records
- custom sending domain

## Future Upgrade Path

If a client needs branded or higher-volume sending, support can be added later.

Possible future options:

- client-branded sending domain
- client-owned Resend account
- client-owned SMTP/API provider
- CRM integration
- SMS notification
- premium lead routing

High lead volume should be treated as a positive growth signal and potential paid support/upgrade path.

---

# 6. Lead Storage, Admin Log, and Daily Reports

## Decision

For v1, lead submissions should be visible in an admin-only lead log. Clients receive lead notifications by email.

No client-facing lead dashboard is required in v1.

## Admin Lead Log

The admin lead log should allow the operator to view:

- submission ID
- site/business
- production domain
- submitted timestamp
- submitter name/email/phone/message
- notification recipient
- Resend provider message ID
- delivery status
- failed/bounced status
- test submission status
- resend attempts

## Example Lead Record

```json
{
  "submissionId": "sub_123",
  "siteId": "site_123",
  "siteName": "Cascade Home Remodeling",
  "productionDomain": "cascadehomeremodeling.com",
  "submittedAt": "2026-10-07T21:05:00-07:00",
  "formId": "contact_main",
  "isTest": false,
  "submitter": {
    "name": "Jane Customer",
    "email": "jane@example.com",
    "phone": "555-555-5555"
  },
  "message": "I'd like an estimate for a kitchen remodel.",
  "notification": {
    "provider": "resend",
    "recipient": "owner@cascadehomeremodeling.com",
    "fromEmail": "notifications@leads.yourdomain.com",
    "replyTo": "jane@example.com",
    "status": "delivered",
    "providerMessageId": "resend_msg_123",
    "sentAt": "2026-10-07T21:05:03-07:00",
    "deliveredAt": "2026-10-07T21:05:05-07:00"
  }
}
```

## Daily Activity Reports

The system should send daily contact activity reports to admin when there is contact activity.

Recommended rule:

```text
Send daily report if at least one real submission occurred or at least one delivery failure/bounce occurred.
```

The daily report should include:

- date range
- total submissions
- submissions by site
- successful notifications
- failed notifications
- bounces
- test submissions, if included
- links to admin lead records

## Failure Handling

If email delivery fails:

- the lead remains stored
- admin can view the failure
- daily report should flag the issue
- admin should be able to resend notification after correcting the issue

Recommended future action:

```text
Add immediate admin alert for failed lead notification delivery.
```

---

# 7. Cloudflare, Turnstile, and Namecheap Launch Requirement

## Decision

Client-owned Cloudflare setup is a hard production launch requirement.

Cloudflare is required for:

- DNS management
- Turnstile spam protection
- launch consistency
- future security and migration management

Turnstile is required for all production contact forms.

## Namecheap Requirement

For the intended v1 onboarding flow:

```text
Client purchases domain through Namecheap.
Client shares access with operator as a manager.
```

This allows the operator to:

- update nameservers
- verify domain configuration
- support launch
- help migrate DNS to Cloudflare

## Cloudflare Requirement

The client should create and own the Cloudflare account.

The client shares manager/admin access with the operator.

Cloudflare setup includes:

- adding the client domain
- updating nameservers at Namecheap
- configuring DNS records
- configuring SSL/TLS settings as needed
- creating a Turnstile widget
- allowing the production domain in Turnstile
- storing the Turnstile site key and secret reference in the platform

## Turnstile Requirement

Production contact forms must include Cloudflare Turnstile.

Frontend/static export includes the Turnstile site key.

Server-side form endpoint stores or references the Turnstile secret securely and verifies all submissions.

Static form example:

```html
<form method="POST" action="https://api.yourplatform.com/forms/submit">
  <input type="hidden" name="site_id" value="site_123">
  <input type="hidden" name="form_id" value="contact_main">

  <input type="text" name="name" required>
  <input type="email" name="email" required>
  <input type="tel" name="phone">
  <textarea name="message" required></textarea>

  <div class="cf-turnstile" data-sitekey="CLIENT_TURNSTILE_SITE_KEY"></div>

  <button type="submit">Send Message</button>
</form>

<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
```

## Server-Side Turnstile Verification

The central form endpoint must verify the Turnstile token before accepting the lead.

Submission flow:

```text
1. Validate site_id and form_id.
2. Confirm submitted origin/domain is allowed.
3. Check honeypot field.
4. Verify Turnstile token with Cloudflare.
5. Rate limit by IP/site.
6. Validate required fields.
7. Store submission.
8. Send Resend notification.
9. Redirect to thank-you page or return success.
```

No valid Turnstile token means the submission should not be accepted as a valid lead.

## Launch Policy

There is no temporary bypass for production launch.

Production launch requires:

```text
Namecheap access complete
Cloudflare account/access complete
DNS configured
Turnstile configured
Turnstile test passed
Contact form test passed
```

---

# 8. Production Launch Checklist

Before marking a production site launched, verify:

## Domain and Hosting

```text
[ ] Client domain purchased through Namecheap
[ ] Operator has Namecheap manager access
[ ] Client Cloudflare account created
[ ] Operator has Cloudflare manager/admin access
[ ] Domain added to Cloudflare
[ ] Nameservers updated at Namecheap
[ ] Cloudflare DNS records configured
[ ] CloudPanel site created
[ ] Static export copied to web root
[ ] SSL issued and active
[ ] www/non-www behavior verified
```

## Site Content

```text
[ ] Business name correct
[ ] Phone number correct
[ ] Location correct
[ ] Services correct
[ ] CTA copy correct
[ ] No fake claims present
[ ] No fake reviews present
[ ] No fake projects present
[ ] Production robots allow indexing
[ ] Sitemap present if applicable
```

## Contact Form

```text
[ ] Notification recipient configured
[ ] Turnstile widget created
[ ] Turnstile site key included in static export
[ ] Turnstile secret stored securely server-side
[ ] Test submission sent from production domain
[ ] Turnstile verification passed
[ ] Submission stored in database
[ ] Resend notification sent
[ ] Client/admin received notification
[ ] Reply-To points to submitter
[ ] Thank-you flow works
```

## Final Status

```text
[ ] Admin launch review passed
[ ] Site marked launched
[ ] Production domain stored in admin record
[ ] Deployment path/web root stored
[ ] Last exported timestamp stored
[ ] Last deployed timestamp stored
```

---

# 9. Current Scope Boundary

The following decisions are important but should not be included in the active template variable mapping task unless explicitly needed as placeholders:

Out of scope for template variable mapping:

- Resend integration
- Cloudflare Turnstile verification
- CloudPanel deployment
- production launch automation
- DNS/Namecheap onboarding
- lead dashboard
- daily lead reports
- production form endpoint

Acceptable placeholder keys in the template/data model:

```text
contact.formAction
contact.turnstileSiteKey
```

These placeholders allow future form integration without implementing the backend now.

---

# 10. Future Backlog Themes

The planning session produced several future implementation areas:

1. Launch architecture documentation
2. Production static export/deployment workflow
3. Central lead capture endpoint
4. Resend notification delivery
5. Admin lead log and daily activity reports
6. Cloudflare/Namecheap/Turnstile launch checklist
7. Production launch QA checklist

These should be tracked as separate backlog tickets and should not block completion of the current template/data/model MVP work.
