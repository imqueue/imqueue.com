/* Cookie consent for both editions, per purpose.
 *
 * GDPR/ePrivacy asks for consent BEFORE non-essential storage happens, not after, so
 * the tags are not merely hidden here — they never run. head.html parks each one as
 * `<script type="text/plain" data-consent="<category>">`, which no browser executes,
 * and this file converts only the categories someone has actually ticked. A visitor
 * who ignores the bar, blocks JavaScript, or never returns is never measured, which
 * is the only default that makes "blocked unless accepted" true rather than a claim.
 *
 * TWO categories, not one bundle:
 *   analytics — aggregate page-view counting (Google Analytics)
 *   replay    — a recording of clicks, scrolling and pointer movement (MS Clarity)
 * Consent has to be specific to a purpose, and these are two purposes: one counts
 * visits, the other records behaviour. Ticking the first must not start the second.
 *
 * CCPA/CPRA is opt-out rather than opt-in, and its "do not sell or share" right has
 * nothing to sell against here — no data is sold, shared for cross-context
 * advertising, or profiled. Decline all is the opt-out, the footer link keeps it
 * reachable from every page forever, and no choice changes what the site serves.
 *
 * The decision is JSON in localStorage, not a cookie: recording "no cookies please"
 * in a cookie is defensible under the strictly-necessary exemption and still absurd,
 * and this way a declining visit leaves the site with no cookies at all. Per-origin,
 * like the theme in site.js — .org and .com each ask once.
 */
