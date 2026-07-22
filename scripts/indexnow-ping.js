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
 *   node scripts/indexnow-ping.js com --dry-run       # print what would be sent, submit nothing
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

function urlsFromSitemap(edition) {
    const file = path.join(__dirname, '..', `_site-${edition}`, 'sitemap.xml');
    if (!fs.existsSync(file)) {
        throw new Error(
            `${file} not found — build the ${edition} edition first ` +
                `(EDITION=${edition} npm run build).`,
        );
    }
    const xml = fs.readFileSync(file, 'utf8');
    return [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(m => m[1]);
}

async function main() {
    const [edition, ...rest] = process.argv.slice(2);

    if (!edition || !HOSTS[edition]) {
        console.error('Usage: node scripts/indexnow-ping.js <com|org> [paths…] [--dry-run]');
        process.exit(1);
    }

    const host = HOSTS[edition];
    const key = readKey();
    const dryRun = rest.includes('--dry-run');
    const paths = rest.filter(a => !a.startsWith('--'));

    const urlList = paths.length
        ? paths.map(p => `https://${host}${p.startsWith('/') ? p : '/' + p}`)
        : urlsFromSitemap(edition);

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
