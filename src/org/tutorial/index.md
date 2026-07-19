---
chapter: 1
title: Introduction
docLabel: TUTORIAL — CHAPTER 1
lead: "A step-by-step guide to building back-end services for a car-washing web application with @imqueue — for those who prefer to learn by example."
description: "Tutorial: build back-end services for a car-washing web application using @imqueue, from first service to GraphQL API and deployment."
---

## Tour of Cars Washing

In this tutorial we build, by example, the back-end services for a car-washing
time-reservation application, disclosing all the fundamentals of using the
@imqueue framework.

Here is a visual idea of what our application looks like for the end user:

<div class="shots">
  <img src="/images/tutorial/register.png" alt="Register screen">
  <img src="/images/tutorial/login.png" alt="Login screen">
  <img src="/images/tutorial/profile-details.png" alt="Profile details screen">
  <img src="/images/tutorial/profile-garage.png" alt="Profile garage screen">
  <img src="/images/tutorial/time-table.png" alt="Time table screen">
</div>

You can get the entire set of tutorial application source code on
[GitHub](https://github.com/imqueue-sandbox).

## Architecture

Let's assume we decided to build the web application using a
React/Relay/GraphQL stack on the front-end, backed by a GraphQL API endpoint
in front of @imqueue-based services on the back-end.

While a front-end team works on the user interfaces, we will focus on creating
the back-end services. We split the back-end into a set of small, decoupled
services, each developed in parallel by small teams:

- **User service** — user data manipulations. Stack: Node.js/TypeScript,
  @imqueue over Redis, MongoDB.
- **Auth service** — authentication routines. Stack: Node.js/TypeScript,
  @imqueue over Redis, JSON Web Tokens, Redis.
- **Car service** — cars data. Stack: Node.js/TypeScript, @imqueue over Redis,
  a static data source with custom in-memory storage.
- **Time-Table service** — time reservations, managing reservation events.
  Stack: Node.js/TypeScript, @imqueue over Redis, PostgreSQL.
- **API endpoint service** — a GraphQL endpoint that orchestrates data access to
  the underlying services. Stack: Node.js/TypeScript, @imqueue over Redis,
  graphql, graphql-relay, express, express-graphql.

Our high-level application architecture looks like this:

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
<line x1="117" y1="412" x2="117" y2="450" marker-end="url(#hla-ah)"/>
<line x1="312" y1="412" x2="312" y2="450" marker-end="url(#hla-ah)"/>
<line x1="507" y1="412" x2="507" y2="450" marker-end="url(#hla-ah)"/>
<line x1="702" y1="412" x2="702" y2="450" marker-end="url(#hla-ah)"/>
</g>
<g class="elab">
<rect x="352" y="130" width="116" height="20" rx="5"/>
<text x="410" y="144">GraphQL / HTTP</text>
<rect x="345" y="276" width="130" height="20" rx="5"/>
<text x="410" y="290">@imqueue · RPC</text>
</g>
<g transform="translate(295,44)">
<rect class="node" width="230" height="64" rx="13"/>
<g class="ic" transform="translate(20,19)"><rect x="0" y="0" width="30" height="24" rx="3"/><line x1="0" y1="7" x2="30" y2="7"/><circle class="dot" cx="4.5" cy="3.5" r="1.2"/><circle class="dot" cx="9" cy="3.5" r="1.2"/><circle class="dot" cx="13.5" cy="3.5" r="1.2"/></g>
<text class="nt" x="64" y="30">Web App</text>
<text class="ns" x="64" y="47">React / Relay / GraphQL</text>
</g>
<g transform="translate(295,176)">
<rect class="hub" width="230" height="64" rx="13"/>
<g class="ic-h" transform="translate(20,18)"><circle cx="14" cy="14" r="13"/><line x1="1" y1="14" x2="27" y2="14"/><ellipse cx="14" cy="14" rx="6" ry="13"/><line x1="4" y1="7" x2="24" y2="7"/><line x1="4" y1="21" x2="24" y2="21"/></g>
<text class="ht" x="64" y="30">API Service</text>
<text class="hs" x="64" y="47">GraphQL endpoint</text>
</g>
<g transform="translate(32,330)">
<rect class="node" width="170" height="82" rx="13"/>
<g class="ic" transform="translate(70,14)"><rect x="0" y="0" width="30" height="11" rx="2.5"/><rect x="0" y="14" width="30" height="11" rx="2.5"/><circle class="dot" cx="5" cy="5.5" r="1.4"/><circle class="dot" cx="5" cy="19.5" r="1.4"/></g>
<text class="nt mid" x="85" y="58">User Service</text>
<text class="ns mid" x="85" y="73">Node.js · TS</text>
</g>
<g transform="translate(227,330)">
<rect class="node" width="170" height="82" rx="13"/>
<g class="ic" transform="translate(70,14)"><rect x="0" y="0" width="30" height="11" rx="2.5"/><rect x="0" y="14" width="30" height="11" rx="2.5"/><circle class="dot" cx="5" cy="5.5" r="1.4"/><circle class="dot" cx="5" cy="19.5" r="1.4"/></g>
<text class="nt mid" x="85" y="58">Auth Service</text>
<text class="ns mid" x="85" y="73">Node.js · TS</text>
</g>
<g transform="translate(422,330)">
<rect class="node" width="170" height="82" rx="13"/>
<g class="ic" transform="translate(70,14)"><rect x="0" y="0" width="30" height="11" rx="2.5"/><rect x="0" y="14" width="30" height="11" rx="2.5"/><circle class="dot" cx="5" cy="5.5" r="1.4"/><circle class="dot" cx="5" cy="19.5" r="1.4"/></g>
<text class="nt mid" x="85" y="58">Car Service</text>
<text class="ns mid" x="85" y="73">Node.js · TS</text>
</g>
<g transform="translate(617,330)">
<rect class="node" width="170" height="82" rx="13"/>
<g class="ic" transform="translate(70,14)"><rect x="0" y="0" width="30" height="11" rx="2.5"/><rect x="0" y="14" width="30" height="11" rx="2.5"/><circle class="dot" cx="5" cy="5.5" r="1.4"/><circle class="dot" cx="5" cy="19.5" r="1.4"/></g>
<text class="nt mid" x="85" y="58">Time-Table Service</text>
<text class="ns mid" x="85" y="73">Node.js · TS</text>
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

## Getting all the benefits

The @imqueue command line tool can integrate third-party development tools —
Travis CI, DockerHub and GitHub — into the default template. When a service is
created with the tool, you gain an automatically set up repository, continuous
integration and Docker image builds with a single command. So the first step is
to install and configure `@imqueue/cli`.

### Preparing the development environment

Before we start we need [Node.js](https://nodejs.org/), ideally installed via
[NVM](https://github.com/creationix/nvm#installation). We will also need Redis,
MongoDB and PostgreSQL — install them however you prefer, e.g. via Docker images
([Mongo](https://hub.docker.com/_/mongo/), [Redis](https://hub.docker.com/_/redis/),
[PostgreSQL](https://hub.docker.com/_/postgres/)), or directly in your system.

### Installing @imqueue/cli

The command line tool can integrate with GitHub, DockerHub and Travis CI — it's
your choice whether to use them. Without integrations it simply creates local
folders and files; you make that choice during installation.

If you decide to use integrations, prepare your GitHub and DockerHub namespaces
(a personal account or an organisation), and create a GitHub personal access
token that grants @imqueue/cli permission to create and write to repositories in
that namespace.

Then run:

~~~bash
npm i -g @imqueue/cli
~~~

At the end it launches an interactive configuration wizard — just follow the
steps to complete your `@imqueue/cli` configuration.

<div class="embed">
  <iframe src="https://www.youtube.com/embed/4zuAmpeDHM4" title="Installation screencast" allow="autoplay; encrypted-media" allowfullscreen></iframe>
</div>

With these preparations done, we're ready to create our first service.