(function () {
  var KEY = 'imqueue-consent';
  var CATS = ['analytics', 'replay'];

  /* Which first-party cookies each category is answerable for, so withdrawing one
     does not clear the other's. Clarity also sets cookies on its own domain, which no
     script of ours can reach — /privacy/ says so and points at the browser controls
     that can. */
  var COOKIES = {
    analytics: /^(_ga|_gid|_gat)/,
    replay: /^(_clck|_clsk|CLID|MUID|ANONCHK|SM|SRM_B)/
  };

  var root = document.documentElement;

  /** Stored decision as { analytics: bool, replay: bool }, or null if never asked. */
  function read() {
    var raw;

    try { raw = localStorage.getItem(KEY); } catch (e) { return null; }

    if (!raw) { return null; }

    // Migrates the single-toggle values this used to store, so an early visitor is
    // not asked again: one "yes" covered both purposes back then.
    if (raw === 'granted') { return { analytics: true, replay: true }; }
    if (raw === 'denied') { return { analytics: false, replay: false }; }

    try {
      var parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== 'object') { return null; }

      return { analytics: parsed.analytics === true, replay: parsed.replay === true };
    } catch (e) {
      return null; // unparseable: ask again rather than assume anything
    }
  }

  function write(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  /* Replace the parked tags of the given categories with executable ones, in document
     order — gtag.js carries `data-src` and must still be requested before the inline
     snippet that configures it, which is the order they appear in head.html. */
  function activate(cats) {
    for (var c = 0; c < cats.length; c++) {
      var parked = document.querySelectorAll(
        'script[type="text/plain"][data-consent="' + cats[c] + '"]'
      );

      for (var i = 0; i < parked.length; i++) {
        var old = parked[i];
        var live = document.createElement('script');
        var src = old.getAttribute('data-src');

        if (src) {
          live.async = true;
          live.src = src;
        } else {
          live.text = old.textContent;
        }

        old.parentNode.replaceChild(live, old);
      }
    }
  }

  /** Expire the first-party cookies belonging to one category. Best effort. */
  function clearCookies(cat) {
    var pattern = COOKIES[cat];

    if (!pattern) { return; }

    var host = location.hostname;
    var domains = ['', host, '.' + host];
    var parts = host.split('.');

    if (parts.length > 2) { domains.push('.' + parts.slice(-2).join('.')); }

    var jar = document.cookie ? document.cookie.split(';') : [];

    for (var i = 0; i < jar.length; i++) {
      var name = jar[i].split('=')[0].replace(/^\s+|\s+$/g, '');

      if (!pattern.test(name)) { continue; }

      for (var d = 0; d < domains.length; d++) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' +
          (domains[d] ? '; domain=' + domains[d] : '');
      }
    }
  }

  function banner() { return document.querySelector('[data-consent-banner]'); }

  function boxes() { return document.querySelectorAll('[data-consent-cat]'); }

  /** Put the stored (or empty) decision into the checkboxes. */
  function reflect(state) {
    var all = boxes();

    for (var i = 0; i < all.length; i++) {
      var cat = all[i].getAttribute('data-consent-cat');

      all[i].checked = !!(state && state[cat]);
    }
  }

  function panel() { return document.getElementById('cc-panel'); }

  function expand(open) {
    var p = panel();
    var toggle = document.querySelector('[data-consent-toggle]');

    if (p) { p.hidden = !open; }
    if (toggle) { toggle.setAttribute('aria-expanded', String(!!open)); }
  }

  function show(moveFocus) {
    var el = banner();

    if (!el) { return; }

    var state = read();

    reflect(state);

    // Open the granular panel unprompted only when the stored decision is a MIX: the
    // one-line summary row can say "allowed" or "declined", but it cannot show that
    // one purpose is on and the other off, and hiding that from someone who came back
    // to check would misrepresent what is running.
    var mixed = !!state && CATS.length > 1 &&
      CATS.some(function (c) { return state[c]; }) &&
      CATS.some(function (c) { return !state[c]; });

    expand(mixed);

    el.hidden = false;
    root.classList.add('cc-open');

    // Only when the visitor asked for it from the footer. Stealing focus from someone
    // who just opened a page to read it would be its own annoyance.
    if (moveFocus) {
      var first = el.querySelector(mixed ? '[data-consent-cat]' : '[data-consent-action]');

      if (first) { first.focus(); }
    }
  }

  function hide() {
    var el = banner();

    if (el) { el.hidden = true; }

    root.classList.remove('cc-open');
  }

  /** Read the checkboxes into a decision object. */
  function fromBoxes() {
    var state = {};
    var all = boxes();

    for (var i = 0; i < all.length; i++) {
      state[all[i].getAttribute('data-consent-cat')] = all[i].checked;
    }

    // Any category with no checkbox on the page (an edition without that vendor
    // configured) counts as not granted rather than undefined.
    for (var c = 0; c < CATS.length; c++) {
      if (state[CATS[c]] !== true) { state[CATS[c]] = false; }
    }

    return state;
  }

  function apply(next) {
    var previous = read() || { analytics: false, replay: false };

    write(next);
    hide();

    var grant = [];
    var withdrawn = false;

    for (var i = 0; i < CATS.length; i++) {
      var cat = CATS[i];

      if (next[cat] && !previous[cat]) {
        grant.push(cat); // still parked, so this is all it takes
      } else if (!next[cat]) {
        clearCookies(cat);

        // Withdrawing a consent that was already acted on is the one case needing a
        // reload: the vendor's script is live in this document and neither of them
        // offers a reliable way to unload itself.
        if (previous[cat]) { withdrawn = true; }
      }
    }

    if (withdrawn) {
      location.reload();
      return;
    }

    if (grant.length) { activate(grant); }
  }

  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) { return; }

    var toggle = e.target.closest('[data-consent-toggle]');

    if (toggle) {
      e.preventDefault();
      expand(toggle.getAttribute('aria-expanded') !== 'true');
      return;
    }

    var action = e.target.closest('[data-consent-action]');

    if (action) {
      e.preventDefault();

      var which = action.getAttribute('data-consent-action');

      if (which === 'accept') {
        apply({ analytics: true, replay: true });
      } else if (which === 'decline') {
        apply({ analytics: false, replay: false });
      } else {
        apply(fromBoxes());
      }

      return;
    }

    // The footer link. Its href points at /privacy/#cookies… so that it still goes
    // somewhere useful when this script has not run.
    var recall = e.target.closest('[data-consent-open]');

    if (recall) {
      e.preventDefault();
      show(true);
    }
  });

  var stored = read();

  if (!stored) {
    show(false);
  } else {
    var granted = [];

    for (var i = 0; i < CATS.length; i++) {
      if (stored[CATS[i]]) { granted.push(CATS[i]); }
    }

    if (granted.length) { activate(granted); }
  }
})();
