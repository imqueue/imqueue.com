---
layout: docs.html
section: docs
title: Getting started
docLabel: GET STARTED
lead: "The shortest step-by-step guide to installing @imqueue and shipping your first service. For a deeper walkthrough see the Tutorial; full technical reference lives in the API docs."
description: "Install @imqueue and ship your first Node & TypeScript service in minutes — the shortest quickstart for building message-queue RPC microservices."
keywords: "@imqueue getting started, imqueue quickstart, install imqueue, first Node.js service, TypeScript microservice tutorial, npm @imqueue/cli, message queue RPC setup"
---

[[toc]]

## Before we start

Make sure you have all required software pre-installed on your system. Here is
what we need:

- [Node.js](https://nodejs.org/en/) — we recommend installing it via
  [NVM](https://github.com/creationix/nvm/blob/master/README.md)
- [Redis](https://redis.io/download) version 3.2 or above recommended
- [Git](https://git-scm.com/downloads) command-line tool

## 1. Installing

First, it is recommended to install the IMQ command line tool globally:

~~~bash
npm i -g @imqueue/cli
~~~

During the first installation it will prompt you to enter some initial
configuration information. You may proceed filling it in, or skip it by
pressing `Ctrl+C` and configure it later (or never).

## 2. Configuring

The `@imqueue/cli` tool does not require mandatory configuration. That said,
if you're going to work on a big project with a large set of services, it may
be useful to define a global configuration once and simplify most of the
commands you type in your terminal.

If the configuration step was skipped during installation, or you need to
re-define an existing config, use:

~~~bash
imq config init
~~~

<div class="embed">
  <iframe src="https://www.youtube.com/embed/4zuAmpeDHM4" title="Installation screencast" allow="autoplay; encrypted-media" allowfullscreen></iframe>
</div>

## 3. Enable completions

After installation and configuration it is recommended to turn on completions
support for the `imq` command in your terminal. Simply run:

~~~bash
imq completions on
~~~

and follow the instructions. Currently it supports `bash` and `zsh`.

## 4. Usage

The IMQ command line tool was created specially to free you from writing
boilerplate while building `@imqueue`-based back-end services. There are two
major things it can do for you:

1. Create services from pre-defined boilerplate templates
2. Manage client code generation

### 4.1 Creating a service

To create a service from boilerplate, run these commands in your terminal:

~~~bash
mkdir user-service
cd user-service
imq service create
~~~

Now open `src/UserService.ts` and implement all the methods (functionality)
you need for this service.

### 4.2 Running a service

Make sure you have a Redis server running on the default port before launching
your service. Running the service is easy — just execute:

~~~bash
npm run dev
~~~

### 4.3 Generating a client

All @imqueue services are self-describing. To generate a client you need to run
the service first. After that, run in your terminal:

~~~bash
mkdir clients
cd clients
imq client generate UserService
~~~

Now the client can be used to call service methods remotely.

<div class="callout">
  <p><strong>Congratulations!</strong> You've just implemented your first @imqueue-based service.</p>
  <p><strong>Need more?</strong> Take a look at the <a href="/api/">API docs</a> and the <a href="/tutorial/">Tutorial</a>.</p>
</div>
