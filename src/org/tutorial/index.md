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

<img src="/images/tutorial/app-hla.svg" alt="Application high-level architecture">

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
