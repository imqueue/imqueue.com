/* Shared client behavior for both editions: theme switcher + mobile nav.
   Theme is persisted per-origin in localStorage['imqueue-theme']; the .com and
   .org sites are separate origins, so each remembers its own theme (by design). */
(function () {
  /** The three states of the theme switch. "system" means nothing is stored. */
  type ThemeMode = 'light' | 'dark' | 'system';

  var KEY = 'imqueue-theme';
  var root = document.documentElement;

  function stored(): string | null {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function currentMode(): ThemeMode {
    var m = stored();
    return (m === 'light' || m === 'dark') ? m : 'system';
  }
  function apply(mode: ThemeMode): void {
    if (mode === 'light' || mode === 'dark') {
      root.setAttribute('data-theme', mode);
    } else {
      root.removeAttribute('data-theme');
    }
    try {
      if (mode === 'system') { localStorage.removeItem(KEY); }
      else { localStorage.setItem(KEY, mode); }
    } catch (e) {}
    reflect(mode);
  }
  function reflect(mode: ThemeMode): void {
    document.querySelectorAll('[data-theme-set]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-theme-set') === mode));
    });
  }

  /** A `data-theme-set` attribute, if it names one of the three modes. */
  function asMode(value: string | null): ThemeMode | null {
    return value === 'light' || value === 'dark' || value === 'system' ? value : null;
  }

  // One place that moves the drawer, because `aria-expanded` on the burger is the only
  // thing that tells a screen reader it moved. The markup ships it as "false" and every
  // path that opens or closes the drawer has to keep it honest.
  function setDrawer(open: boolean): void {
    var drawer = document.querySelector('[data-mobile-nav]');
    var burger = document.querySelector('[data-nav-toggle]');

    if (drawer) { drawer.classList.toggle('open', open); }
    if (burger) { burger.setAttribute('aria-expanded', String(open)); }
  }

  function drawerIsOpen(): boolean {
    var drawer = document.querySelector('[data-mobile-nav]');

    return !!drawer && drawer.classList.contains('open');
  }

  document.addEventListener('click', function (e) {
    // `instanceof Element` rather than a truthiness test on `.closest`: an EventTarget
    // need not be a node at all, and this states that in one place per listener.
    if (!(e.target instanceof Element)) { return; }

    var setBtn = e.target.closest('[data-theme-set]');
    if (setBtn) {
      var mode = asMode(setBtn.getAttribute('data-theme-set'));
      if (mode) { apply(mode); }
      return;
    }

    var burger = e.target.closest('[data-nav-toggle]');
    if (burger) { setDrawer(!drawerIsOpen()); return; }

    // Close the drawer when a tap inside it leads somewhere else: a link, or the search
    // trigger — that one opens a dialog on top, and without this the drawer is still
    // sitting there once the dialog is dismissed. The theme buttons are deliberately not
    // in this list: changing skin is something you do and then stay put.
    if (e.target.closest('[data-mobile-nav] a, [data-mobile-nav] [data-search-open]')) {
      setDrawer(false);
    }
  });

  // The burger is the only way to close the drawer, so when the viewport widens past the
  // point where the nav collapses, an open drawer is stranded: expanded over the desktop
  // nav with no visible control to dismiss it. Testing whether the burger still renders
  // keeps the breakpoint in css/base.css and stops it being duplicated here.
  window.addEventListener('resize', function () {
    var burger = document.querySelector('[data-nav-toggle]');

    if (drawerIsOpen() && burger && !burger.getClientRects().length) { setDrawer(false); }
  });

  // keep "system" pages in sync when OS theme flips
  try {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', function () { if (currentMode() === 'system') reflect('system'); });
  } catch (e) {}

  reflect(currentMode());

  // Move the in-content [[toc]] into the right-hand sidebar slot, if present.
  (function () {
    var layout = document.querySelector('.doc-layout');
    if (!layout) return;
    var toc = layout.querySelector('.prose > .table-of-contents');
    var slot = layout.querySelector('[data-toc-slot]');
    if (toc && slot && toc.querySelector('a')) {
      slot.appendChild(toc);
      layout.classList.add('has-toc');
    } else if (layout.querySelector('.doc-toc-pin')) {
      // A pinned link (tocPin in front matter, see docs.html) is reason enough to
      // show the sidebar. Without this the CSS that hides an empty menu would hide
      // the pin too, on any page that pins one without an [[toc]].
      layout.classList.add('has-toc');
    }

    // Scroll-spy: highlight the section currently in view (like the tutorial's
    // active chapter).
    /** One "On this page" link and the heading it points at. */
    interface TocTarget {
      a: HTMLAnchorElement;
      el: HTMLElement;
    }

    var links = Array.prototype.slice.call(
      layout.querySelectorAll('.doc-toc a[href^="#"]')
    ) as HTMLAnchorElement[];
    var targets = links.map(function (a): TocTarget | null {
      // markdown-it-anchor runs the slug through encodeURIComponent and writes
      // the RESULT into the id attribute, so a heading like "Data & events"
      // really is id="data-%26-events". Look the raw fragment up first;
      // decoding it would ask for "data-&-events" and find nothing, and a
      // dropped target silently leaves the previous item highlighted while
      // that section is on screen. The decoded form stays as a fallback for a
      // hand-written id holding a literal non-ASCII character.
      var frag = (a.getAttribute('href') || '').slice(1);
      var el = document.getElementById(frag);
      if (!el) {
        try { el = document.getElementById(decodeURIComponent(frag)); } catch (e) {}
      }
      return el ? { a: a, el: el } : null;
    }).filter(function (t): t is TocTarget { return t !== null; });
    if (!targets.length) return;

    // `const`, because `sync` below is a closure over it and only an unassignable
    // binding keeps a narrowing across one.
    const found = targets;

    function sync() {
      // Re-read rather than captured: `found[0]` is `TocTarget | undefined` to the
      // checker whatever the length test above established, and narrowing it here —
      // in the function that uses it — costs one line and no assertion.
      var current = found[0];

      if (!current) { return; }

      for (var i = 0; i < found.length; i++) {
        var entry = found[i];
        if (!entry) break;
        if (entry.el.getBoundingClientRect().top - 140 <= 0) current = entry;
        else break;
      }
      links.forEach(function (a) { a.classList.remove('active'); });
      current.a.classList.add('active');
    }
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync, { passive: true });
    sync();
  })();

  // ---- FAQ accordion: open the item a deep link points at ----
  // Search results, the "On this page" index and llms.txt all hand out
  // <page>#<question-slug>, and the fragment names a collapsed <details> — see the
  // faqAccordion filter in eleventy.config.mts. Without this the browser scrolls to
  // the right place and shows a closed question, which reads as the answer having
  // gone missing. Re-scrolled after opening so the CSS scroll-margin applies to
  // the summary's final position rather than to where it sat while closed.
  (function () {
    function openTarget() {
      var frag = location.hash.slice(1);
      if (!frag) return;
      // Same two-step lookup the scroll-spy above uses, and for the same reason:
      // markdown-it-anchor writes the encodeURIComponent'd slug into the id.
      var el = document.getElementById(frag);
      if (!el) {
        try { el = document.getElementById(decodeURIComponent(frag)); } catch (e) {}
      }
      if (!(el instanceof HTMLDetailsElement) || el.open) return;
      el.open = true;
      el.scrollIntoView();
    }
    openTarget();
    window.addEventListener('hashchange', openTarget);
  })();

  // ---- roll down / roll up: every disclosure on the site, one behaviour ----
  // <details> cannot be animated natively: the body is not rendered at all while the
  // element is closed, so there is no height to transition from or to, and the browser
  // flips the state the instant the summary is clicked, leaving nothing on screen to
  // animate out. So the open flag is driven by hand. Opening sets it first and animates
  // the body up from zero; closing animates down and only then clears it, which is what
  // keeps the content visible for the length of the roll-up.
  //
  // This lived inline on /api/ and covered that page's two disclosures only, so the FAQ
  // accordion snapped open while the package groups next to it rolled. Expanding and
  // collapsing is one interaction on this site, so it is one implementation, here.
  //
  // Each kind names its own body, because the element that grows is the one whose height
  // is animated and a <details> has no single "content" child to find generically.
  (function () {
    // Every disclosure on either edition, and the only place the list lives. A new
    // kind of collapsible needs one line here; the alternative — the page it appears
    // on animating its own — is what let /api/ roll while the FAQ snapped.
    var ROLLS = [
      { group: '.api-pkg-group', body: '.api-pkg-list' },   // /api/ package groups
      { group: '.api-older', body: '.api-older-body' },     // /api/ "Older versions"
      { group: '.faq details', body: '.faq-a' },            // /api/faq/ accordion
      { group: '.fx-acc', body: '.fx-acc-body' },           // imqueue.com pricing/licence Q&A
    ];

    var DURATION = 200;
    // `{ matches: false }` where matchMedia is absent, which is why this is typed by
    // what it is USED for rather than as MediaQueryList — only `.matches` is read.
    var reduced: { matches: boolean } = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : { matches: false };

    function roll(el: HTMLDetailsElement, body: HTMLElement | null): void {
      var summary = el.querySelector('summary');

      if (!summary || !body || !body.animate) { return; }

      // `const` for the same reason as elsewhere in this file: the listener below is a
      // closure, and only an unassignable binding keeps the "not null" established above.
      const target = body;

      summary.addEventListener('click', function (e) {
        // Honour the OS setting by doing nothing and letting <details> behave
        // natively — the state still changes, just without the movement.
        if (reduced.matches) { return; }
        // Ignore a click that lands mid-roll rather than queueing or reversing it.
        if (el.hasAttribute('data-rolling')) { e.preventDefault(); return; }

        e.preventDefault();
        var opening = !el.open;

        // The value, not just the presence, so a marker can flip at the start of a
        // roll-up instead of waiting for `open` to clear at the end of it.
        el.setAttribute('data-rolling', opening ? 'open' : 'close');

        if (opening) { el.open = true; }

        // Measured while open, so the target is the real laid-out height rather than a
        // guess. Padding and margin ride along with it, or a body that has either would
        // leave its spacing behind at zero height.
        var box = getComputedStyle(target);
        var end = {
          height: target.scrollHeight + 'px',
          marginBottom: box.marginBottom,
          paddingTop: box.paddingTop,
          paddingBottom: box.paddingBottom,
          opacity: 1,
        };
        var start = { height: '0px', marginBottom: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 };
        var frames = opening ? [start, end] : [end, start];

        target.style.overflow = 'hidden';

        var anim = target.animate(frames, { duration: DURATION, easing: 'ease' });

        anim.onfinish = anim.oncancel = function () {
          target.style.overflow = '';
          // Only now, so the body was on screen for the whole roll-up.
          if (!opening) { el.open = false; }
          el.removeAttribute('data-rolling');
        };
      });
    }

    ROLLS.forEach(function (kind) {
      document.querySelectorAll<HTMLElement>(kind.group).forEach(function (el) {
        // Every selector in ROLLS names a <details> except the two /api/ groups, which
        // are <details> too — the guard is here because the selectors are strings and
        // nothing else checks that the markup kept its element type.
        if (el instanceof HTMLDetailsElement) {
          roll(el, el.querySelector<HTMLElement>(kind.body));
        }
      });
    });
  })();

  // ---- Flux commercial-license lead form (imqueue.com /pricing/) ----
  (function () {
    var wrap = document.querySelector<HTMLElement>('[data-license-form]');
    if (!wrap) return;
    const panel = wrap;
    var form = panel.querySelector('form');
    if (!form) return;
    const formEl = form;
    var thanks = document.querySelector<HTMLElement>('[data-thanks]');
    var errEl = formEl.querySelector<HTMLElement>('[data-form-error]');
    var useTypeInput = formEl.querySelector<HTMLInputElement>('input[name="useType"]');
    var empInput = formEl.querySelector<HTMLInputElement>('input[name="developers"]');

    function showError(msg: string): void {
      if (!errEl) return;
      errEl.textContent = msg;
      errEl.hidden = !msg;
    }

    // Business / Personal toggle
    formEl.querySelectorAll('.fx-seg-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var type = btn.getAttribute('data-usetype') || '';
        if (useTypeInput) { useTypeInput.value = type; }
        formEl.querySelectorAll('.fx-seg-btn').forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', String(on));
        });
        formEl.querySelectorAll<HTMLElement>('[data-pane]').forEach(function (pane) {
          pane.hidden = pane.getAttribute('data-pane') !== type;
        });
        showError('');
      });
    });

    // Employee count (single-select)
    formEl.querySelectorAll('.fx-emp').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (empInput) { empInput.value = btn.getAttribute('data-emp') || ''; }
        formEl.querySelectorAll('.fx-emp').forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
      });
    });

    // Submit -> POST JSON to the contact function
    formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      showError('');

      // honeypot: if filled, pretend success and send nothing
      var honeypot = formEl.querySelector<HTMLInputElement>('input[name="company_url"]');

      if (honeypot && honeypot.value) {
        var card = formEl.closest<HTMLElement>('.fx-form-card');
        if (card) { card.hidden = true; }
        if (thanks) thanks.hidden = false;
        return;
      }

      var data: Record<string, string> = {};
      new FormData(formEl).forEach(function (v, k) {
        // A FormDataEntryValue is a string OR a File; this form has no file input, and
        // the check is what says so rather than a cast that would ship a "[object File]".
        if (typeof v === 'string') { data[k] = v; }
      });
      if (!data.name || !data.name.trim()) return showError('Please enter your name.');
      if (!data.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) return showError('Please enter a valid email.');
      if (data.useType === 'business' && (!data.company || !data.company.trim())) return showError('Please enter your company name.');
      data.page = location.href;

      var submitBtn = formEl.querySelector<HTMLButtonElement>('.fx-submit');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending…';
      }

      fetch(formEl.getAttribute('action') || '', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(data)
      }).then(function (res) {
        if (!res.ok) throw new Error('bad status ' + res.status);
        var card = formEl.closest<HTMLElement>('.fx-form-card');
        if (card) { card.hidden = true; }
        if (thanks) thanks.hidden = false;
      }).catch(function () {
        showError('Something went wrong sending your message. Please email support@imqueue.com directly.');
      }).finally(function () {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send →';
        }
      });
    });

    // "Send another"
    var again = thanks && thanks.querySelector('[data-send-another]');
    if (again && thanks) {
      const panelThanks = thanks;
      again.addEventListener('click', function () {
        formEl.reset();
        if (empInput) { empInput.value = ''; }
        formEl.querySelectorAll('.fx-emp').forEach(function (b) { b.classList.remove('active'); });
        panelThanks.hidden = true;
        panel.hidden = false;
      });
    }
  })();

  // ---- contact form (/contact/ on both editions) ----------------------------
  // Posts JSON to /api/message (functions/api/message.ts). Attachments are read here
  // and sent as base64, because a Pages Function receiving multipart/form-data would
  // have to parse it by hand for no gain — the payload is small and JSON keeps the
  // endpoint's validation identical to the licensing form's.
  (function () {
    var wrap = document.querySelector<HTMLElement>('[data-contact-form]');

    if (!wrap) { return; }

    const panel = wrap;
    var form = panel.querySelector('form');

    if (!form) { return; }

    const formEl = form;
    var thanks = document.querySelector<HTMLElement>('[data-thanks]');
    var errEl = formEl.querySelector<HTMLElement>('[data-form-error]');
    var fileInput = formEl.querySelector<HTMLInputElement>('input[type="file"]');
    var fileList = formEl.querySelector<HTMLElement>('[data-cf-files]');
    var submitBtn = formEl.querySelector<HTMLButtonElement>('.cf-submit');

    /** One attachment, in the shape functions/api/message.ts expects. */
    interface Attachment {
      filename: string;
      type: string;
      data: string;
    }

    // Kept in step with functions/api/message.ts on purpose: the client stops the
    // obvious mistakes early, the server refuses them regardless, because a forged
    // request never ran this code at all.
    var MAX_FILES = 3;
    var MAX_TOTAL = 5 * 1024 * 1024;
    var ALLOWED_EXT = /\.(png|jpe?g|gif|webp|txt|md|log|csv|json|pdf)$/i;

    function showError(msg: string): void {
      if (!errEl) { return; }
      errEl.textContent = msg || '';
      errEl.hidden = !msg;
    }

    function human(bytes: number): string {
      return bytes < 1024 ? bytes + ' B'
        : bytes < 1024 * 1024 ? Math.round(bytes / 1024) + ' KB'
        : (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    /** The chosen files, as an array. */
    function chosen(): File[] {
      return fileInput && fileInput.files ? Array.prototype.slice.call(fileInput.files) as File[] : [];
    }

    /* Show what is attached and total it up, so "too large" is visible before someone
       writes a long message and loses the submission to it. */
    function listFiles(): void {
      var files = chosen();

      if (!fileList) { return; }

      // `const`, so the loop body below — a closure — keeps the "not null" the guard
      // above just established.
      const list = fileList;

      list.innerHTML = '';
      list.hidden = !files.length;

      var total = 0;

      files.forEach(function (file) {
        total += file.size;

        var li = document.createElement('li');
        var name = document.createElement('span');
        var size = document.createElement('span');

        name.textContent = file.name;
        size.className = 'cf-size';
        size.textContent = human(file.size);
        li.appendChild(name);
        li.appendChild(size);
        list.appendChild(li);
      });

      if (files.length > MAX_FILES) {
        showError('Please attach no more than ' + MAX_FILES + ' files.');
      } else if (total > MAX_TOTAL) {
        showError('Attachments come to ' + human(total) + ' — 5 MB in total, please.');
      } else {
        showError('');
      }
    }

    if (fileInput) { fileInput.addEventListener('change', listFiles); }

    /** Read one File as bare base64 (no data: prefix, which the endpoint rejects). */
    function readFile(file: File): Promise<Attachment> {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();

        fr.onload = function () {
          var result = String(fr.result);
          var comma = result.indexOf(',');

          resolve({
            filename: file.name,
            type: file.type || 'application/octet-stream',
            data: comma >= 0 ? result.slice(comma + 1) : result
          });
        };
        fr.onerror = function () { reject(new Error('unreadable')); };
        fr.readAsDataURL(file);
      });
    }

    formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      showError('');

      // Honeypot: bots fill it, humans never see it. Pretend success, send nothing.
      var hp = formEl.querySelector<HTMLInputElement>('input[name="company_url"]');

      if (hp && hp.value) {
        panel.hidden = true;
        if (thanks) { thanks.hidden = false; }
        return;
      }

      var data: Record<string, unknown> = {};

      new FormData(formEl).forEach(function (v, k) {
        if (typeof v === 'string') { data[k] = v; }
      });

      var name = typeof data.name === 'string' ? data.name : '';
      var email = typeof data.email === 'string' ? data.email : '';
      var subject = typeof data.subject === 'string' ? data.subject : '';
      var message = typeof data.message === 'string' ? data.message : '';

      if (!name.trim()) { return showError('Please enter your name.'); }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return showError('Please enter a valid email address.');
      }
      if (!subject.trim()) { return showError('Please give the message a subject.'); }
      if (!message.trim()) { return showError('Please write a message.'); }

      var files = chosen();
      var total = 0;

      for (var i = 0; i < files.length; i++) {
        var file = files[i];

        if (!file) { continue; }

        total += file.size;

        if (!ALLOWED_EXT.test(file.name)) {
          return showError('“' + file.name + '” is not an accepted file type. Images, text files and PDFs only.');
        }
      }

      if (files.length > MAX_FILES) { return showError('Please attach no more than ' + MAX_FILES + ' files.'); }
      if (total > MAX_TOTAL) { return showError('Attachments come to ' + human(total) + ' — 5 MB in total, please.'); }

      data.page = location.href;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending…';
      }

      Promise.all(files.map(readFile)).then(function (attachments) {
        if (attachments.length) { data.attachments = attachments; }

        return fetch(formEl.getAttribute('action') || '', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(data)
        });
      }).then(function (res) {
        return res.json().catch(function (): unknown { return {}; }).then(function (parsed: unknown) {
          var body = (parsed && typeof parsed === 'object' ? parsed : {}) as { ok?: unknown; error?: unknown };

          if (!res.ok || body.ok !== true) {
            // The endpoint's own message is the useful one ("that file type", "too
            // large"); the generic line is only for when there isn't one.
            throw new Error(typeof body.error === 'string' ? body.error : '');
          }

          panel.hidden = true;
          if (thanks) { thanks.hidden = false; }
        });
      }).catch(function (err: unknown) {
        showError((err instanceof Error && err.message) ||
          'Something went wrong sending your message. Please email support@imqueue.com directly.');
      }).finally(function () {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send message →';
        }
      });
    });

    var again = thanks && thanks.querySelector('[data-send-another]');

    if (again && thanks) {
      const panelThanks = thanks;

      again.addEventListener('click', function () {
        formEl.reset();
        listFiles();
        showError('');
        panelThanks.hidden = true;
        panel.hidden = false;
        var first = formEl.querySelector<HTMLInputElement>('input[name="name"]');
        if (first) { first.focus(); }
      });
    }
  })();

  // ---- image lightbox: click a screenshot to view it full size ----
  (function () {
    var SEL = '.prose .shots img';
    var overlay: HTMLElement | null = null;
    var imgEl: HTMLImageElement | null = null;
    var capEl: HTMLElement | null = null;
    var lastFocus: Element | null = null;

    function build(): void {
      var box = document.createElement('div');
      box.className = 'lightbox';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.hidden = true;
      box.innerHTML =
        '<button class="lightbox__close" type="button" aria-label="Close">×</button>' +
        '<figure class="lightbox__fig">' +
        '<img class="lightbox__img" alt="">' +
        '<figcaption class="lightbox__cap"></figcaption>' +
        '</figure>';
      document.body.appendChild(box);
      overlay = box;
      imgEl = box.querySelector<HTMLImageElement>('.lightbox__img');
      capEl = box.querySelector<HTMLElement>('.lightbox__cap');
      // close on backdrop / close-button click; a click on the image itself keeps it open
      box.addEventListener('click', function (e) {
        if (e.target === box || (e.target instanceof Element && e.target.closest('.lightbox__close'))) close();
      });
    }

    function open(src: string, alt: string): void {
      if (!overlay) build();
      if (!overlay) return;
      lastFocus = document.activeElement;
      if (imgEl) {
        imgEl.src = src;
        imgEl.alt = alt || '';
      }
      if (capEl) {
        capEl.textContent = alt || '';
        capEl.hidden = !alt;
      }
      overlay.setAttribute('aria-label', alt || 'Screenshot');
      overlay.hidden = false;
      document.documentElement.classList.add('lightbox-open');
      var closeBtn = overlay.querySelector<HTMLElement>('.lightbox__close');
      if (closeBtn) { closeBtn.focus(); }
    }

    function close(): void {
      if (!overlay || overlay.hidden) return;
      overlay.hidden = true;
      if (imgEl) { imgEl.removeAttribute('src'); }
      document.documentElement.classList.remove('lightbox-open');
      if (lastFocus instanceof HTMLElement) lastFocus.focus();
    }

    document.addEventListener('click', function (e) {
      if (!(e.target instanceof Element)) { return; }
      var img = e.target.closest<HTMLImageElement>(SEL);
      if (img) { e.preventDefault(); open(img.currentSrc || img.src, img.alt); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  })();
})();
