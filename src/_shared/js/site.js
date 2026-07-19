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
      var el = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)));
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
    var empInput = form.querySelector('input[name="employees"]');

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
})();
