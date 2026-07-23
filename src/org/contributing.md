---
layout: docs.html
title: Contributing
docLabel: CONTRIBUTING
lead: "@imqueue is an open-source project under GPL-3.0, and contributions are very welcome — bug reports, pull requests, docs fixes and tutorial improvements all help make the framework better."
description: "How to contribute to @imqueue: where to file issues, how to open pull requests across the core packages, and the project's coding style."
keywords: "contribute to imqueue, imqueue pull request, imqueue issues, open source Node.js RPC, imqueue GitHub, contributing guide"
relatedTopics: [architecture, dx]
---

[[toc]]

@imqueue is an open-source project released under the
[GPL-3.0 license](/license/). We greatly appreciate anyone willing to help make
it better. By reporting issues, opening pull requests, or contributing your work
to our repositories in any other way, you agree to do so under the terms of that
license. If you do not agree to those terms, please do not submit issues, pull
requests or other contributions.

## Reporting issues

Report issues directly on the package they relate to:

- [@imqueue/core issues](https://github.com/imqueue/core/issues)
- [@imqueue/rpc issues](https://github.com/imqueue/rpc/issues)
- [@imqueue/cli issues](https://github.com/imqueue/cli/issues)
- [@imqueue/templates issues](https://github.com/imqueue/templates/issues)
- [This website's issues](https://github.com/imqueue/imqueue.com/issues)

A good report includes what you expected, what happened, and a minimal way to
reproduce it (versions of Node.js, Redis and the relevant @imqueue package help).

## Pull requests

We actively welcome pull requests to all related repositories.

1. **Fork** the repository using the "Fork" button on GitHub.
2. **Clone** your fork:
   ~~~bash
   git clone git@github.com:<your-user>/<repo>.git
   ~~~
3. **Install dependencies:**
   ~~~bash
   npm install
   ~~~
4. Make your changes, then **run the tests**:
   ~~~bash
   npm run test-fast   # core packages
   # or, in other repos:
   npm test
   ~~~
5. If your change fixes a known issue, **reference it** in the commit message.
6. Push and **open a pull request**.

### Core packages

- [@imqueue/core](https://github.com/imqueue/core)
- [@imqueue/rpc](https://github.com/imqueue/rpc)
- [@imqueue/cli](https://github.com/imqueue/cli)
- [@imqueue/templates](https://github.com/imqueue/templates)

### This website and documentation

Found a typo or inaccuracy in the site or docs? Fixes are very welcome. The site
lives at [imqueue/imqueue.com](https://github.com/imqueue/imqueue.com). It is a
static site built with [Eleventy](https://www.11ty.dev/) and deployed on
Cloudflare Pages; you need [Node.js](https://nodejs.org/) 22.12 or newer.

~~~bash
git clone git@github.com:imqueue/imqueue.com.git
cd imqueue.com
npm install
npm run serve      # local dev server
~~~

Make your corrections, commit (referencing the issue if there is one), push and
open a pull request.

### Tutorial application

To help maintain the example tutorial app, follow the same fork-and-PR flow on
its repositories under the
[imqueue-sandbox](https://github.com/imqueue-sandbox) organization.

## Coding style

- 4 spaces for indentation — no tabs.
- Keep lines within ~80 characters where practical.
- Prefer single quotes `'` over double quotes.
- Use semicolons.
- Use trailing commas in multi-line literals.
- Favor clear, descriptive names over abbreviations.

Thank you for helping improve @imqueue.<br/>
— the @imqueue team
