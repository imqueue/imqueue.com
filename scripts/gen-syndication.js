#!/usr/bin/env node
/*
 * Generate dev.to / Hashnode-ready markdown from the .org blog posts.
 *
 *   node scripts/gen-syndication.js
 *
 * For each published post it writes promotion/devto/<slug>.md with:
 *   - dev.to front matter (title, published:false, tags, canonical_url, cover_image)
 *   - canonical_url pointing back to the post on imqueue.org (no duplicate-content
 *     penalty; every reader/reaction still credits the original)
 *   - all root-relative links rewritten to absolute https://imqueue.org/... URLs
 *     (dev.to is a different origin, so /get-started/ etc. would 404 otherwise)
 *
 * These files are for manual copy-paste (or dev.to's "Publish from GitHub" flow).
 * `published: false` uploads them as drafts so you can eyeball each before it goes
 * live. Hashnode's markdown importer accepts the same front matter.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const POSTS_DIR = path.join(ROOT, 'src', 'org', 'blog', 'posts');
const OUT_DIR = path.join(ROOT, 'promotion', 'devto');
const SITE = 'https://imqueue.org';

// dev.to tags: max 4, lowercase, alphanumeric only. Map our topic vocabulary to
// tags devs actually follow; anything unmapped is normalised and kept as filler.
const TAG_MAP = {
    rpc: 'rpc', queue: 'node', architecture: 'architecture', types: 'typescript',
    comparison: 'programming', frameworks: 'node', jobs: 'node', transport: 'redis',
    patterns: 'redis', performance: 'performance', benchmark: 'performance',
    delivery: 'node', resilience: 'node', 'load-balancing': 'devops',
    discovery: 'microservices', dx: 'webdev', tooling: 'devops', clients: 'typescript',
    testing: 'testing', versioning: 'webdev',
};

function normaliseTag(t) {
    return String(t).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Always lead with these; they are the highest-traffic relevant dev.to tags.
function buildTags(topics) {
    const tags = [];
    const push = t => {
        const n = normaliseTag(t);
        if (n && !tags.includes(n) && tags.length < 4) tags.push(n);
    };
    push('node');
    push('typescript');
    push('microservices');
    for (const topic of topics || []) push(TAG_MAP[topic] || topic);
    return tags.slice(0, 4);
}

function rewriteLinks(body) {
    // [text](/path) and [text](/path "title") -> absolute; leave protocol-relative
    // and full URLs untouched. Also handles bare href="/..." should any appear.
    return body
        .replace(/\]\(\/(?!\/)/g, `](${SITE}/`)
        .replace(/href="\/(?!\/)/g, `href="${SITE}/`);
}

function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const files = fs
        .readdirSync(POSTS_DIR)
        .filter(f => f.endsWith('.md'))
        .sort();

    let written = 0;
    const skipped = [];

    for (const file of files) {
        const slug = file.replace(/\.md$/, '');
        const raw = fs.readFileSync(path.join(POSTS_DIR, file), 'utf8');
        const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (!m) { skipped.push(`${file} (no front matter)`); continue; }

        const fm = yaml.load(m[1]) || {};
        if (fm.draft) { skipped.push(`${file} (draft)`); continue; }

        const body = rewriteLinks(m[2].trim());
        const tags = buildTags(fm.topics);
        const canonical = `${SITE}${fm.permalink}`;
        const cover = `${SITE}/images/blog/${slug}.png`;

        // dev.to's front-matter parser wants single-line scalars; double-quote
        // them (JSON string form is valid YAML) after collapsing whitespace.
        const q = s => JSON.stringify(String(s).replace(/\s+/g, ' ').trim());
        const front = [
            '---',
            `title: ${q(fm.title)}`,
            'published: false',
            `description: ${q(fm.summary || fm.description || '')}`,
            `tags: ${tags.join(', ')}`,
            `canonical_url: ${canonical}`,
            `cover_image: ${cover}`,
            '---',
            '',
        ].join('\n');

        fs.writeFileSync(path.join(OUT_DIR, file), front + body + '\n');
        written++;
    }

    console.log(`Wrote ${written} dev.to files to promotion/devto/`);
    if (skipped.length) console.log('Skipped:\n  ' + skipped.join('\n  '));
}

main();
