---
chapter: 1
title: Introduction
docLabel: TUTORIAL — CHAPTER 1
lead: "A step-by-step guide to building back-end services for a car-washing web application with @imqueue — for those who prefer to learn by example."
description: "Tutorial: build back-end services for a car-washing web application using @imqueue, from first service to GraphQL API and deployment."
keywords: "@imqueue tutorial, Node.js microservices tutorial, TypeScript back-end tutorial, build microservices by example, message queue RPC tutorial, GraphQL microservices, SOA tutorial"
ogType: article
---

## A car-wash booking app

In this tutorial we build the back-end for a car-wash booking application, one
service at a time, covering the fundamentals of the @imqueue framework along the
way.

Here is what the finished application looks like to its users:

<div class="shots">
  <img src="/images/tutorial/register.png" alt="Register screen">
  <img src="/images/tutorial/login.png" alt="Login screen">
  <img src="/images/tutorial/profile-details.png" alt="Profile details screen">
  <img src="/images/tutorial/profile-garage.png" alt="Profile garage screen">
  <img src="/images/tutorial/time-table.png" alt="Time table screen">
</div>

The complete source code for the tutorial application is available on
[GitHub](https://github.com/imqueue-sandbox).

## Architecture

Let's say we're building the web application on a React/Relay/GraphQL front-end,
served by a GraphQL API endpoint that sits in front of a set of @imqueue-based
back-end services.

While a front-end team builds the user interface, we focus on the back-end. We
split it into small, decoupled services that can be developed in parallel by
small teams:

- **User service** — manages user data. Stack: Node.js/TypeScript, @imqueue over
  Redis, MongoDB.
- **Auth service** — handles authentication. Stack: Node.js/TypeScript, @imqueue
  over Redis, JSON Web Tokens.
- **Car service** — serves car data. Stack: Node.js/TypeScript, @imqueue over
  Redis, a static data source cached in a custom in-memory store.
- **Time-Table service** — manages reservations and reservation events. Stack:
  Node.js/TypeScript, @imqueue over Redis, PostgreSQL.
- **API service** — a GraphQL endpoint that orchestrates access to the services
  above. Stack: Node.js/TypeScript, @imqueue over Redis, graphql, graphql-relay,
  express, graphql-yoga.

> **NOTE.** The GraphQL choice is just that — a choice. In two bonus chapters
> at the end of the tutorial we swap this GraphQL gateway for a
> [REST/OpenAPI one](/tutorial/rest-api/) and re-point
> [the web app](/tutorial/rest-web-app/) at it, leaving every back-end service
> untouched.

The high-level architecture looks like this:

<figure class="hla-fig">
<svg id="hla-arch" viewBox="0 0 820 520" role="img" aria-labelledby="hla-t hla-d" xmlns="http://www.w3.org/2000/svg">
<title id="hla-t">Application high-level architecture</title>
<desc id="hla-d">A React/Relay/GraphQL front-end talks over GraphQL/HTTP to an API Service, which orchestrates four @imqueue back-end services over RPC: User (MongoDB), Auth (Redis/JWT), Car (in-memory) and Time-Table (PostgreSQL).</desc>
<defs><marker id="hla-ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z"/></marker></defs>
<rect class="z" x="16" y="16" width="788" height="104" rx="16"/>
<rect class="z" x="16" y="136" width="788" height="368" rx="16"/>
<text class="ztab" x="38" y="42">FRONT-END</text>
<text class="ztab" x="38" y="162">BACK-END</text>
<g class="edge">
<line x1="410" y1="240" x2="117" y2="330" marker-end="url(#hla-ah)"/>
<line x1="410" y1="240" x2="312" y2="330" marker-end="url(#hla-ah)"/>
<line x1="410" y1="240" x2="507" y2="330" marker-end="url(#hla-ah)"/>
<line x1="410" y1="240" x2="702" y2="330" marker-end="url(#hla-ah)"/>
<line x1="410" y1="108" x2="410" y2="174" marker-end="url(#hla-ah)"/>
<line x1="117" y1="428" x2="117" y2="450" marker-end="url(#hla-ah)"/>
<line x1="312" y1="428" x2="312" y2="450" marker-end="url(#hla-ah)"/>
<line x1="507" y1="428" x2="507" y2="450" marker-end="url(#hla-ah)"/>
<line x1="702" y1="428" x2="702" y2="450" marker-end="url(#hla-ah)"/>
</g>
<g class="elab">
<rect x="348" y="127" width="124" height="24" rx="6"/>
<text x="410" y="144">GraphQL / HTTP</text>
<rect x="342" y="273" width="136" height="24" rx="6"/>
<text x="410" y="290">@imqueue · RPC</text>
</g>
<g transform="translate(285,44)">
<rect class="node" width="250" height="64" rx="13"/>
<g class="ic" transform="translate(20,19)"><rect x="0" y="0" width="30" height="24" rx="3"/><line x1="0" y1="7" x2="30" y2="7"/><circle class="dot" cx="4.5" cy="3.5" r="1.2"/><circle class="dot" cx="9" cy="3.5" r="1.2"/><circle class="dot" cx="13.5" cy="3.5" r="1.2"/></g>
<text class="nt" x="64" y="28">Web App</text>
<text class="ns" x="64" y="49">React / Relay / GraphQL</text>
</g>
<g transform="translate(285,176)">
<rect class="hub" width="250" height="64" rx="13"/>
<g class="ic-h" transform="translate(20,18)"><circle cx="14" cy="14" r="13"/><line x1="1" y1="14" x2="27" y2="14"/><ellipse cx="14" cy="14" rx="6" ry="13"/><line x1="4" y1="7" x2="24" y2="7"/><line x1="4" y1="21" x2="24" y2="21"/></g>
<text class="ht" x="64" y="28">API Service</text>
<text class="hs" x="64" y="49">GraphQL endpoint</text>
</g>
<g transform="translate(32,330)">
<rect class="node" width="170" height="98" rx="13"/>
<g class="ic" transform="translate(70,14)"><rect x="0" y="0" width="30" height="11" rx="2.5"/><rect x="0" y="14" width="30" height="11" rx="2.5"/><circle class="dot" cx="5" cy="5.5" r="1.4"/><circle class="dot" cx="5" cy="19.5" r="1.4"/></g>
<text class="nt mid" x="85" y="58">User Service</text>
<text class="ns mid" x="85" y="83">Node.js · TS</text>
</g>
<g transform="translate(227,330)">
<rect class="node" width="170" height="98" rx="13"/>
<g class="ic" transform="translate(70,14)"><rect x="0" y="0" width="30" height="11" rx="2.5"/><rect x="0" y="14" width="30" height="11" rx="2.5"/><circle class="dot" cx="5" cy="5.5" r="1.4"/><circle class="dot" cx="5" cy="19.5" r="1.4"/></g>
<text class="nt mid" x="85" y="58">Auth Service</text>
<text class="ns mid" x="85" y="83">Node.js · TS</text>
</g>
<g transform="translate(422,330)">
<rect class="node" width="170" height="98" rx="13"/>
<g class="ic" transform="translate(70,14)"><rect x="0" y="0" width="30" height="11" rx="2.5"/><rect x="0" y="14" width="30" height="11" rx="2.5"/><circle class="dot" cx="5" cy="5.5" r="1.4"/><circle class="dot" cx="5" cy="19.5" r="1.4"/></g>
<text class="nt mid" x="85" y="58">Car Service</text>
<text class="ns mid" x="85" y="83">Node.js · TS</text>
</g>
<g transform="translate(617,330)">
<rect class="node" width="170" height="98" rx="13"/>
<g class="ic" transform="translate(70,14)"><rect x="0" y="0" width="30" height="11" rx="2.5"/><rect x="0" y="14" width="30" height="11" rx="2.5"/><circle class="dot" cx="5" cy="5.5" r="1.4"/><circle class="dot" cx="5" cy="19.5" r="1.4"/></g>
<text class="nt mid" x="85" y="58">Time-Table Service</text>
<text class="ns mid" x="85" y="83">Node.js · TS</text>
</g>
<g transform="translate(32,452)">
<rect class="store" width="170" height="34" rx="9"/>
<g class="ic" transform="translate(16,9)"><ellipse cx="8" cy="3" rx="8" ry="3"/><path d="M0 3 V13 a8 3 0 0 0 16 0 V3"/><path d="M0 8 a8 3 0 0 0 16 0"/></g>
<text class="st" x="40" y="22">MongoDB</text>
</g>
<g transform="translate(227,452)">
<rect class="store" width="170" height="34" rx="9"/>
<g class="ic" transform="translate(16,9)"><ellipse cx="8" cy="3" rx="8" ry="3"/><path d="M0 3 V13 a8 3 0 0 0 16 0 V3"/><path d="M0 8 a8 3 0 0 0 16 0"/></g>
<text class="st" x="40" y="22">Redis · JWT</text>
</g>
<g transform="translate(422,452)">
<rect class="store" width="170" height="34" rx="9"/>
<g class="ic" transform="translate(16,9)"><ellipse cx="8" cy="3" rx="8" ry="3"/><path d="M0 3 V13 a8 3 0 0 0 16 0 V3"/><path d="M0 8 a8 3 0 0 0 16 0"/></g>
<text class="st" x="40" y="22">In-memory</text>
</g>
<g transform="translate(617,452)">
<rect class="store" width="170" height="34" rx="9"/>
<g class="ic" transform="translate(16,9)"><ellipse cx="8" cy="3" rx="8" ry="3"/><path d="M0 3 V13 a8 3 0 0 0 16 0 V3"/><path d="M0 8 a8 3 0 0 0 16 0"/></g>
<text class="st" x="40" y="22">PostgreSQL</text>
</g>
</svg>
</figure>

## Setting up the toolchain

The @imqueue command-line tool can wire its scaffolding into third-party
services — a git host (GitHub, GitLab or Bitbucket), a container registry (Docker
Hub, Google Artifact Registry, AWS ECR or Azure ACR) and a CI provider (GitHub
Actions, CircleCI or Travis). When you create a service with the tool, you can
get a ready-made repository, continuous integration and one-command Docker image
builds out of the box. So the first step is to install and configure
`@imqueue/cli`.

### Prepare the development environment

You'll need [Node.js](https://nodejs.org/) 22.12 or newer, ideally installed via
[NVM](https://github.com/nvm-sh/nvm#installing-and-updating). You'll also need
Redis, MongoDB and PostgreSQL — install them however you prefer, whether via
Docker images ([Mongo](https://hub.docker.com/_/mongo/),
[Redis](https://hub.docker.com/_/redis/),
[PostgreSQL](https://hub.docker.com/_/postgres/)) or directly on your system.

### Install @imqueue/cli

These git-host, container-registry and CI integrations are entirely optional.
Without them, the tool simply creates local folders and files; you choose which
to enable when you configure the tool.

If you do want the integrations, prepare your git-host and registry namespaces
(a personal account or an organisation) and create a personal access token for
your git host — GitHub, for example — granting @imqueue/cli permission to create
and write to repositories in that namespace.

Then install the tool:

~~~bash
npm i -g @imqueue/cli
~~~

Then run the interactive configuration wizard once to finish setting up
`@imqueue/cli`:

~~~bash
imq config init
~~~

It walks you through your git host, CI provider, container registry and default
packages, and stores the answers globally.

For the full setup details — requirements, upgrading and shell completions — see
the [Installation](/cli/installation/) & [Configuration](/cli/configuration/)
chapters of the CLI User Guide.

With that in place, we're ready to create our first service.
