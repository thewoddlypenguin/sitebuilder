/* ============================================================
   PREVIEW RENDERER
   ------------------------------------------------------------
   Reads window.PREVIEW_DATA (js/preview-data.js) and fills the
   [data-preview-*] hooks in index.html. Loads before main.js so
   the reveal observer and drawer logic see the final DOM.

   Safe fallbacks:
   - Missing optional values are CLEARED from the page (first
     render included), so no template business's data can linger.
   - Missing list data -> section and its nav links stay hidden.
   - Reviews/projects/claims render ONLY with real data.
   - Invalid list entries (null, empty objects) are dropped.

   API: window.renderPreview(data) is repeatable for tests.
   ============================================================ */

(function () {
  'use strict';

  /* ---------- helpers ---------- */

  function isBlank(v) {
    return v === undefined || v === null || v === '';
  }

  function pick() {
    for (var i = 0; i < arguments.length; i++) {
      if (!isBlank(arguments[i])) return arguments[i];
    }
    return arguments[arguments.length - 1];
  }

  function has(list) {
    return Array.isArray(list) && list.length > 0;
  }

  // Keep only entries that would render something real: primitives,
  // or objects with at least one non-empty value. Prevents null or
  // empty-object entries from enabling a section or crashing a
  // decorate step.
  function usableEntries(entries) {
    if (!Array.isArray(entries)) return [];
    return entries.filter(function (e) {
      if (e === null || e === undefined) return false;
      if (typeof e === 'string' || typeof e === 'number') return true;
      if (typeof e !== 'object') return false;
      for (var k in e) {
        if (Object.prototype.hasOwnProperty.call(e, k) && !isBlank(e[k])) return true;
      }
      return false;
    });
  }

  // Only for trusted template keys (hero.headline, icon paths). Data
  // files are authored alongside the template, never arbitrary input.
  function setHtml(el, value) {
    el.innerHTML = value;
  }

  function setAttr(el, attr, value) {
    el.setAttribute(attr, String(value));
  }

  function isFormControl(el) {
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
  }

  /* ---------- image slots (JUS-52) ---------- */

  var IMG = (typeof window.PreviewImageDefaults === 'object' && window.PreviewImageDefaults) || null;
  var PROJ_SLOT_ORDER = ['projectFeatured', 'projectKitchen', 'projectBath', 'projectWholeHome'];

  // Swap a .ph placeholder figure for a resolved image, or restore
  // the line-art placeholder view. Repeatable: hero figure is mutated
  // in place (dropping the img + class restores the art); collage
  // clones are rebuilt pristine by renderList before this runs.
  function applyImageSlot(fig, resolved) {
    if (!fig) return;
    var existing = fig.querySelector('img[data-preview-img-img]');
    if (existing) existing.remove();
    fig.classList.remove('is-img');

    if (resolved.source === 'placeholder' || !resolved.url) {
      fig.setAttribute('role', 'img');
      fig.setAttribute('aria-label', resolved.alt);
      return;
    }

    var img = document.createElement('img');
    img.className = 'ph__img';
    img.setAttribute('data-preview-img-img', resolved.slot);
    img.src = resolved.url;
    img.alt = resolved.alt;
    img.loading = 'lazy';
    // A real <img> carries its own semantics; the wrapper's role=img
    // would shadow it for assistive tech.
    fig.removeAttribute('role');
    fig.setAttribute('aria-label', resolved.alt);
    fig.classList.add('is-img');
    fig.appendChild(img);
  }

  function renderImageSlots(data) {
    if (!IMG) return;
    var images = (data && typeof data.images === 'object' && data.images) || {};
    var trade = data && data.business && data.business.trade;
    var tdef = IMG.defaultsFor(data && data.template && data.template.id);

    // Hero slot: static figure outside any list.
    var heroFig = document.querySelector('[data-preview-img="hero"]');
    if (heroFig) applyImageSlot(heroFig, IMG.resolvePreviewImage('hero', images, tdef, trade));

    // Project slots: assigned to collage clones by position
    // (0=featured, 1=kitchen, 2=bath, 3=whole-home).
    var projList = document.querySelector('[data-preview-list="projects"]');
    if (projList) {
      var clones = projList.querySelectorAll('.ph--proj');
      for (var i = 0; i < clones.length; i++) {
        var slotKey = PROJ_SLOT_ORDER[i] || 'projectWholeHome';
        var fig = clones[i].matches('[data-preview-img]') ? clones[i] : clones[i].querySelector('[data-preview-img]');
        if (fig) {
          fig.setAttribute('data-preview-img', slotKey);
          applyImageSlot(fig, IMG.resolvePreviewImage(slotKey, images, tdef, trade));
        }
      }
    }
  }

  // Fill every element carrying the key. A missing value always
  // CLEARS the element (text, attribute, or input value) — including
  // on the first render — so one business's data can never leak into
  // another's preview.
  function fillKey(name, value) {
    var els = document.querySelectorAll('[data-preview-key="' + name + '"]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (isBlank(value)) {
        if (el.hasAttribute('data-preview-value')) {
          el.setAttribute('value', '');
          if (isFormControl(el)) el.value = '';
        } else if (el.hasAttribute('data-preview-attr')) {
          el.removeAttribute(el.getAttribute('data-preview-attr'));
        } else if (el.hasAttribute('data-preview-html')) {
          el.innerHTML = '';
        } else {
          el.textContent = '';
        }
        el.__previewFilled = false;
        continue;
      }
      if (el.hasAttribute('data-preview-html')) {
        setHtml(el, value);
      } else if (el.hasAttribute('data-preview-value')) {
        setAttr(el, 'value', value);
        if (isFormControl(el)) el.value = String(value);
      } else if (el.hasAttribute('data-preview-attr')) {
        setAttr(el, el.getAttribute('data-preview-attr'), value);
      } else {
        el.textContent = String(value);
      }
      el.__previewFilled = true;
    }
  }

  function render(data) {
    data = data || {};
    var business = data.business || {};

    /* ---------- 1. Business identity ---------- */

    var bizName = String(pick(business.name, 'This Business'));
    var bizCity = String(pick(business.city, 'your area'));
    var bizState = String(pick(business.stateName, business.state, ''));
    var bizCityState = bizState ? bizCity + ', ' + bizState : bizCity;

    var nameWords = bizName.split(/\s+/);
    var nameFirst = nameWords[0];
    var nameRest = nameWords.slice(1).join(' ');

    fillKey('meta.title', pick(data.meta && data.meta.title, bizName + ' \u2014 ' + bizCityState + ' (Preview)'));
    fillKey('meta.description', pick(data.meta && data.meta.description,
      'Services for ' + bizCityState + ' homeowners. Clear estimates, clean workmanship, and a smoother experience.'));

    fillKey('banner.desktopText', pick(data.banner && data.banner.desktopText, 'Preview prepared for ' + bizName + '. Like this direction?'));
    fillKey('banner.mobileText', pick(data.banner && data.banner.mobileText, 'Like this direction?'));

    fillKey('header.wordmarkLabel', bizName + ' \u2014 home');
    fillKey('business.nameFirst', nameFirst);
    fillKey('business.nameRest', nameRest);
    fillKey('business.name', bizName);
    fillKey('business.phone', business.phone);
    fillKey('business.phoneHref', business.phoneHref || (business.phone ? 'tel:' + String(business.phone).replace(/[^0-9+]/g, '') : ''));
    fillKey('business.cityState', bizCityState);

    /* ---------- 2. Hero ---------- */

    fillKey('hero.eyebrow', pick(data.hero && data.hero.eyebrow, ''));
    fillKey('hero.headline', pick(data.hero && data.hero.headline, 'Remodeling for ' + bizCity + ' homeowners.'));
    fillKey('hero.lede', pick(data.hero && data.hero.lede, 'Clear communication, clean workmanship, and a smoother renovation experience.'));
    fillKey('hero.location', pick(data.hero && data.hero.location, 'Serving ' + bizCityState + ' and nearby communities.'));
    fillKey('hero.badgeTitle', pick(data.hero && data.hero.badgeTitle, 'Free estimates'));
    fillKey('hero.badgeSub', pick(data.hero && data.hero.badgeSub, 'Honest scope, clear pricing'));

    /* ---------- 3. Section headings ---------- */

    fillKey('services.eyebrow', pick(data.servicesMeta && data.servicesMeta.eyebrow, 'What we do'));
    fillKey('services.title', pick(data.servicesMeta && data.servicesMeta.title, 'Remodeling, handled with care.'));
    fillKey('services.lede', pick(data.servicesMeta && data.servicesMeta.lede, 'Focused services for homeowners who want the work done right \u2014 without the runaround.'));

    fillKey('projects.eyebrow', pick(data.projectsMeta && data.projectsMeta.eyebrow, 'Project showcase'));
    fillKey('projects.title', pick(data.projectsMeta && data.projectsMeta.title, 'See what\u2019s possible for your home.'));
    fillKey('projects.lede', pick(data.projectsMeta && data.projectsMeta.lede, 'A look at the kind of work we take on, from focused updates to whole-home remodels.'));

    fillKey('process.eyebrow', pick(data.processMeta && data.processMeta.eyebrow, 'How it works'));
    fillKey('process.title', pick(data.processMeta && data.processMeta.title, 'A simple, straightforward process.'));

    fillKey('reviews.eyebrow', pick(data.reviewsMeta && data.reviewsMeta.eyebrow, 'What homeowners say'));
    fillKey('reviews.title', pick(data.reviewsMeta && data.reviewsMeta.title, 'Word of mouth, in writing.'));

    var areaMeta = data.serviceArea || {};
    fillKey('serviceArea.eyebrow', pick(areaMeta.eyebrow, 'Service area'));
    fillKey('serviceArea.title', pick(areaMeta.title, 'Serving ' + bizCityState + ' and nearby communities.'));
    fillKey('serviceArea.lede', pick(areaMeta.lede, bizName + ' works with homeowners throughout ' + bizCityState + '.'));
    fillKey('serviceArea.chip', pick(areaMeta.chip, has(areaMeta.communities) ? areaMeta.communities[0] + ' service area' : '', 'Service area'));

    fillKey('finalCta.eyebrow', pick(data.finalCta && data.finalCta.eyebrow, 'Free estimates \u00b7 ' + bizCityState));
    fillKey('finalCta.headline', pick(data.finalCta && data.finalCta.headline, 'Ready to talk about your remodel?'));
    fillKey('finalCta.copy', pick(data.finalCta && data.finalCta.copy, 'Tell us what you have in mind and we\u2019ll help you take the next step.'));
    fillKey('finalCta.micro', pick(data.finalCta && data.finalCta.micro, 'No pressure, no obligation \u2014 just a clear next step.'));

    /* ---------- 4. Conditional sections + nav ---------- */

    // Sections render only from VALIDATED (usable) entries; nav items
    // follow the same signal. Both are driven by the [data-preview-*]
    // hooks present in the markup, not a hardcoded list.
    var sectionLists = {
      claims: has(usableEntries(data.claims)),
      services: has(usableEntries(data.services)),
      projects: has(usableEntries(data.projects)),
      process: has(usableEntries(data.process)),
      reviews: has(usableEntries(data.reviews))
    };

    var sectionEls = document.querySelectorAll('[data-preview-section]');
    for (var s = 0; s < sectionEls.length; s++) {
      var sectionEl = sectionEls[s];
      var sectionName = sectionEl.getAttribute('data-preview-section');
      if (sectionLists[sectionName]) {
        sectionEl.removeAttribute('hidden');
      } else {
        sectionEl.hidden = true;
      }
    }

    // Nav items for absent sections are hidden (reversible on re-render;
    // CSS guarantees [hidden] wins over display utilities).
    var navEls = Array.prototype.slice.call(document.querySelectorAll('[data-preview-nav]'));
    for (var n = 0; n < navEls.length; n++) {
      var navName = navEls[n].getAttribute('data-preview-nav');
      navEls[n].hidden = !sectionLists[navName];
    }

    var servicesAnchor = document.querySelector('[data-preview-services-anchor]');
    if (servicesAnchor) {
      if (sectionLists.services) {
        servicesAnchor.setAttribute('href', '#services');
        servicesAnchor.textContent = 'View Services';
      } else if (sectionLists.projects) {
        servicesAnchor.setAttribute('href', '#projects');
        servicesAnchor.textContent = 'View Projects';
      } else {
        servicesAnchor.setAttribute('href', '#contact');
        servicesAnchor.textContent = 'Get in Touch';
      }
    }

    /* ---------- 5. List rendering ---------- */

    // Templates are captured ONCE (first render) and reused, so render()
    // stays repeatable: every call rebuilds lists from the pristine
    // template, never from a previously filled clone.
    var templates = window.__previewTemplates || (window.__previewTemplates = {});

    function buildFromTemplate(templateHtml) {
      var holder = document.createElement('div');
      holder.innerHTML = templateHtml;
      return holder.children[0];
    }

    function renderList(container, listName, entries, decorate) {
      if (!container) return;
      if (!templates[listName]) {
        var t = container.children[0];
        if (t) templates[listName] = t.outerHTML;
      }
      var templateHtml = templates[listName];
      if (!templateHtml) return;

      container.innerHTML = '';
      var valid = usableEntries(entries);

      if (!valid.length) {
        // Restore the pristine template so later renders with data work.
        container.appendChild(buildFromTemplate(templateHtml));
        return;
      }

      for (var i = 0; i < valid.length; i++) {
        var node = buildFromTemplate(templateHtml);
        var entry = valid[i];
        var slots = node.querySelectorAll('[data-preview-slot]');

        if (typeof entry === 'string' || typeof entry === 'number') {
          // Plain-value lists (e.g. communities): fill the node itself.
          if (slots.length) slots[0].textContent = String(entry);
          else node.textContent = String(entry);
        } else {
          for (var j = 0; j < slots.length; j++) {
            var slotEl = slots[j];
            var slotVal = entry[slotEl.getAttribute('data-preview-slot')];
            // Missing slot values clear the template copy instead of
            // letting demo text reach the rendered page.
            slotEl.textContent = isBlank(slotVal) ? '' : String(slotVal);
          }
        }

        if (decorate) decorate(node, entry, i);
        // Re-rendered clones were never observed by main.js's reveal
        // observer (it captured the initial DOM), so show them directly.
        node.classList.add('is-visible');
        container.appendChild(node);
      }
      // The list now holds real content: show it. (Some lists, like the
      // projects highlight bullets, ship with hidden in the markup.)
      container.removeAttribute('hidden');
    }

    var iconSvgs = {
      kitchen: '<path d="M5 13h22M8 13v13M16 13v13M24 13v13M5 13l4-6h14l4 6M11 20h5"/><circle cx="20.5" cy="24" r="1.4"/>',
      bathroom: '<path d="M5 17h22v3a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5v-3ZM8 17V7.5A2.5 2.5 0 0 1 10.5 5c1.4 0 2.5 1.1 2.5 2.5V9M10 25l-1.5 3M22 25l1.5 3"/>',
      'whole-home': '<path d="M4 14 16 5l12 9"/><path d="M7.5 12.5V27h17V12.5"/><path d="M13 27v-7h6v7M12 16h2M18 16h2"/>'
    };

    var claimIcons = {
      check: '<path d="M4 12.5 9.5 18 20 6.5"/>',
      pin: '<path d="M12 21s-6.5-5.4-6.5-10a6.5 6.5 0 0 1 13 0c0 4.6-6.5 10-6.5 10Z"/><circle cx="12" cy="10.6" r="2.3"/>',
      broom: '<path d="M5 13.5 9 17.5 19 7"/><path d="M3.5 20.5h17"/>',
      home: '<path d="M4 11 12 4l8 7"/><path d="M6.5 9.5V20h11V9.5"/><path d="M10 20v-5h4v5"/>'
    };

    renderList(document.querySelector('[data-preview-list="claims"]'), 'claims', data.claims, function (node, entry, i) {
      var claimText = (typeof entry === 'string' || typeof entry === 'number') ? String(entry) : (entry.text || '');
      var claimIconName = (entry && typeof entry === 'object' && entry.icon) || 'check';

      var label = node.querySelector('span:last-of-type');
      if (label) label.textContent = claimText;

      var iconEl = node.querySelector('.trust-item__icon');
      if (iconEl) {
        iconEl.innerHTML = claimIcons[claimIconName] || claimIcons.check;
      }
      node.style.setProperty('--d', (i * 0.07) + 's');
    });

    renderList(document.querySelector('[data-preview-list="services"]'), 'services', data.services, function (node, entry, i) {
      var iconHost = node.querySelector('[data-preview-slot="icon"]');
      if (iconHost) {
        var iconName = (entry && typeof entry === 'object' && entry.icon) || 'whole-home';
        iconHost.innerHTML = '<svg viewBox="0 0 32 32" aria-hidden="true">' + (iconSvgs[iconName] || iconSvgs['whole-home']) + '</svg>';
      }

      // "Learn more" opens the detail modal only when the entry has
      // detail fields; without them the link falls back to a plain
      // #contact jump (graceful no-JS behavior stays intact).
      var moreLink = node.querySelector('.service-card__more');
      if (moreLink) {
        var d = entry && typeof entry === 'object' ? entry.detail : null;
        var hasDetail = !!(d && typeof d === 'object' &&
          (d.headline || d.copy || (Array.isArray(d.bullets) && d.bullets.length) || d.goodFit));
        if (hasDetail) {
          moreLink.removeAttribute('hidden');
          moreLink.setAttribute('aria-label', 'Learn more about ' + ((entry && entry.title) || 'this service'));
        } else {
          moreLink.hidden = true;
        }
      }

      node.style.setProperty('--d', (i * 0.08) + 's');
    });

    renderList(document.querySelector('[data-preview-list="projects"]'), 'projects', data.projects, function (node, entry, i) {
      if (i === 0) node.classList.add('ph--proj-featured');
      else node.classList.remove('ph--proj-featured');
      node.style.setProperty('--d', (i * 0.06) + 's');
    });

    // Highlight bullets come from the first project's highlights[] and
    // exist only while the projects section is shown with real data.
    renderList(document.querySelector('[data-preview-list="projectHighlights"]'), 'projectHighlights',
      (sectionLists.projects && data.projects && data.projects[0] && data.projects[0].highlights) || []);

    renderList(document.querySelector('[data-preview-list="process"]'), 'process', data.process, function (node, entry, i) {
      var num = node.querySelector('[data-preview-slot="num"]');
      if (num) num.textContent = ('0' + (i + 1)).slice(-2);
      node.style.setProperty('--d', (i * 0.07) + 's');
    });

    renderList(document.querySelector('[data-preview-list="reviews"]'), 'reviews', data.reviews, function (node, entry, i) {
      node.style.setProperty('--d', (i * 0.08) + 's');
    });

    var communities = areaMeta.communities;
    var areaList = document.querySelector('[data-preview-list="serviceArea.communities"]');
    renderList(areaList, 'serviceArea.communities', communities);
    if (areaList) areaList.hidden = !has(usableEntries(communities));

    // Image slots (JUS-52): resolve override -> template default ->
    // placeholder for hero + project collage. Runs after list building
    // so collage clones exist; placeholders stay when nothing resolves.
    renderImageSlots(data);

    // Reset the customer-facing service detail modal: a re-render with
    // new data must never leave a previous dataset's detail content in
    // a closed modal waiting to flash open stale.
    var detailRootEl = document.getElementById('service-detail');
    if (detailRootEl) {
      if (detailRootEl.classList.contains('is-open') && typeof window.closeServiceDetail === 'function') {
        window.closeServiceDetail();
      } else {
        detailRootEl.classList.remove('is-open');
        detailRootEl.setAttribute('aria-hidden', 'true');
      }
      var detailTitleEl = detailRootEl.querySelector('.service-detail__title');
      var detailCopyEl = detailRootEl.querySelector('.service-detail__copy');
      var detailFitEl = detailRootEl.querySelector('.service-detail__fit');
      var detailBulletsEl = detailRootEl.querySelector('.service-detail__bullets');
      if (detailTitleEl) detailTitleEl.textContent = '';
      if (detailCopyEl) detailCopyEl.textContent = '';
      if (detailFitEl) { detailFitEl.textContent = ''; detailFitEl.hidden = true; }
      if (detailBulletsEl) detailBulletsEl.innerHTML = '';
    }

    document.documentElement.setAttribute('data-preview-rendered', 'true');
  }

  // Expose for tests and re-render flows.
  window.renderPreview = render;

  // Initial render from the data file, if present.
  render(window.PREVIEW_DATA);
})();
