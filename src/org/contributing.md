---
layout: docs.html
title: Contributing
docLabel: CONTRIBUTING
lead: "Thanks for your interest in improving @imqueue! Contributions of all kinds are welcome — bug fixes, features, tests and documentation. Because @imqueue is dual-licensed, please read the contribution terms before you start."
description: "How to contribute to @imqueue and the @imqueue Contribution Terms (v1.0): contributions stay GPL-3.0, you keep your copyright, and you grant the owner the right to also license them commercially, royalty-free."
keywords: "contribute to imqueue, imqueue contribution terms, imqueue CLA, dual license contribution, GPL-3.0 commercial license, imqueue pull request, imqueue contributing guide"
relatedTopics: [architecture, dx]
---

[[toc]]

@imqueue is an open-source project. Contributions of all kinds are welcome — bug
fixes, features, tests and documentation. This page mirrors the `CONTRIBUTING.md`
and **@imqueue Contribution Terms** that ship in every
[@imqueue repository](https://github.com/imqueue); the copy in the repository you
contribute to is the authoritative one.

## Contribution terms — please read first

@imqueue is **dual-licensed**: it is free to everyone under **GPL-3.0**, and it is
also offered under **commercial licenses** for closed-source use. To make that
sustainable, contributions are accepted under the **@imqueue Contribution Terms**
(reproduced in full below).

**By opening a pull request — or otherwise contributing — you agree to those
terms.** In short:

- You **keep the copyright** in your contribution.
- Your contribution stays available to everyone under **GPL-3.0**.
- You grant the project owner the right to **also license your contribution
  commercially**, royalty-free — you will not receive a fee for it.

**If you do not agree, please do not contribute.**

## How to contribute

1. **Open an issue first** for anything non-trivial, so we can agree on the
   approach before you invest time. Report issues on the specific package they
   relate to — e.g. [@imqueue/core](https://github.com/imqueue/core/issues),
   [@imqueue/rpc](https://github.com/imqueue/rpc/issues),
   [@imqueue/cli](https://github.com/imqueue/cli/issues).
2. **Fork** the repository and create a topic branch from the default branch
   (e.g. `fix/redis-reconnect` or `feat/lock-timeout`).
3. **Make your change**, following the existing code style. Keep pull requests
   focused — one logical change per PR.
4. **Add or update tests** so the change is covered, and make sure the full suite
   passes locally:
   ~~~bash
   npm ci
   npm test
   ~~~
5. **Write clear commit messages** and a descriptive PR title and summary.
6. **Open the pull request** against the default branch and fill in the PR
   template, including the contribution-terms checkbox.

## Guidelines

- Match the existing TypeScript style and formatting already used in the file you
  are editing.
- Keep public API changes documented (doc-blocks / README as appropriate).
- Be respectful and constructive in reviews and discussions.

## Reporting security issues

Please **do not** open a public issue for security vulnerabilities. Report them
privately to the maintainers (see the repository's
[security policy](https://github.com/imqueue/imqueue.com/security/policy)) so they
can be addressed responsibly.

---

# @imqueue Contribution Terms (v1.0)

These terms apply to every contribution to any repository of the **@imqueue**
project — the packages published under the `@imqueue` npm scope and any repository
in the imqueue GitHub organisation.

**By submitting a contribution — opening a pull request, pushing a commit, sending
a patch, or otherwise offering work for inclusion — you accept these terms in
full. If you do not agree with them, do not contribute.**

In these terms, **"Owner"** means Mykhailo Stadnyk, together with his successors,
assigns and any entity he controls (including VaryLogic s.r.o.), and
**"Contribution"** means any work of authorship — code, documentation or other
material — you submit to an @imqueue repository.

## 1. What you grant

You grant the Owner a **perpetual, worldwide, irrevocable, royalty-free,
non-exclusive, transferable and sublicensable** license to use, reproduce,
modify, adapt, publish, distribute and otherwise exploit your Contribution and
derivative works of it, **and to license and sub-license it under any terms the
Owner chooses — including commercial and proprietary (closed-source) licenses,
without any obligation to release source code.**

In plain terms: the Owner may include your Contribution in @imqueue and **sell
commercial licenses that cover it**, alongside the open-source edition.

## 2. No royalties, fees or compensation

The rights above are granted **free of charge**. You **waive** any right to
royalties, license fees, revenue share or any other compensation arising from the
Owner's use or licensing of your Contribution, including its commercial licensing,
and you agree not to seek any such payment now or in the future.

## 3. You keep your copyright

You **retain ownership** of the copyright in your Contribution and may use it
elsewhere for your own purposes. You are granting the Owner the rights in Section
1 — you are not required to transfer ownership. Your Contribution also remains
available to the public under the repository's open-source license (GPL-3.0).

## 4. Patent license

You grant the Owner and all downstream recipients a perpetual, worldwide,
royalty-free, irrevocable (except as stated) patent license to make, use, sell,
offer to sell, import and transfer your Contribution, limited to the patent claims
you can license that are necessarily infringed by your Contribution alone or in
combination with the project. If you start patent litigation alleging the project
or your Contribution infringes your patents, the patent license you received
terminates.

## 5. Your promises

You confirm that: (a) the Contribution is your own original work, or you have the
right to submit it and to grant these rights; (b) if your employer has any rights
in your work, you have their permission to contribute, or they have waived those
rights; and (c) you have identified any third-party material in your Contribution
and its license.

## 6. Moral rights

To the maximum extent permitted by applicable law, you waive, or agree not to
exercise, any moral rights in your Contribution in a way that would prevent the
Owner from exercising the rights in Section 1. (Certain moral rights are
inalienable under Slovak/EU law; nothing here purports to transfer those.)

## 7. No obligation; "as is"

The Owner is under no obligation to use your Contribution. It is provided **"as
is"**, without warranty of any kind.

## 8. Governing law

These terms are governed by the laws of the Slovak Republic, without regard to its
conflict-of-laws rules.

---

**If you do not agree to all of the above, do not contribute to @imqueue.**
