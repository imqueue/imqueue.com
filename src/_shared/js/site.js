/* Shared client behavior for both editions: theme switcher + mobile nav.
   Theme is persisted per-origin in localStorage['imqueue-theme']; the .com and
   .org sites are separate origins, so each remembers its own theme (by design). */
(function () {
  var KEY = 'imqueue-theme';
  var root = document.documentElement;

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function currentMode() {
    var m = stored();
    return (m === 'light' || m === 'dark') ? m : 'system';
  }
  function apply(mode) {
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
  function reflect(mode) {
    document.querySelectorAll('[data-theme-set]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-theme-set') === mode));
    });
  }

  document.addEventListener('click', function (e) {
    var setBtn = e.target.closest('[data-theme-set]');
    if (setBtn) { apply(setBtn.getAttribute('data-theme-set')); return; }

    var burger = e.target.closest('[data-nav-toggle]');
    if (burger) {
      var drawer = document.querySelector('[data-mobile-nav]');
      if (drawer) { drawer.classList.toggle('open'); }
      return;
    }
    // close mobile nav when a link inside it is tapped
    var mlink = e.target.closest('[data-mobile-nav] a');
    if (mlink) {
      var d = document.querySelector('[data-mobile-nav]');
      if (d) { d.classList.remove('open'); }
    }
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
    }

    // Scroll-spy: highlight the section currently in view (like the tutorial's
    // active chapter).
    var links = [].slice.call(layout.querySelectorAll('.doc-toc a[href^="#"]'));
    var targets = links.map(function (a) {
      // markdown-it-anchor runs the slug through encodeURIComponent and writes
      // the RESULT into the id attribute, so a heading like "Data & events"
      // really is id="data-%26-events". Look the raw fragment up first;
      // decoding it would ask for "data-&-events" and find nothing, and a
      // dropped target silently leaves the previous item highlighted while
      // that section is on screen. The decoded form stays as a fallback for a
      // hand-written id holding a literal non-ASCII character.
      var frag = a.getAttribute('href').slice(1);
      var el = document.getElementById(frag);
      if (!el) {
        try { el = document.getElementById(decodeURIComponent(frag)); } catch (e) {}
      }
      return el ? { a: a, el: el } : null;
    }).filter(Boolean);
    if (!targets.length) return;

    function sync() {
      var current = targets[0];
      for (var i = 0; i < targets.length; i++) {
        if (targets[i].el.getBoundingClientRect().top - 140 <= 0) current = targets[i];
        else break;
      }
      links.forEach(function (a) { a.classList.remove('active'); });
      current.a.classList.add('active');
    }
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync, { passive: true });
    sync();
  })();

  // ---- Flux commercial-license lead form (imqueue.com /pricing/) ----
  (function () {
    var wrap = document.querySelector('[data-license-form]');
    if (!wrap) return;
    var form = wrap.querySelector('form');
    var thanks = document.querySelector('[data-thanks]');
    var errEl = form.querySelector('[data-form-error]');
    var useTypeInput = form.querySelector('input[name="useType"]');
    var empInput = form.querySelector('input[name="developers"]');

    function showError(msg) {
      if (!errEl) return;
      errEl.textContent = msg;
      errEl.hidden = !msg;
    }

    // Business / Personal toggle
    form.querySelectorAll('.fx-seg-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var type = btn.getAttribute('data-usetype');
        useTypeInput.value = type;
        form.querySelectorAll('.fx-seg-btn').forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('active', on);
          b.setAttribute('aria-pressed', String(on));
        });
        form.querySelectorAll('[data-pane]').forEach(function (pane) {
          pane.hidden = pane.getAttribute('data-pane') !== type;
        });
        showError('');
      });
    });

    // Employee count (single-select)
    form.querySelectorAll('.fx-emp').forEach(function (btn) {
      btn.addEventListener('click', function () {
        empInput.value = btn.getAttribute('data-emp');
        form.querySelectorAll('.fx-emp').forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
      });
    });

    // Submit -> POST JSON to the contact function
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      showError('');

      // honeypot: if filled, pretend success and send nothing
      if (form.querySelector('input[name="company_url"]').value) {
        form.closest('.fx-form-card').hidden = true;
        if (thanks) thanks.hidden = false;
        return;
      }

      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = v; });
      if (!data.name || !data.name.trim()) return showError('Please enter your name.');
      if (!data.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) return showError('Please enter a valid email.');
      if (data.useType === 'business' && (!data.company || !data.company.trim())) return showError('Please enter your company name.');
      data.page = location.href;

      var submitBtn = form.querySelector('.fx-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';

      fetch(form.getAttribute('action'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(data)
      }).then(function (res) {
        if (!res.ok) throw new Error('bad status ' + res.status);
        form.closest('.fx-form-card').hidden = true;
        if (thanks) thanks.hidden = false;
      }).catch(function () {
        showError('Something went wrong sending your message. Please email support@imqueue.com directly.');
      }).finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send →';
      });
    });

    // "Send another"
    var again = thanks && thanks.querySelector('[data-send-another]');
    if (again) {
      again.addEventListener('click', function () {
        form.reset();
        empInput.value = '';
        form.querySelectorAll('.fx-emp').forEach(function (b) { b.classList.remove('active'); });
        thanks.hidden = true;
        wrap.hidden = false;
      });
    }
  })();

  // ---- contact form (/contact/ on both editions) ----------------------------
  // Posts JSON to /api/message (functions/api/message.js). Attachments are read here
  // and sent as base64, because a Pages Function receiving multipart/form-data would
  // have to parse it by hand for no gain — the payload is small and JSON keeps the
  // endpoint's validation identical to the licensing form's.
  (function () {
    var wrap = document.querySelector('[data-contact-form]');

    if (!wrap) { return; }

    var form = wrap.querySelector('form');
    var thanks = document.querySelector('[data-thanks]');
    var errEl = form.querySelector('[data-form-error]');
    var fileInput = form.querySelector('input[type="file"]');
    var fileList = form.querySelector('[data-cf-files]');
    var submitBtn = form.querySelector('.cf-submit');

    // Kept in step with functions/api/message.js on purpose: the client stops the
    // obvious mistakes early, the server refuses them regardless, because a forged
    // request never ran this code at all.
    var MAX_FILES = 3;
    var MAX_TOTAL = 5 * 1024 * 1024;
    var ALLOWED_EXT = /\.(png|jpe?g|gif|webp|txt|md|log|csv|json|pdf)$/i;

    function showError(msg) {
      errEl.textContent = msg || '';
      errEl.hidden = !msg;
    }

    function human(bytes) {
      return bytes < 1024 ? bytes + ' B'
        : bytes < 1024 * 1024 ? Math.round(bytes / 1024) + ' KB'
        : (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    /* Show what is attached and total it up, so "too large" is visible before someone
       writes a long message and loses the submission to it. */
    function listFiles() {
      var files = fileInput && fileInput.files ? fileInput.files : [];

      fileList.innerHTML = '';
      fileList.hidden = !files.length;

      var total = 0;

      for (var i = 0; i < files.length; i++) {
        total += files[i].size;

        var li = document.createElement('li');
        var name = document.createElement('span');
        var size = document.createElement('span');

        name.textContent = files[i].name;
        size.className = 'cf-size';
        size.textContent = human(files[i].size);
        li.appendChild(name);
        li.appendChild(size);
        fileList.appendChild(li);
      }

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
    function readFile(file) {
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

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      showError('');

      // Honeypot: bots fill it, humans never see it. Pretend success, send nothing.
      var hp = form.querySelector('input[name="company_url"]');

      if (hp && hp.value) {
        wrap.hidden = true;
        if (thanks) { thanks.hidden = false; }
        return;
      }

      var data = {};

      new FormData(form).forEach(function (v, k) {
        if (typeof v === 'string') { data[k] = v; }
      });

      if (!data.name || !data.name.trim()) { return showError('Please enter your name.'); }
      if (!data.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
        return showError('Please enter a valid email address.');
      }
      if (!data.subject || !data.subject.trim()) { return showError('Please give the message a subject.'); }
      if (!data.message || !data.message.trim()) { return showError('Please write a message.'); }

      var files = fileInput && fileInput.files ? [].slice.call(fileInput.files) : [];
      var total = 0;

      for (var i = 0; i < files.length; i++) {
        total += files[i].size;

        if (!ALLOWED_EXT.test(files[i].name)) {
          return showError('\u201C' + files[i].name + '\u201D is not an accepted file type. Images, text files and PDFs only.');
        }
      }

      if (files.length > MAX_FILES) { return showError('Please attach no more than ' + MAX_FILES + ' files.'); }
      if (total > MAX_TOTAL) { return showError('Attachments come to ' + human(total) + ' — 5 MB in total, please.'); }

      data.page = location.href;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';

      Promise.all(files.map(readFile)).then(function (attachments) {
        if (attachments.length) { data.attachments = attachments; }

        return fetch(form.getAttribute('action'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(data)
        });
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok || body.ok !== true) {
            // The endpoint's own message is the useful one ("that file type", "too
            // large"); the generic line is only for when there isn't one.
            throw new Error(body.error || '');
          }

          wrap.hidden = true;
          if (thanks) { thanks.hidden = false; }
        });
      }).catch(function (err) {
        showError((err && err.message) ||
          'Something went wrong sending your message. Please email support@imqueue.com directly.');
      }).finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send message \u2192';
      });
    });

    var again = thanks && thanks.querySelector('[data-send-another]');

    if (again) {
      again.addEventListener('click', function () {
        form.reset();
        listFiles();
        showError('');
        thanks.hidden = true;
        wrap.hidden = false;
        form.querySelector('input[name="name"]').focus();
      });
    }
  })();

  // ---- image lightbox: click a screenshot to view it full size ----
  (function () {
    var SEL = '.prose .shots img';
    var overlay, imgEl, capEl, lastFocus;

    function build() {
      overlay = document.createElement('div');
      overlay.className = 'lightbox';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.hidden = true;
      overlay.innerHTML =
        '<button class="lightbox__close" type="button" aria-label="Close">×</button>' +
        '<figure class="lightbox__fig">' +
        '<img class="lightbox__img" alt="">' +
        '<figcaption class="lightbox__cap"></figcaption>' +
        '</figure>';
      document.body.appendChild(overlay);
      imgEl = overlay.querySelector('.lightbox__img');
      capEl = overlay.querySelector('.lightbox__cap');
      // close on backdrop / close-button click; a click on the image itself keeps it open
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay || e.target.closest('.lightbox__close')) close();
      });
    }

    function open(src, alt) {
      if (!overlay) build();
      lastFocus = document.activeElement;
      imgEl.src = src;
      imgEl.alt = alt || '';
      capEl.textContent = alt || '';
      capEl.hidden = !alt;
      overlay.setAttribute('aria-label', alt || 'Screenshot');
      overlay.hidden = false;
      document.documentElement.classList.add('lightbox-open');
      overlay.querySelector('.lightbox__close').focus();
    }

    function close() {
      if (!overlay || overlay.hidden) return;
      overlay.hidden = true;
      imgEl.removeAttribute('src');
      document.documentElement.classList.remove('lightbox-open');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    document.addEventListener('click', function (e) {
      var img = e.target.closest(SEL);
      if (img) { e.preventDefault(); open(img.currentSrc || img.src, img.alt); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  })();
})();
