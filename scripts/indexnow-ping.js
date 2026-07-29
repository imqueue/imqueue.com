#!/usr/bin/env node
/*
 * IndexNow ping — submit this edition's URLs for instant (re)indexing on the
 * IndexNow network (Bing, Yandex, Seznam, and others share one endpoint).
 *
 * Run AFTER a deploy, once the new content is actually live — pinging URLs that
 * aren't yet reachable just wastes the submission.
 *
 *   node scripts/indexnow-ping.js com                 # submit every URL in _site-com/sitemap.xml
 *   node scripts/indexnow-ping.js org                 # same for the .org edition
 *   node scripts/indexnow-ping.js com /license/ /support/   # submit only specific paths
 *   node scripts/indexnow-ping.js org --exclude=/api/ # skip URLs whose path contains /api/
 *   node scripts/indexnow-ping.js com --dry-run       # print what would be sent, submit nothing
 *   node scripts/indexnow-ping.js org --print-urls    # resolved URL set, one per line
 *   node scripts/indexnow-ping.js org --print-urls --live  # same, from the deployed site
 *
 * .org publishes a sitemap INDEX, so both readers expand it one level to page
 * URLs; --print-urls exists so CI can diff the built set against the live one
 * using this same expansion instead of reimplementing it in shell.
 *
 * --exclude=<substr> may be repeated; any URL containing one of the substrings
 * is dropped (how many were dropped is logged, never silently). The bundled
 * `npm run indexnow:org` excludes /api/ so pings stay on high-value pages.
 *
 * The key file must already be live at https://<host>/<key>.txt (emitted by
 * src/indexnow.liquid). IndexNow verifies it before accepting the URL list.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const HOSTS = { com: 'imqueue.com', org: 'imqueue.org' };
const ENDPOINT = 'https://api.indexnow.org/indexnow';

function readKey() {
    const yml = fs.readFileSync(
        path.join(__dirname, '..', 'src', '_data', 'site.yml'),
        'utf8',
    );
    const m = yml.match(/^indexnow_key:\s*([A-Za-z0-9-]+)\s*$/m);
    if (!m) {
        throw new Error('indexnow_key not found in src/_data/site.yml');
    }
    return m[1];
}

const locsIn = xml => [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(m => m[1]);
const isIndex = xml => xml.includes('<sitemapindex');

// .org's /sitemap.xml is a sitemap INDEX, so its <loc> entries are child sitemaps,
// not pages. Expand one level so callers always get page URLs — submitting the
// index's own children to IndexNow would have pinged three XML files and no pages.
function readLocal(edition, name) {
    const file = path.join(__dirname, '..', `_site-${edition}`, name);
    if (!fs.existsSync(file)) {
        throw new Error(
            `${file} not found — build the ${edition} edition first ` +
                `(EDITION=${edition} npm run build).`,
        );
    }
    return fs.readFileSync(file, 'utf8');
}

function urlsFromSitemap(edition) {
    const xml = readLocal(edition, 'sitemap.xml');

    if (!isIndex(xml)) {
        return locsIn(xml);
    }
    // Children sit beside sitemap.xml, so the basename is enough.
    return locsIn(xml).flatMap(
        child => locsIn(readLocal(edition, path.basename(new URL(child).pathname))),
    );
}

async function fetchText(url) {
    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(`GET ${url} → HTTP ${res.status}`);
    }
    return res.text();
}

// Same expansion against the deployed site, so the CI liveness gate can compare
// real page URLs rather than a list of child sitemap names that barely ever change.
async function urlsFromLiveSitemap(host) {
    const xml = await fetchText(`https://${host}/sitemap.xml`);

    if (!isIndex(xml)) {
        return locsIn(xml);
    }
    const out = [];

    for (const child of locsIn(xml)) {
        out.push(...locsIn(await fetchText(child)));
    }
    return out;
}

async function main() {
    const [edition, ...rest] = process.argv.slice(2);

    if (!edition || !HOSTS[edition]) {
        console.error('Usage: node scripts/indexnow-ping.js <com|org> [paths…] [--dry-run]');
        process.exit(1);
    }

    const host = HOSTS[edition];
    const dryRun = rest.includes('--dry-run');
    const printUrls = rest.includes('--print-urls');
    const live = rest.includes('--live');
    const excludes = rest
        .filter(a => a.startsWith('--exclude='))
        .map(a => a.slice('--exclude='.length))
        .filter(Boolean);
    const paths = rest.filter(a => !a.startsWith('--'));

    // --print-urls just resolves the URL set and prints it, one per line: the CI
    // liveness gate diffs the built set against the live one, and needs both sides
    // produced by the same expansion logic.
    if (printUrls) {
        const urls = live
            ? await urlsFromLiveSitemap(host)
            : urlsFromSitemap(edition);

        console.log(urls.sort().join('\n'));
        return;
    }

    const key = readKey();
    let urlList = paths.length
        ? paths.map(p => `https://${host}${p.startsWith('/') ? p : '/' + p}`)
        : urlsFromSitemap(edition);

    if (excludes.length) {
        const before = urlList.length;
        urlList = urlList.filter(u => !excludes.some(x => u.includes(x)));
        const dropped = before - urlList.length;
        if (dropped) {
            console.log(
                `Excluded ${dropped} URL(s) matching: ${excludes.join(', ')}`,
            );
        }
    }

    if (!urlList.length) {
        console.error('No URLs to submit.');
        process.exit(1);
    }

    const payload = {
        host,
        key,
        keyLocation: `https://${host}/${key}.txt`,
        urlList,
    };

    console.log(`IndexNow → ${host}: ${urlList.length} URL(s)`);
    for (const u of urlList) console.log('  ' + u);

    if (dryRun) {
        console.log('\n--dry-run: nothing submitted.');
        return;
    }

    const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
    });

    // IndexNow returns 200 (accepted) or 202 (accepted, pending verification).
    if (res.ok || res.status === 202) {
        console.log(`\nSubmitted. HTTP ${res.status}.`);
    } else {
        const body = await res.text().catch(() => '');
        console.error(`\nIndexNow rejected the request: HTTP ${res.status}. ${body}`);
        process.exit(1);
    }
}

main().catch(err => {
    console.error(err.message || err);
    process.exit(1);
});
