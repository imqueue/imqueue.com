// Emits /blog/search-index.json — the client-side search feed for the blog.
module.exports = class BlogSearchIndex {
  data() {
    return {
      permalink: "/blog/search-index.json",
      eleventyExcludeFromCollections: true,
    };
  }

  render(data) {
    const posts = (data.collections.posts || []).map((p) => ({
      title: p.data.title || "",
      url: p.url,
      summary: p.data.summary || "",
      author: p.data.author || "",
      topics: p.data.topics || [],
      date: p.date ? p.date.toISOString().slice(0, 10) : "",
    }));
    return JSON.stringify(posts);
  }
};
