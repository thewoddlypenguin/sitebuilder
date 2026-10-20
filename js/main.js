/* ============================================================
   Cascade Home Remodeling — preview template
   Vanilla JS: drawer, scroll reveal, mobile nav, active section
   ============================================================ */

(function () {
  'use strict';

  /* ----------------------------------------------------------
     1. Launch drawer / bottom sheet
     ---------------------------------------------------------- */

  var drawerRoot = document.querySelector('.drawer-root');
  var drawer = drawerRoot ? drawerRoot.querySelector('.drawer') : null;
  var drawerBody = drawer ? drawer.querySelector('.drawer__body') : null;
  var drawerClose = drawer ? drawer.querySelector('.drawer__close') : null;
  var drawerViews = drawer ? drawer.querySelectorAll('[data-drawer-view]') : [];
  var questionForm = document.getElementById('question-form');
  var formStatus = document.getElementById('question-form-status');
  var lastFocused = null;
  var activeDrawerView = 'launch';
  var submitLabel = '';
  var submissionSession = 0;
  var latestSubmitSession = 0;
  var activeAbort = null;

  if (questionForm) {
    var initialSubmit = questionForm.querySelector('[type="submit"]');
    if (initialSubmit) submitLabel = initialSubmit.textContent;
  }

  // Every new drawer session (open, close, or view change) invalidates any
  // in-flight form submission, so a stale response can never clobber a
  // newer form state.
  function invalidateSubmission() {
    submissionSession += 1;
    if (activeAbort) {
      activeAbort.abort();
      activeAbort = null;
    }
  }

  // Restore the submit button and clear any error banner. Used when the
  // question view is entered after an in-flight request was invalidated.
  function resetQuestionFormState() {
    if (!questionForm) return;
    var submitButton = questionForm.querySelector('[type="submit"]');
    if (submitButton) {
      submitButton.disabled = false;
      if (submitLabel) submitButton.textContent = submitLabel;
    }
    if (formStatus) {
      formStatus.hidden = true;
      formStatus.textContent = '';
    }
  }

  function focusables() {
    if (!drawer) return [];
    return Array.prototype.filter.call(
      drawer.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), textarea:not([disabled]), [tabindex="0"]'),
      function (el) { return !el.closest('[hidden]'); }
    );
  }

  function setDrawerView(view, moveFocus) {
    if (!drawer) return;
    var selected = drawer.querySelector('[data-drawer-view="' + view + '"]');
    if (!selected) {
      view = 'launch';
      selected = drawer.querySelector('[data-drawer-view="launch"]');
    }

    activeDrawerView = view;
    drawerViews.forEach(function (panel) {
      panel.hidden = panel !== selected;
    });

    if (drawerBody) drawerBody.scrollTop = 0;
    if (formStatus) {
      formStatus.hidden = true;
      formStatus.textContent = '';
    }

    var title = selected ? selected.querySelector('.drawer__title') : null;
    if (title) drawer.setAttribute('aria-labelledby', title.id);
    if (drawerClose) drawerClose.setAttribute('aria-label', view === 'question' ? 'Close question form' : 'Close launch details');

    if (moveFocus) {
      window.setTimeout(function () {
        var target = view === 'question' ? document.getElementById('question-name') : title;
        if (target) target.focus({ preventScroll: true });
      }, 40);
    }
  }

  function openDrawer(view) {
    if (!drawerRoot) return;
    invalidateSubmission();
    if (view === 'question') resetQuestionFormState();
    lastFocused = document.activeElement;
    setDrawerView(typeof view === 'string' ? view : 'launch', false);
    drawerRoot.setAttribute('aria-hidden', 'false');
    drawerRoot.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    window.setTimeout(function () {
      var target = activeDrawerView === 'question'
        ? document.getElementById('question-name')
        : drawer.querySelector('[data-drawer-view="' + activeDrawerView + '"] .drawer__title');
      if (target) target.focus({ preventScroll: true });
      else if (drawer) drawer.focus({ preventScroll: true });
    }, 80);
  }

  function closeDrawer() {
    if (!drawerRoot) return;
    invalidateSubmission();
    drawerRoot.setAttribute('aria-hidden', 'true');
    drawerRoot.classList.remove('is-open');
    document.body.style.overflow = '';
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus({ preventScroll: true });
    }
  }

  // Explicit triggers select either launch details or the owner inquiry form.
  document.querySelectorAll('[data-open-drawer]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      openDrawer(btn.getAttribute('data-open-drawer') || 'launch');
    });
  });

  document.querySelectorAll('[data-drawer-view-trigger]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var nextView = btn.getAttribute('data-drawer-view-trigger') || 'launch';
      invalidateSubmission();
      if (nextView === 'question') resetQuestionFormState();
      setDrawerView(nextView, true);
    });
  });

  // Close triggers: close X, backdrop, and success-state close button.
  document.querySelectorAll('[data-close-drawer]').forEach(function (el) {
    el.addEventListener('click', closeDrawer);
  });

  // Escape key + focus trap, scoped to whichever drawer view is visible.
  document.addEventListener('keydown', function (e) {
    if (!drawerRoot || !drawerRoot.classList.contains('is-open')) return;

    if (e.key === 'Escape') {
      closeDrawer();
      return;
    }

    if (e.key === 'Tab') {
      var items = focusables();
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];

      if (e.shiftKey && (document.activeElement === first || document.activeElement === drawer)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  if (questionForm) {
    questionForm.addEventListener('submit', async function (e) {
      e.preventDefault();

      if (!questionForm.checkValidity()) {
        questionForm.reportValidity();
        return;
      }

      // Honeypot submissions are treated as complete without sending data.
      if (questionForm.elements.company_website.value) {
        invalidateSubmission();
        questionForm.reset();
        setDrawerView('success', true);
        return;
      }

      var submitButton = questionForm.querySelector('[type="submit"]');

      // Guard against overlapping submissions (e.g. programmatic submits
      // while a request is still in flight).
      if (submitButton && submitButton.disabled) return;

      var endpoint = questionForm.getAttribute('data-form-endpoint').trim();
      var session = ++submissionSession;
      latestSubmitSession = session;
      var controller = ('AbortController' in window) ? new AbortController() : null;
      activeAbort = controller;

      submitButton.disabled = true;
      submitButton.textContent = 'Sending…';
      if (formStatus) formStatus.hidden = true;

      // A completed request only applies if this submission is still the
      // current session (drawer wasn't closed/reopened and the view
      // wasn't switched while the request was in flight).
      function isStale() {
        return session !== submissionSession;
      }

      try {
        // CONFIG: an empty endpoint uses the local MVP success state. Add a
        // Formspree-compatible endpoint in index.html to enable real delivery.
        if (endpoint) {
          var response = await fetch(endpoint, {
            method: 'POST',
            body: new FormData(questionForm),
            headers: { Accept: 'application/json' },
            signal: controller ? controller.signal : undefined
          });
          if (isStale()) return;
          if (!response.ok) throw new Error('Form endpoint rejected the submission.');
        }

        if (isStale()) return;
        questionForm.reset();
        setDrawerView('success', true);
      } catch (error) {
        if (isStale()) return;
        if (formStatus) {
          formStatus.textContent = 'Something went wrong. Please try again, or email us directly.';
          formStatus.hidden = false;
          formStatus.focus({ preventScroll: true });
        }
      } finally {
        // Restore the button only if no newer submission has taken over the
        // form. Resetting the button is harmless when a new session has
        // reset the form, so track "latest" separately from "current
        // drawer session" to avoid leaving stale disabled state behind.
        if (session === latestSubmitSession) {
          submitButton.disabled = false;
          submitButton.textContent = submitLabel || 'Send Question';
          if (activeAbort === controller) activeAbort = null;
        }
      }
    });
  }

  // If a purchase link is followed, make sure the page is scrollable again.
  var purchaseBtn = document.querySelector('[data-purchase]');
  if (purchaseBtn) {
    purchaseBtn.addEventListener('click', function () {
      document.body.style.overflow = '';
    });
  }

  if (drawerBody) drawerBody.scrollTop = 0;
  setDrawerView('launch', false); // Initialize the default drawer view.

  /* ----------------------------------------------------------
     2. Reveal-on-scroll (gentle, one-time)
     ---------------------------------------------------------- */

  var revealEls = document.querySelectorAll('.reveal');

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    revealEls.forEach(function (el) { revealObserver.observe(el); });
  }

  /* ----------------------------------------------------------
     3. Mobile navigation
     ---------------------------------------------------------- */

  var navToggle = document.querySelector('.nav-toggle');
  var mobileNav = document.getElementById('mobile-nav');

  function closeMobileNav() {
    if (!navToggle || !mobileNav) return;
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Open menu');
    mobileNav.hidden = true;
  }

  if (navToggle && mobileNav) {
    navToggle.addEventListener('click', function () {
      var expanded = navToggle.getAttribute('aria-expanded') === 'true';
      if (expanded) {
        closeMobileNav();
      } else {
        navToggle.setAttribute('aria-expanded', 'true');
        navToggle.setAttribute('aria-label', 'Close menu');
        mobileNav.hidden = false;
      }
    });

    // Close the menu when a link inside is chosen
    mobileNav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', closeMobileNav);
    });
  }

  /* ----------------------------------------------------------
     4. Smooth-scroll for in-page anchors, offset-aware
     ---------------------------------------------------------- */

  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var id = link.getAttribute('href');
      if (!id || id === '#') return;
      // Service-detail triggers (and the modal CTA) manage their own
      // behavior: opening the modal must not scroll the page behind it.
      if (link.closest('[data-service-detail="learn"]')) return;
      if (link.hasAttribute('data-service-detail-cta')) return;
      var target = document.querySelector(id);
      if (!target) return;

      e.preventDefault();
      target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      history.replaceState(null, '', id);
    });
  });

  /* ----------------------------------------------------------
     5. Service detail modal (customer-facing)
     ----------------------------------------------------------
     Opens from the "Learn more" link on each service card. Content
     is filled from the live service entry at OPEN time, so nothing
     stale persists between openings or survives a renderPreview()
     re-render. CTA closes the modal and scrolls to #contact; focus
     returns to the triggering link on close (Escape/backdrop/CTA).
     ---------------------------------------------------------- */

  var detailRoot = document.getElementById('service-detail');
  var detailDialog = detailRoot ? detailRoot.querySelector('.service-detail') : null;
  var detailTitle = detailRoot ? detailRoot.querySelector('.service-detail__title') : null;
  var detailCopy = detailRoot ? detailRoot.querySelector('.service-detail__copy') : null;
  var detailBullets = detailRoot ? detailRoot.querySelector('.service-detail__bullets') : null;
  var detailFit = detailRoot ? detailRoot.querySelector('.service-detail__fit') : null;
  var detailCta = detailRoot ? detailRoot.querySelector('[data-service-detail-cta]') : null;
  var detailLastFocused = null;

  function currentServices() {
    var data = window.PREVIEW_DATA || {};
    return Array.isArray(data.services) ? data.services : [];
  }

  function serviceHasDetail(entry) {
    if (!entry || typeof entry !== 'object') return false;
    var d = entry.detail;
    if (!d || typeof d !== 'object') return false;
    return !!(d.headline || d.copy || (Array.isArray(d.bullets) && d.bullets.length) || d.goodFit);
  }

  // Wipe all modal content back to empty. Called on close so no
  // service's data survives into the next opening.
  function clearServiceDetail() {
    if (detailTitle) detailTitle.textContent = '';
    if (detailCopy) detailCopy.textContent = '';
    if (detailFit) { detailFit.textContent = ''; detailFit.hidden = true; }
    if (detailBullets) detailBullets.innerHTML = '';
    if (detailDialog) detailDialog.setAttribute('aria-labelledby', 'service-detail-title');
  }

  function closeServiceDetail() {
    if (!detailRoot || !detailRoot.classList.contains('is-open')) return;
    detailRoot.classList.remove('is-open');
    detailRoot.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (detailLastFocused && typeof detailLastFocused.focus === 'function') {
      detailLastFocused.focus({ preventScroll: true });
    }
    detailLastFocused = null;
    // Clear after the close transition so the sheet never flashes
    // empty content mid-animation.
    window.setTimeout(clearServiceDetail, 350);
  }

  // Exposed so the preview renderer can reset the modal during a
  // renderPreview() re-render (no stale detail content between datasets).
  window.closeServiceDetail = closeServiceDetail;

  function openServiceDetail(index, trigger) {
    if (!detailRoot) return;
    var services = currentServices();
    var entry = services[index];
    if (!serviceHasDetail(entry)) return;

    // Prefer the explicit trigger: programmatic .click() (and some
    // screen-reader activation modes) do not move focus, so relying on
    // document.activeElement can strand focus on <body> after close.
    detailLastFocused = trigger || (document.activeElement !== document.body ? document.activeElement : null);

    // Fill from the live entry — always fresh, never stale.
    var d = entry.detail || {};
    if (detailTitle) detailTitle.textContent = d.headline || entry.title || '';
    if (detailCopy) detailCopy.textContent = d.copy || '';
    if (detailBullets) {
      detailBullets.innerHTML = '';
      var bullets = Array.isArray(d.bullets) ? d.bullets : [];
      bullets.forEach(function (b) {
        if (b === undefined || b === null || b === '') return;
        var li = document.createElement('li');
        li.textContent = String(b);
        detailBullets.appendChild(li);
      });
      detailBullets.hidden = bullets.length === 0;
    }
    if (detailFit) {
      detailFit.textContent = d.goodFit || '';
      detailFit.hidden = !d.goodFit;
    }

    detailRoot.setAttribute('aria-hidden', 'false');
    detailRoot.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    window.setTimeout(function () {
      if (detailTitle) detailTitle.focus({ preventScroll: true });
    }, 60);
  }

  // Delegate clicks: works for renderer-cloned cards too (the reveal
  // clones are not re-bound), and no re-binding needed on re-render.
  if (detailRoot) {
    document.addEventListener('click', function (e) {
      var trigger = e.target.closest ? e.target.closest('[data-service-detail]') : null;
      if (trigger && trigger.getAttribute('data-service-detail') === 'learn') {
        e.preventDefault();
        var card = trigger.closest('.service-card');
        var grid = trigger.closest('[data-preview-list]');
        if (card && grid) {
          var cards = Array.prototype.slice.call(grid.querySelectorAll(':scope > .service-card'));
          var idx = cards.indexOf(card);
          if (idx !== -1) openServiceDetail(idx, trigger);
        }
        return;
      }

      if (e.target.closest && e.target.closest('[data-close-service-detail]')) {
        closeServiceDetail();
        return;
      }

      // CTA: close, then scroll to #contact. (The section-4 anchor
      // handler skips links carrying data-service-detail-cta, so the
      // modal's own behavior owns this scroll — it must happen AFTER
      // closeServiceDetail() unlocks body scroll.)
      if (e.target.closest && e.target.closest('[data-service-detail-cta]')) {
        var ctaLink = e.target.closest('a[href^="#"]');
        var ctaTarget = ctaLink && document.querySelector(ctaLink.getAttribute('href'));
        if (ctaLink && ctaTarget) {
          e.preventDefault();
          closeServiceDetail();
          ctaTarget.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
          history.replaceState(null, '', ctaLink.getAttribute('href'));
        } else {
          closeServiceDetail();
        }
      }
    });

    // Escape closes. Tab is trapped inside the modal while open.
    document.addEventListener('keydown', function (e) {
      if (!detailRoot.classList.contains('is-open')) return;

      if (e.key === 'Escape') {
        closeServiceDetail();
        return;
      }

      if (e.key === 'Tab' && detailDialog) {
        var items = Array.prototype.filter.call(
          detailDialog.querySelectorAll('a[href], button:not([disabled]), [tabindex="0"]'),
          function (el) { return !el.closest('[hidden]'); }
        );
        if (!items.length) return;
        var first = items[0];
        var last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === detailDialog)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

  /* ----------------------------------------------------------
     6. Current year in footer (harmless nicety)
     ---------------------------------------------------------- */

  // Intentionally not used — footer carries no date to keep the
  // preview timeless. Left as a hook for customization.
})();
