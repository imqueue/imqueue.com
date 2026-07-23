---
layout: post.html
permalink: /blog/isolated-imq-cli-environments/
templateEngineOverride: md
title: "Managing multiple @imqueue projects locally: one isolated CLI home per fleet"
summary: "Every imq invocation shares one ~/.imq — one config, one pid registry, one set of logs. Here's how to give each project its own isolated CLI environment with IMQ_CLI_HOME, plus recipes for direnv, shell wrappers, per-client tokens and disposable sandboxes."
description: "How to run multiple @imqueue projects on one machine without collisions: isolated imq CLI environments per fleet using IMQ_CLI_HOME — direnv and shell-wrapper recipes, per-client config and tokens, disposable sandboxes, and the gotchas."
keywords: "IMQ_CLI_HOME, imq cli, multiple imqueue projects, isolated cli environment, imqueue fleet, imq ctl, node.js microservices local development, per-project cli config, imq sandbox"
date: 2026-07-23
author: andrii
illustration: fleets
topics: [tooling, dx, patterns]
ogType: article
---

**Managing multiple @imqueue projects on one machine** works fine — right up
until it doesn't. The `imq` CLI keeps everything it owns under a single home
directory, `~/.imq`: your global configuration, the templates cache, and the
runtime state behind `imq ctl` and `imq log`. With one project you'll never
notice. With two — a work fleet and a side project, or two clients with
different VCS orgs and tokens — that shared home becomes a source of quiet
collisions.

> **TL;DR** — set `IMQ_CLI_HOME` to give each project its own CLI home:
> `~/.imq` becomes `$IMQ_CLI_HOME/.imq`, and *everything* moves with it —
> `config.json`, the templates cache and the `var/` pid/log store used by
> `imq ctl` and `imq log`. Wire it up once with direnv or a two-line shell
> function, and every fleet gets its own config, tokens, template branch,
> logs and pid registry.

## Where one shared ~/.imq bites

