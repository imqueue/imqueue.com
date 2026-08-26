// The seam between the ranker's two halves, asserted.
//
// vendor/search-ranker/ is one submodule and two files: ranker.js is a portable scoring engine
// with no DOM in it, and search.js is imqueue's browser UI, which reads the engine off
// `window.SearchRanker`. The site serves them concatenated (scripts/lib/asset-manifest.ts).
//
// WHY THIS FILE EXISTS. Before the split, a name used by the dialog and defined by the scorer was
// one closure away and could not be wrong. Now it crosses a published object, and every way of
// getting that wrong fails at RUNTIME IN A BROWSER, on the third keystroke, with the rest of the
// site working perfectly:
//
//   * the engine stops exporting a name the UI reads          -> `undefined is not a function`
//   * the UI reads a name the engine never had                -> the same, and it never had it
//   * a `document` reference lands in the engine              -> @imqueue/mcp throws on require
//   * the UI references a name nothing declares or imports    -> ReferenceError
//
// None of that is visible to check-search-ranking.ts, which requires the engine alone and never
// evaluates a line of the UI, nor to check-search-ui.ts, which greps the UI as text. Both would
// pass a build whose search box is dead.
//
// Read as TEXT rather than evaluated, for the reason check-search-ui.ts gives: the interesting
// declarations never leave the IIFE, so there is nothing to introspect. That makes the analysis
// below approximate by construction — it is a tokenizer, not a parser — so every rule here is
// written to fail only on something that is genuinely wrong, and the allowlist absorbs the rest.

import fs from 'node:fs';

import { ENGINE_FILE, ENGINE_REL, UI_FILE, UI_REL, MISSING, exists } from './lib/ranker.ts';

let failures = 0;

const pass = (message: string): void => console.log(`  ok   ${message}`);

const fail = (message: string): void => {
  console.error(`  FAIL ${message}`);
  failures++;
};

if (!exists()) {
  console.error(MISSING);
  process.exit(1);
}

const engineSrc = fs.readFileSync(ENGINE_FILE, 'utf8');
const uiSrc = fs.readFileSync(UI_FILE, 'utf8');

/**
 * Source with comments and string bodies blanked, so a name in prose is not a reference.
 *
 * The order is load-bearing and cost a debugging session when it was wrong: block comments first
 * because only they span lines, then line comments, and strings last — a `//` comment full of
 * prose apostrophes otherwise reaches the string pass, where its quote pairs with one hundreds of
 * lines later and blanks every declaration in between. The classes exclude newlines for the same
 * reason.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    // Regex literals, which hold identifier-shaped text that is not an identifier:
    // /^(?:INPUT|TEXTAREA|SELECT)$/ reported three undefined names. Only in a position where a
    // regex can start, and only when no space follows the slash, so `length / 3` stays division.
    //
    // BEFORE the line-comment pass, and that order is not cosmetic. `/^https?:\/\//` ends in the
    // two characters `//`, so a line-comment pass that runs first treats the rest of the line as
    // a comment and deletes it — which is how `https` came to be reported as an undefined name,
    // and it silently removed real code from the analysis on every line with a URL regex in it.
    .replace(/([(,=:[!&|?+\-*%\s]|^)\/(?![*/\s])(?:[^/\\\n[]|\\.|\[[^\]\n]*\])+\/[gimsuy]*/g, '$1 0 ')
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/\/\/[^\n]*/g, '')
    // Object-literal KEYS, which are not references to anything: `{ credentials: "omit" }` and
    // GA4's `{ search_term: …, result_url: … }` accounted for eight of the first run's fifteen
    // false positives. Anchored to `{`, `,` or a line start so that a ternary's `? a : b` — where
    // `a` is a real reference that also happens to precede a colon — is left alone.
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1_key$3')
    .replace(/(\n\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1_key$3');
}

/** Identifiers referenced, ignoring property access: `q.terms` is not a use of `terms`. */
function referenced(source: string): Set<string> {
  const out = new Set<string>();

  for (const m of code(source).matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)\b/g)) out.add(m[2] ?? '');

  return out;
}

/** Every name bound anywhere in a file: declarations, locals, parameters, catch bindings. */
function bound(source: string): Set<string> {
  const text = code(source);
  const out = new Set<string>();

  for (const m of text.matchAll(/\b(?:var|let|const|function)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1] ?? '');
  for (const m of text.matchAll(/\bfunction\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g)) {
    for (const p of (m[1] ?? '').split(',')) if (p.trim()) out.add(p.trim());
  }
  for (const m of text.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) out.add(m[1] ?? '');

  return out;
}

// ---- the engine's export surface --------------------------------------------

// `var API = { name: name, ... }` — matched rather than evaluated, because requiring the engine
// here would prove only that Node's branch works and this check is about the browser's.
const apiBlock = /var API = \{([\s\S]*?)\n {2}\};/.exec(engineSrc);

if (!apiBlock) {
  fail(`${ENGINE_REL}: no \`var API = {...}\` block — nothing is exported to either environment`);
  process.exit(1);
}

const EXPORTED = new Set<string>(
  [...(apiBlock[1] ?? '').matchAll(/^\s*([A-Za-z_$][\w$]*):/gm)].map((m) => m[1] ?? ''),
);

pass(`${ENGINE_REL}: exports ${EXPORTED.size} names`);

