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
})();