The CLI creates exactly four things under its home
([full table](/cli/installation/#files-the-cli-creates)):

- **`config.json`** — the global configuration: providers, namespaces, auth
  tokens. Written with `0600` permissions because it may hold secrets.
- **`templates/`** — a cached git clone of the templates repository, pinned to
  the `templatesRef` branch from your config.
- **`custom-templates/`** — cached custom templates.
- **`var/`** — fleet runtime state: one `<service>.log` per service and a
  single `.pids` file of `service:pid` records.

Share that home across two projects and here's what actually goes wrong:

- **One global config.** `vcs.namespace`, provider choices and auth tokens are
  machine-wide. Working for two clients means either flipping values back and
  forth with `imq config set` or leaking one client's defaults into the
  other's scaffolds.
- **One pid registry, logs keyed by service name.** Logs are named after the
  service directory's basename and truncated on every start. Two fleets that
  both contain a `user-service` overwrite each other's pid records and wipe
  each other's logs.
- **The stop fallback.** Run `imq ctl stop` from a directory where no services
  are discoverable — and without `-s` — and it falls back to stopping *every*
  pid tracked in that home. With a shared home, that includes the other
  project's fleet.
- **One templates working copy.** The cache is a single git clone that gets
  `fetch` + `checkout` on use. Two projects pinning different `templatesRef`
  branches will re-checkout each other's ref on every scaffold.

## One variable moves everything

`IMQ_CLI_HOME` replaces the *base* the CLI treats as your home directory —
it doesn't replace `~/.imq` itself, it replaces the `~`:

~~~bash
export IMQ_CLI_HOME=/some/where   # ~/.imq becomes /some/where/.imq
~~~

Everything the CLI touches flows through that one resolution — config,
templates, custom templates, pids and logs. Nothing in the CLI hardcodes your
real home directory, and this isn't an accident of implementation: the CLI's
own test suite runs every end-to-end test inside a fresh `IMQ_CLI_HOME`, so
the isolation path is exercised on every release.

Two properties make it pleasant to use:

- **No setup ceremony.** A fresh home doesn't need `mkdir` — the first
  `imq config init` or `imq config set` creates the directory chain itself.
- **It's the complete list.** Per-service settings live in each repo's
  committed [`.imqrc.json`](/cli/configuration/#per-service-overrides-imqrcjson),
  so they travel with the project no matter which home is active. The usual
  precedence chain — CLI flag → `.imqrc.json` → global config → prompt →
  default — still applies; only the "global config" layer moves.

That split is the mental model: **things the project owns stay in the repo
(`.imqrc.json`); things you or a client own move with the home (tokens,
namespaces, template branches, runtime state).**

## The recipes

### 1. A home per project, automatically, with direnv

Drop an `.envrc` at the root of each project directory:

~~~bash
# ~/work/acme/.envrc
export IMQ_CLI_HOME="$PWD/.imq-home"
export IMQ_NO_UPDATE_CHECK=1
~~~

Run `direnv allow` once. Every shell that enters `~/work/acme` — including
your editor's terminal — now talks to that project's private CLI home, and
leaves it behind on `cd ..`. Add `.imq-home/` to the project's `.gitignore`:
its `config.json` may hold tokens.

### 2. Named fleets with a shell function

If you prefer explicit switching over directory magic:

~~~bash
# ~/.zshrc or ~/.bashrc
imqf() {   # usage: imqf <fleet> <imq arguments…>
  local fleet="$1"; shift
  IMQ_CLI_HOME="$HOME/.imq-fleets/$fleet" IMQ_NO_UPDATE_CHECK=1 imq "$@"
}
~~~

~~~bash
imqf acme   config init
imqf acme   ctl start -p ~/work/acme/services -c
imqf globex ctl status -p ~/work/globex/services
~~~

The fleet name is right there in your shell history, and tab completion for
`imq` keeps working since the function just prefixes the environment.

### 3. Per-fleet configuration: clients, tokens, template branches

Each home carries its own `config.json`, so per-client setups stop being a
juggling act:

~~~bash
imqf acme   config set vcs.provider github
imqf acme   config set vcs.namespace acme-org
imqf acme   config set vcs.auth.token "$ACME_GITHUB_TOKEN"
imqf acme   config set templatesRef master

imqf globex config set vcs.provider gitlab
imqf globex config set vcs.namespace globex
imqf globex config set templatesRef v4-stable
~~~

Every `imq service create` under the acme home now scaffolds into the right
org with the right token — and because each home has its **own templates
clone**, the two `templatesRef` branches no longer fight over one working
copy. Point a fleet at a forked templates repo entirely with
`IMQ_TEMPLATES_REPO`.

### 4. Disposable sandboxes (and CI)

Want to try a risky config change, test a custom template, or demo the CLI
without touching your real setup?

~~~bash
IMQ_CLI_HOME="$(mktemp -d)" imq config init
~~~

Everything lands in the temp directory; delete it and the experiment never
happened. The same trick is the clean way to run the CLI in CI — give the job
a workspace-local home and set `IMQ_NO_UPDATE_CHECK=1` (the self-update check
also auto-skips when there's no TTY).

### 5. Two fleets running side by side

With separate homes, parallel fleets stop being scary:

~~~bash
# terminal 1 — the acme fleet
imqf acme ctl start -p ~/work/acme/services -c
imqf acme log

# terminal 2 — the globex fleet
imqf globex ctl start -p ~/work/globex/services -c
imqf globex log
~~~

Both fleets can contain a `user-service`; their logs and pid records live in
different `var/` directories, so nothing is overwritten or truncated.
`imqf acme ctl stop` can only ever touch acme's pids — the stop fallback is
now scoped to one project, which turns it from a hazard into a feature:
"stop everything in *this* fleet".

One boundary to respect: `IMQ_CLI_HOME` isolates the *CLI's* state, not your
infrastructure. If both fleets connect to the same Redis and share a service
name, those workers join the same queue — that's @imqueue's
[load balancing](/blog/load-balancing-microservices-without-a-load-balancer/)
doing its job across projects, which is not what you want here. Give each
fleet its own Redis port or database number.

## Gotchas worth knowing

- **Set it before `imq` starts.** The CLI resolves its home once at startup;
  exporting `IMQ_CLI_HOME` has no effect on an already-running command.
- **`~/.ssh` stays put.** SSH keys are deliberately *not* relocated — a
  sandboxed environment still uses your real keys for git transport. Override
  separately with `IMQ_SSH_DIR` if you need to.
- **Install shell completions from your normal environment.** `imq
  completions on` resolves `~/.zshrc` / `~/.bashrc` against the CLI home, so
  with `IMQ_CLI_HOME` set it would write the completion block into
  `$IMQ_CLI_HOME/.zshrc` instead of your real rc file. Run it once without
  the variable.
- **The self-update check is global anyway.** There's one `npm i -g
  @imqueue/cli` shared by every environment — which is why the recipes above
  bake in `IMQ_NO_UPDATE_CHECK=1`.

## FAQ

<div class="faq">
<details>
<summary>Do I need IMQ_CLI_HOME if I only have one project?</summary>
<div class="faq-a"><p>No. The defaults are exactly right for a single project — reach for isolation when the second project appears, or when you want a scratch environment.</p></div>
</details>
<details>
<summary>Does IMQ_CLI_HOME change how my services run?</summary>
<div class="faq-a"><p>No. Only the CLI reads it. Your services take their own configuration and environment as always — what moves is the CLI's bookkeeping <em>about</em> them: config, templates, logs and pid records.</p></div>
</details>
<details>
<summary>Where should per-client tokens live?</summary>
<div class="faq-a"><p>In that client's own home — each <code>config.json</code> is written <code>0600</code> in its own directory. For one-off runs you can still pass <code>-T &lt;token&gt;</code> on the command line instead. Never commit an <code>.imq-home</code> directory.</p></div>
</details>
<details>
<summary>Can two fleets use different template versions?</summary>
<div class="faq-a"><p>Yes — that's one of the main wins. Each home keeps its own clone of the templates repository, so <code>templatesRef</code> (and even <code>IMQ_TEMPLATES_REPO</code>) can differ per fleet without interference.</p></div>
</details>
</div>

---

The full environment-variable table lives in the CLI User Guide's
[configuration reference](/cli/configuration/#environment-variable-reference),
and fleet operations are covered in
[Managing Local Services](/cli/managing-local-services/). If your AI assistant
manages your fleets for you, point it at the machine-readable version of these
recipes: [/agents/isolated-imq-environments/](/agents/isolated-imq-environments/).
New to @imqueue? Start with [Get Started](/get-started/) — your first service
is about five minutes away.

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Do I need IMQ_CLI_HOME if I only have one imqueue project?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. The default ~/.imq home is exactly right for a single project. Reach for IMQ_CLI_HOME when a second project appears on the same machine, or when you want a disposable scratch environment." }
    },
    {
      "@type": "Question",
      "name": "Does IMQ_CLI_HOME change how imqueue services run?",
      "acceptedAnswer": { "@type": "Answer", "text": "No. Only the imq CLI reads IMQ_CLI_HOME. Services take their own configuration and environment as always — what moves is the CLI's bookkeeping about them: global config, templates cache, logs and pid records." }
    },
    {
      "@type": "Question",
      "name": "Where should per-client tokens live when working for multiple clients?",
      "acceptedAnswer": { "@type": "Answer", "text": "In each client's own CLI home — every config.json is written with 0600 permissions inside its own IMQ_CLI_HOME. For one-off runs, pass -T <token> on the command line instead, and never commit a CLI home directory to version control." }
    },
    {
      "@type": "Question",
      "name": "Can two imqueue fleets use different template versions?",
      "acceptedAnswer": { "@type": "Answer", "text": "Yes. Each CLI home keeps its own clone of the templates repository, so templatesRef and even IMQ_TEMPLATES_REPO can differ per fleet without the two environments interfering with each other." }
    }
  ]
}
</script>
