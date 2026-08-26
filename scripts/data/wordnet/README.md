# WordNet data, vendored

Two derived files, used at **build time only** by [`scripts/lib/lemma.ts`](../../lib/lemma.ts)
to turn inflected words into dictionary forms for the search index. Neither file is
served; what reaches the browser is a ~12 KB map of the *corpus's own* inflected forms,
regenerated on every build.

| file | what it is | size |
|---|---|---|
| `lemmas.txt.gz` | 81,377 single-word lemmas from WordNet's four index files, one per line | 262 KB |
| `exceptions.txt` | 5,952 irregular forms as `<pos> <form> <lemma>` — `v went go`, `n mice mouse` | 110 KB |
| `LICENSE` | Princeton's WordNet 3.0 licence, retained as it requires | 2 KB |

## Why these two and not a dependency

The lemma index is the half that matters, and it is not the irregular list — it is the
**validity check**. A suffix rule cannot tell `string` → `str` from `stating` → `state`,
because both are "drop `-ing`, maybe restore an `-e`". Asking *is the result a word?*
settles it. Rules alone need an arbitrary threshold instead, and measured on this corpus
adding one fixed five wrong merges while destroying a right one — `use`/`used`/`using`
stopped merging at all. See the header of `lemma.ts` for the full argument.

They are vendored rather than installed because the build must be reproducible: a
dependency version bump would silently change the map, and therefore the rankings, with
nothing in the diff to show it.

## Regenerating

Only needed to move to a newer WordNet. The source is the NLTK corpus distribution,
which is the WordNet 3.0 `dict/` tree including the exception lists that
`npm i wordnet-db` omits:

```bash
git clone --depth 1 --filter=blob:none --sparse -b gh-pages https://github.com/nltk/nltk_data.git nd
cd nd && git show HEAD:packages/corpora/wordnet.zip > wordnet.zip
python3 -c "import zipfile; zipfile.ZipFile('wordnet.zip').extractall('.')"
```

Then, from `wordnet/`:

```bash
awk '!/^ /{print $1}' index.noun index.verb index.adj index.adv \
  | sort -u | grep -vE '[_0-9]' | grep -E '^[a-z][a-z.-]*$' \
  | gzip -9 > lemmas.txt.gz
```

`exceptions.txt` is the four `*.exc` files concatenated with a leading part-of-speech
tag (`n`, `v`, `a`, `r`), in that order — the order matters, because `lemma.ts` keeps the
first mapping for a form and that is Morphy's own precedence.

After regenerating, run `npm run check:search-ranking`. It pins the merges that must
happen, the words that must never be rewritten, and the four traps that a naive rule set
reintroduces.

## What WordNet does not have

Modern computing vocabulary: `namespace`, `endpoint`, `microservice`, `timeout` are all
absent, and a missing lemma means a correct detachment gets *rejected*, so `namespaces`
never merges with `namespace`. That gap is filled by
[`../project-words.txt`](../project-words.txt), which the build reports candidates for —
read the header there before adding any, because roughly one in seven suggestion is a
fragment that would break a word which currently works.
