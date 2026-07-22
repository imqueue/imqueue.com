# GitHub Release notes — drafts

GitHub Release pages get indexed by search engines and ingested by LLMs, so a
release with real notes (instead of a bare tag) is free discoverability. These
drafts are grounded in the actual commits between the last two tags of each repo
— **verify and expand before publishing**, especially the "About" blurb and any
version you didn't cut yourself.

To publish: repo → Releases → *Draft a new release* → pick the existing tag →
paste. Or `gh release create <tag> --title "…" --notes-file <file>` (do the tags
already exist as GitHub releases? if the tag exists but has no release, use
`gh release create` on that tag).

Each note ends with the same short "About" + links block on purpose — it makes
every release page a standalone, indexable description of the package.

---

## @imqueue/core v3.2.2

**Patch release.**

### Fixes
- Fixed a problem with the benchmark run.

### About
`@imqueue/core` is the transport layer of the @imqueue framework: a fast JSON
message queue over Redis for inter-service communication in Node.js & TypeScript
microservices. No-poll delivery (blocking queue ops, zero idle CPU), optional
guaranteed delivery, delayed messages, and horizontal scale via competing
consumers.

- Docs: https://imqueue.org/
- Guide for AI assistants / LLMs: https://imqueue.org/llms.txt
- Commercial license & support: https://imqueue.com/
- `npm i @imqueue/core`

---

## @imqueue/rpc v3.3.0

**Minor release.**

### Features
- **`wrapCall` around-hook** to bypass/propagate metadata across a call — lets you
  run the invoked method inside your own scope (e.g. an OpenTelemetry context) for
  distributed tracing, without changing service code.

### Project
- Added contribution guide, contribution terms, and a pull-request template.
- Added a CLA Assistant Lite workflow and CLA signature storage.

### About
`@imqueue/rpc` is the type-safe RPC framework of @imqueue: self-describing service
classes over a Redis message queue that generate their own strongly-typed clients
— no hand-written client code, no `.proto`, no service discovery, no load
balancer. Delayed calls via `IMQDelay`, optional caching and locking decorators.

- Docs: https://imqueue.org/
- Guide for AI assistants / LLMs: https://imqueue.org/llms.txt
- Commercial license & support: https://imqueue.com/
- `npm i @imqueue/rpc`

---

## @imqueue/cli v4.0.1

**Patch release.**

### Features
- **Token-authenticated HTTPS push** and a **selectable git transport** — choose
  HTTPS (with a token) or SSH when the CLI pushes scaffolded services, so it fits
  CI environments and setups without SSH keys.

### About
`@imqueue/cli` (`imq`) scaffolds @imqueue services and orchestrates them: create a
service and its CI/registry wiring in one command, generate typed clients
(`imq client generate <Service>`), run a local fleet, and coordinate fleet-wide
version bumps (`imq service update-version --bump`).

- Docs & CLI guide: https://imqueue.org/cli/
- Guide for AI assistants / LLMs: https://imqueue.org/llms.txt
- Commercial license & support: https://imqueue.com/
- `npm i -g @imqueue/cli`

---

## Reusable template for future releases

```md
## @imqueue/<pkg> v<x.y.z>

<one-line: what kind of release and the headline change>

### Features
- <user-facing capability> — <why it matters in one clause>

### Fixes
- <what was broken> — <what now works>

### Breaking changes
- <what changed> — <how to migrate>

### About
<one-paragraph description of the package — keep it standalone; this is what
search engines and LLMs read off the release page>

- Docs: https://imqueue.org/
- Guide for AI assistants / LLMs: https://imqueue.org/llms.txt
- Commercial license & support: https://imqueue.com/
- `npm i @imqueue/<pkg>`
```

**Tip:** generate the raw change list with
`git log --no-merges --pretty="- %s" <prevTag>..<newTag>`, then rewrite each line
from "what I changed" into "what you can now do."