// The contract @imqueue/mcp compiles against (src/search-ranker.d.cts there). It is asserted
// separately from what the UI needs because the two lists are not the same and nothing else says
// so: `FEED_V` is read by the MCP server to check the feed shape and by no browser code at all,
// so a surface derived from the UI alone would drop it and the server would assert `undefined`.
const NODE_CONTRACT = ['parseQuery', 'prepare', 'prepareSections', 'search', 'groupKey', 'state', 'FEED_V'];

for (const name of NODE_CONTRACT) {
  if (!EXPORTED.has(name)) {
    fail(`${ENGINE_REL}: \`${name}\` is not exported — @imqueue/mcp's src/search-ranker.d.cts `
      + 'declares it, and TypeScript cannot catch a lie in a hand-written .d.cts');
  }
}

if (NODE_CONTRACT.every((name) => EXPORTED.has(name))) {
  pass(`${ENGINE_REL}: the ${NODE_CONTRACT.length} names @imqueue/mcp declares are all exported`);
}

// ---- the engine stays portable ----------------------------------------------

const engineCode = code(engineSrc);

// `document` is the discriminator: it appears nowhere in a scoring engine, and its arrival is how
// the UI creeps back in. @imqueue/mcp requires this file in a Cloudflare Worker, where it would
// throw at load — which is a deploy failure, not a test failure.
const documentUse = engineCode.match(/\bdocument\b/g);

if (documentUse) {
  fail(`${ENGINE_REL}: references \`document\` ${documentUse.length}x — the engine runs in a `
    + 'Cloudflare Worker, where that throws at load. Whatever needs a DOM belongs in search.js');
} else {
  pass(`${ENGINE_REL}: no \`document\` — still loadable outside a browser`);
}

// `fetch` for the same reason one step further out: an engine that fetches has decided WHERE the
// corpus lives, which is the assumption that stopped this file being reusable in the first place.
// The caller hands it feeds; imqueue's URLs for them are search.js's business.
if (/\bfetch\s*\(/.test(engineCode)) {
  fail(`${ENGINE_REL}: calls \`fetch\` — the engine is given its feeds, it does not go and get `
    + 'them. Feed URLs belong in search.js (TIER1/TIER2/PEER1/PEER2)');
} else {
  pass(`${ENGINE_REL}: fetches nothing — the caller supplies the corpus`);
}

// The browser half of the export, which is the half with no test coverage anywhere else: Node
// takes the `module.exports` branch, so an edit that broke only the global assignment would pass
// every other check in this repo and ship a dead search box.
if (!/window\.SearchRanker = API;/.test(engineSrc)) {
  fail(`${ENGINE_REL}: does not assign \`window.SearchRanker\` — Node would still work and the `
    + 'browser would not, which is the one failure no other check here can see');
} else {
  pass(`${ENGINE_REL}: publishes window.SearchRanker for the browser`);
}

// ---- the UI reads only what the engine exports ------------------------------

// Every `R.name`, where `R` is the local the UI binds the engine to.
if (!/var R = window\.SearchRanker;/.test(uiSrc)) {
  fail(`${UI_REL}: does not read \`window.SearchRanker\` — the two halves are not connected`);
}

const readFromEngine = new Set<string>(
  [...code(uiSrc).matchAll(/\bR\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1] ?? ''),
);
const missingFromApi = [...readFromEngine].filter((name) => !EXPORTED.has(name)).sort();

if (missingFromApi.length) {
  fail(`${UI_REL}: reads ${missingFromApi.map((n) => `R.${n}`).join(', ')} from the engine, which `
    + `does not export ${missingFromApi.length === 1 ? 'it' : 'them'}`);
} else {
  pass(`${UI_REL}: all ${readFromEngine.size} names it takes from the engine are exported`);
}

// ---- and nothing in the UI is simply undefined ------------------------------

// Browser and language globals the UI legitimately reaches for. Curated rather than inferred:
// this list is the price of a tokenizer instead of a parser, and a name added here should be a
// real global, not a way to silence the check.
const GLOBALS = new Set([
  // language
  'Array', 'Boolean', 'Date', 'Error', 'Infinity', 'JSON', 'Math', 'NaN', 'Number', 'Object',
  'Promise', 'RegExp', 'String', 'Set', 'Map', 'arguments', 'this', 'undefined', 'null', 'true',
  'false', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'return', 'if', 'else',
  'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'function', 'var',
  'let', 'const', 'try', 'catch', 'finally', 'throw', 'class', 'extends', 'super', 'yield',
  'await', 'async', 'static', 'get', 'set',
  // browser
  'document', 'window', 'location', 'history', 'navigator', 'localStorage', 'sessionStorage',
  'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'matchMedia', 'CustomEvent', 'Event', 'URL', 'URLSearchParams', 'AbortController', 'Node',
  'HTMLElement', 'DocumentFragment', 'IntersectionObserver', 'MutationObserver', 'console',
  'gtag', 'dataLayer', 'module', 'require', 'process', 'globalThis',
  'encodeURIComponent', 'decodeURIComponent', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  // The placeholder `code()` leaves where an object key was.
  '_key',
]);

const uiBound = bound(uiSrc);
const dangling = [...referenced(uiSrc)]
  .filter((name) => !uiBound.has(name) && !GLOBALS.has(name) && !EXPORTED.has(name))
  .sort();

if (dangling.length) {
  fail(`${UI_REL}: ${dangling.length} name(s) are neither declared here, imported from the `
    + `engine, nor a known global: ${dangling.join(' ')}`);
} else {
  pass(`${UI_REL}: every name it uses is declared, imported or a browser global`);
}

// ---- report -----------------------------------------------------------------

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}

console.log('\nsearch-ranker: the engine/UI seam holds.');
