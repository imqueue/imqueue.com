---
layout: docs.html
section: docs
title: Getting Started
docLabel: GET STARTED
lead: "The shortest path from an empty terminal to a running @imqueue service and a generated client. For a deeper, worked example see the Tutorial; the full technical reference lives in the API docs."
description: "Install @imqueue and ship your first Node & TypeScript service in minutes — the shortest quickstart for building message-queue RPC microservices."
keywords: "@imqueue getting started, imqueue quickstart, install imqueue, first Node.js service, TypeScript microservice tutorial, npm @imqueue/cli, message queue RPC setup"
---

[[toc]]

## Prerequisites

Before you begin, make sure the following are installed and available on your
system:

- [Node.js](https://nodejs.org/en/) **22.12 or newer** — we recommend
  installing it through [NVM](https://github.com/nvm-sh/nvm#installing-and-updating).
- [Redis](https://redis.io/download) — version 3.2 or newer. @imqueue uses
  Redis as its message-queue transport.
- [Git](https://git-scm.com/downloads) — the command-line client.

## 1. Install the CLI

Install the @imqueue command-line tool globally. It scaffolds services and
generates clients for you, so you write features instead of boilerplate:

~~~bash
npm i -g @imqueue/cli
~~~

On first run the installer offers to collect some initial configuration. You can
fill it in now, or press `Ctrl+C` to skip and configure it later (or not at all
— it is optional).

## 2. Configure (optional)

`@imqueue/cli` works without any configuration. Defining a global configuration
once is only worthwhile on larger projects with many services, where it saves
you from repeating the same options on every command.

To create or re-create the configuration at any time, run:

~~~bash
imq config init
~~~

For the full setup details — requirements, upgrading and shell completions — see
the [Installation](/cli/installation/) & [Configuration](/cli/configuration/)
chapters of the CLI User Guide.

## 3. Enable shell completions

Turning on completions for the `imq` command makes the CLI far more pleasant to
use. Run:

~~~bash
imq completions on
~~~

and follow the prompts. `bash` and `zsh` are supported.

## 4. Everyday usage

The CLI exists to remove the boilerplate of building `@imqueue`-based back-end
services. It does two main jobs for you:

1. Scaffold services from ready-made templates.
2. Generate client code for calling those services.

### 4.1 Create a service

Scaffold a new service into a fresh directory:

~~~bash
mkdir user-service
cd user-service
imq service create
~~~

Then open `src/UserService.ts` and implement the methods your service needs to
expose.

### 4.2 Run the service

Make sure a Redis server is running on the default port, then start the service
in watch mode:

~~~bash
npm run dev
~~~

### 4.3 Generate a client

Every @imqueue service is self-describing, so a fully typed client can be
generated directly from a running service. With the service running, generate
its client:

~~~bash
mkdir clients
cd clients
imq client generate UserService
~~~

You can now import that client and call the service's methods remotely, with
full type-checking and IDE auto-completion.

<div class="callout">
  <p><strong>That's it — you've built and called your first @imqueue service.</strong></p>
  <p><strong>Ready for more?</strong> Work through the <a href="/tutorial/">Tutorial</a> for a complete example application, or dive into the <a href="/api/">API reference</a>.</p>
</div>
