// Which child sitemaps this edition publishes.
//
// One flat sitemap put 350 generated API URLs and 26 articles in the same file,
// so GSC's Page Indexing report blended them and there was no way to tell which
// bucket was failing to index — the number every other item in the SEO plan is
// measured against. Splitting them means "Crawled — currently not indexed" can be
// read per bucket.
//
// An empty list means "emit one flat sitemap instead of an index", which is what
// .com gets: three children for four URLs would be ceremony, and two of them would
// be empty, which GSC reports as an error.
//
// Read here rather than branched in Liquid so the list has one home:
// sitemap.liquid iterates it to build the index, sitemap-bucket.liquid paginates
// over it to emit one child per entry, and both stay in step automatically.
module.exports = () => (
  process.env.EDITION === 'org'
    ? [{ name: 'pages' }, { name: 'blog' }, { name: 'api' }]
    : []
);
