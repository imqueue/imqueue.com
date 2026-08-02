/* Cookie consent for both editions.
 *
 * GDPR/ePrivacy asks for consent BEFORE non-essential storage happens, not after,
 * so the analytics tags are not merely hidden here — they never run. head.html
 * parks them as `<script type="text/plain" data-consent="analytics">`, which the
 * browser refuses to execute, and this file turns them into real scripts only once
 * someone has said yes. A visitor who ignores the banner, blocks JavaScript, or
 * never returns is therefore never measured, which is the only default that makes
 * "cookies are blocked unless accepted" true rather than aspirational.
 *
 * CCPA/CPRA is opt-out rather than opt-in, and its "do not sell or share" right has
 * nothing to sell against here — no data is sold, shared for cross-context
 * advertising, or used for profiling. The Decline button is the opt-out, the footer
 * link makes it reachable from every page forever, and neither choice changes what
 * the site serves you (no "pay or consent", no nagging, no degradation).
 *
 * The decision lives in localStorage, not in a cookie: writing a cookie to record
 * "no cookies please" is defensible under the strictly-necessary exemption but
 * needlessly ironic, and localStorage keeps the pre-consent page cookie-free.
 * Per-origin, like the theme in site.js — .org and .com each ask once.
 */
(function () {
  var KEY = 'imqueue-consent';
  var GRANTED = 'granted';
  var DENIED = 'denied';
  var PARKED = 'script[type="text/plain"][data-consent="analytics"]';

  var root = document.documentElement;

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function remember(value) {
    try { localStorage.setItem(KEY, value); } catch (e) {}
  }

  /* Replace each parked tag with an executable one, in document order — gtag.js
     carries `data-src` and must still be requested before the inline snippet that
     configures it, which is exactly the order they appear in head.html. */
  function activate() {
    var parked = document.querySelectorAll(PARKED);

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

  /* Best-effort cleanup when someone declines after having accepted.
   *
   * Only first-party cookies can be expired from here: Clarity also sets cookies on
   * its own domain, which no script of ours can reach — /privacy/ says so and points
   * at the browser controls that can. Every candidate domain is tried because a
   * cookie set for ".imqueue.org" is not removable with a host-only Set-Cookie. */
  function clearAnalyticsCookies() {
    var host = location.hostname;
    var domains = ['', host, '.' + host];
    var parts = host.split('.');

    if (parts.length > 2) {
      domains.push('.' + parts.slice(-2).join('.'));
    }

    var jar = document.cookie ? document.cookie.split(';') : [];

    for (var i = 0; i < jar.length; i++) {
      var name = jar[i].split('=')[0].replace(/^\s+|\s+$/g, '');

      // GA: _ga, _ga_<id>, _gid, _gat*.  Clarity: _clck, _clsk, CLID, plus the
      // Microsoft-network cookies its tag can set.
      if (!/^(_ga|_gid|_gat|_clck|_clsk|CLID|MUID|ANONCHK|SM|SRM_B)/.test(name)) {
        continue;
      }

      for (var d = 0; d < domains.length; d++) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' +
          (domains[d] ? '; domain=' + domains[d] : '');
      }
    }
  }

  function banner() {
    return document.querySelector('[data-consent-banner]');
  }

  function show(moveFocus) {
    var el = banner();

    if (!el) { return; }

    el.hidden = false;
    root.classList.add('cc-open');

    // Only when the visitor asked for it from the footer. Stealing focus from
    // someone who just opened a page to read it would be its own annoyance.
    if (moveFocus) {
      var first = el.querySelector('[data-consent-set]');

      if (first) { first.focus(); }
    }
  }

  function hide() {
    var el = banner();

    if (el) { el.hidden = true; }

    root.classList.remove('cc-open');
  }

  function decide(value) {
    var previous = stored();

    remember(value);
    hide();

    if (value === GRANTED) {
      // Nothing was ever executed under a previous DENIED, so the parked tags are
      // still parked and this is all it takes — no reload.
      activate();
      return;
    }

    clearAnalyticsCookies();

    // Withdrawing a consent that was already acted on is the one case needing a
    // reload: gtag and Clarity are live in this document and neither offers a
    // reliable way to unload itself.
    if (previous === GRANTED) { location.reload(); }
  }

  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) { return; }

    var choice = e.target.closest('[data-consent-set]');

    if (choice) {
      e.preventDefault();
      decide(choice.getAttribute('data-consent-set') === GRANTED ? GRANTED : DENIED);
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

  var decision = stored();

  if (decision === GRANTED) {
    activate();
  } else if (decision !== DENIED) {
    show(false);
  }
})();
