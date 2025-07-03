---
layout: page
title: "Contributing"
section_id: contribute
---

<div class="content">
    <div class="special-title centered-text">
        <i class="icon-publish goldenrod-text"></i>
        <h1>{{ page.title }}</h1>
        <p class="shortline"></p>
        <div class="spacing"></div>
    </div>
</div>

@imqueue is an Open Source project under GPL 3.0 license, so we greatly
appreciate anyone who has a will to contribute to this project in order to
make it better. Please, consider you have a will to contribute under
the terms of this license. If you report issues, create pull
requests or provide your work in any other possible way to our repos,
we consider you automatically agree with the stated terms.

If you do not agree, please, do not report us any issues, do not create
pull requests and do not send us any kind of your work as contribution
to our repos.

## Issues

We greatly appreciate all reported issues found on different
packages related to @imqueue. Consider reporting issues directly to
those packages they are related to:

 - [@imqueue/core issues](https://github.com/imqueue/core/issues)
 - [@imqueue/rpc issues](https://github.com/imqueue/rpc/issues)
 - [@imqueue/cli issues](https://github.com/imqueue/cli/issues)
 - [@imqueue/templates issues](https://github.com/imqueue/templates/issues)
 - [This website issues](https://github.com/imqueue/imqueue.com/issues)

## Pull Requests

We actively welcome your pull requests to all related repositories. If
you find it is possible for you to contribute code changes, please,
fork, make changes and pull request those changes to our repositories.

Fork exact repo by using the "Fork" button in the upper-right toolbar
on GitHub.

Check out your fork
~~~bash
git clone git@github.com:imqueue/[repo_name].git
~~~

Install or update dependencies
~~~bash
npm i
~~~

Write your code and/or modify existing. Then ensure you changes passes
tests. Use:

~~~bash
npm run test-fast
~~~

for core packages, for other consider using:

~~~bash
npm test
~~~

If you solve the exact known issue from the repo you forked, please, refer
it within commit message when committing.

Create pull request.

### Core Packages

 - [@imqueue/core](https://github.com/imqueue/core)
 - [@imqueue/rpc](https://github.com/imqueue/rpc)
 - [@imqueue/cli](https://github.com/imqueue/cli)
 - [@imqueue/templates](https://github.com/imqueue/templates)

### This Website and Documentation

If you found any inconsistencies on this website and published on it
documentation and have a will to contribute your corrections, you are
very welcome to do that.

Go to [imqueue/imqueue.com](https://github.com/imqueue/imqueue.com)
repository. Fork it to your space.

Check out your fork
~~~bash
git clone git@github.com:imqueue/imqueue.com.git
~~~

The website is based on GitHub Pages and Jekyll. Refer the corresponding
[documentation](https://help.github.com/articles/setting-up-your-github-pages-site-locally-with-jekyll/)
about preparing local environment.

Easy way should be if you have ruby installed in your system.
Then just go to your local working copy of the repo and run:
~~~bash
gem install bundler
bundle install
~~~

Now you can start your local development copy of the website:
~~~bash
npm start
~~~

Make your corrections, coding add-ons to the website and docs.
Commit your changes. If you're working on the known issue from source
repo, please, refer it within your commit message.

Push & create pull request.

### Tutorial Application

If you've found any inconsistencies or just want to help us maintain our
example tutorial app, please, do the same way as described above for its
repos, located under [imqueue-sandbox](https://github.com/imqueue-sandbox)
space on GitHub.

## Coding Style

- 4 spaces for indentation (no tabs)
- 80 character line length strongly preferred
- Prefer ' over "
- Use semicolons;
- Use trailing commas,
- Avd abbr wrds.

Sincerely Yours,<br/>
@imqueue Team
