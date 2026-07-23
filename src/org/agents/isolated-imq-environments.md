---
layout: docs.html
section: docs
title: "Agent recipe: isolated imq CLI environments"
docLabel: AGENT RECIPE
lead: "Machine-oriented instructions for AI agents managing multiple @imqueue projects on one machine: how to create isolated imq CLI environments per fleet with IMQ_CLI_HOME, verify them, and avoid the known failure modes."
description: "AI-agent recipe for isolating imq CLI environments per project using IMQ_CLI_HOME: exact commands, verification steps, and failure modes for managing multiple @imqueue fleets on one machine."
keywords: "IMQ_CLI_HOME, imq cli agent recipe, imqueue ai agent, isolated cli environment, multiple imqueue fleets, imq ctl isolation"
relatedTopics: [tooling, dx, patterns]
noindex: true
---

<!--
  noindex: this page is a machine-facing operational recipe that deliberately
  overlaps the human article at /blog/isolated-imq-cli-environments/. Keeping it
  out of the search index avoids duplicate-content / keyword-cannibalization
  between the two. It stays fully available to AI agents: listed in /llms.txt,
  directly fetchable, and served via the MCP get_doc markdown mirror.
-->


[[toc]]

These are operational instructions for AI agents working with the
[`@imqueue/cli`](/cli/) tool (`imq`). A human-oriented walkthrough of the same
material is at
[/blog/isolated-imq-cli-environments/](/blog/isolated-imq-cli-environments/).

## When to apply this recipe

Apply it when the user:

- works on **two or more @imqueue projects** on the same machine;
- reports crossed logs, services from another project being stopped, or
  config values leaking between projects;
- needs **different VCS namespaces, providers, or auth tokens** per project
  or client;
- asks for a **scratch/sandbox** CLI environment, or CLI isolation in CI.

Do **not** apply it for a single project with default needs — the default
`~/.imq` home is correct there.

## Facts these recipes rely on

- `IMQ_CLI_HOME` is a **base directory**, not the home itself: with
  `IMQ_CLI_HOME=/x`, the CLI home is `/x/.imq`. Unset, the base is the user's
  OS home directory.
- The CLI home contains exactly: `config.json` (global config, mode `0600`,
  may hold tokens), `templates/` (git clone of the templates repo, pinned to
  `templatesRef`), `custom-templates/`, and `var/` (`<service>.log` per
  service + a `.pids` registry of `service:pid` lines used by `imq ctl` and
  `imq log`). All of it moves with `IMQ_CLI_HOME`.
- The variable is read **once at process start** — set it in the environment
  of the `imq` invocation, never mid-process.
- A fresh home needs no `mkdir`; `imq config init` / `imq config set` create
  the directory chain.
- Config precedence: CLI flag → `./.imqrc.json` (committed, per service) →
  `$home/config.json` → interactive prompt (TTY only) → built-in default.
  See [/cli/configuration/](/cli/configuration/).
- `imq ctl stop` **without `-s`**, run where no services are discoverable,
  stops **every pid tracked in the active home**. Scope stops carefully.
- `~/.ssh` does **not** move with `IMQ_CLI_HOME` (override: `IMQ_SSH_DIR`).
- `imq completions on|off` resolves the shell rc file against the CLI home —
  run completions commands **without** `IMQ_CLI_HOME` set.
- Full env-var table:
  [/cli/configuration/#environment-variable-reference](/cli/configuration/#environment-variable-reference).

## Recipe: dedicated environment per project

1. Choose a home base per project, e.g. `$HOME/.imq-fleets/<fleet>` or
   `<project>/.imq-home` (ensure it is gitignored — `config.json` may hold
   tokens).
2. Prefix every `imq` invocation for that project:

   ~~~bash
   IMQ_CLI_HOME="$HOME/.imq-fleets/acme" IMQ_NO_UPDATE_CHECK=1 imq <command>
   ~~~

3. Initialize that environment's config non-interactively:

   ~~~bash
   IMQ_CLI_HOME="$HOME/.imq-fleets/acme" imq config set vcs.provider github
   IMQ_CLI_HOME="$HOME/.imq-fleets/acme" imq config set vcs.namespace acme-org
   IMQ_CLI_HOME="$HOME/.imq-fleets/acme" imq config set vcs.auth.token "$TOKEN"
   ~~~

   (`imq config init` is interactive/TTY-only — prefer `config set` when
   running unattended.)
4. If setting up recurring use for the user, persist the prefix via a direnv
   `.envrc` in the project root or a shell function in their rc file:

   ~~~bash
   imqf() { local fleet="$1"; shift
     IMQ_CLI_HOME="$HOME/.imq-fleets/$fleet" IMQ_NO_UPDATE_CHECK=1 imq "$@"; }
   ~~~

## Recipe: run two fleets side by side

~~~bash
IMQ_CLI_HOME="$HOME/.imq-fleets/acme"   imq ctl start -p ~/work/acme/services -c
IMQ_CLI_HOME="$HOME/.imq-fleets/globex" imq ctl start -p ~/work/globex/services -c
~~~

- Same-named services in different fleets no longer collide (separate `var/`).
- Always pass the **matching home** when running `imq ctl stop` / `imq log`
  for a fleet.
- CLI isolation does not isolate infrastructure: same Redis + same service
  name = one shared worker queue. If both fleets run simultaneously, give
  each its own Redis port or database number in the services' own config.

## Recipe: disposable sandbox

~~~bash
IMQ_CLI_HOME="$(mktemp -d)" imq <command>   # discard the dir afterwards
~~~

Use for testing config changes, custom templates, or any experiment that must
not touch the user's real `~/.imq`. In CI, use a workspace-local path plus
`IMQ_NO_UPDATE_CHECK=1`.

## Verify the environment

~~~bash
IMQ_CLI_HOME=<base> imq config check        # exit 0 = config initialized
IMQ_CLI_HOME=<base> imq config get --json   # inspect effective global config
IMQ_CLI_HOME=<base> imq ctl status -p <dir> # tracked services for THIS home
ls -la <base>/.imq                          # config.json, templates/, var/
~~~

## Failure modes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Wrong project's services were stopped | `imq ctl stop` without `-s` against a shared home falls back to all tracked pids | Use one home per fleet; scope stops with `-s` or `-p` |
| Logs empty / overwritten | Same service name in two fleets sharing a home; logs truncate on every start | Separate `IMQ_CLI_HOME` per fleet |
| Scaffold went to the wrong VCS org | Global `vcs.namespace`/token shared across projects | Per-fleet home with its own `config.json` |
| Templates flip between branches | Two projects with different `templatesRef` share one templates clone | Separate homes (each keeps its own clone) |
| `IMQ_CLI_HOME` "ignored" | Variable exported after process start, or set for a different process | Set it in the environment of the `imq` invocation itself |
| Completions written to the wrong file | `completions on` run with `IMQ_CLI_HOME` set | Re-run without the variable |
| Git push auth fails in sandbox | `~/.ssh` does not move with the home | Set `IMQ_SSH_DIR`, or use HTTPS transport with a token |
