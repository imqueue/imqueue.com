---
layout: docs
title: "Getting Started"
section_id: docs
icon: rocket
---
<div class="medium-4 columns right panel radius toc" markdown="1">
<h4>Table Of Contents</h4>
{:#toc}
* TOC
{:toc}
</div>

<div class="panel callout secondary">
<p class="lead" markdown="1">
This is basic and shortest step-by-step guide how to start using `@imqueue`.
For more detailed guide take a look at [Tutorial](/tutorial/).
Full API technical documentation can be found [here](/api/). 
</p>
</div>

## Before We Start

Make sure you have all required software pre-installed in your system. Here are
what we need:

 - [NodeJS](https://nodejs.org/en/).We recommend to install it via 
   [NVM](https://github.com/creationix/nvm/blob/master/README.md)
 - [Redis](https://redis.io/download) version 3.2 or above recommended
 - [Git](https://git-scm.com/downloads) command-line tool

## 1. Installing

First it is recommended to install IMQ command line tool globally as:

~~~bash
> npm i -g @imqueue/cli
~~~

During the first installation it will prompt you to enter some initial 
configuration information. Yoy may proceed filling it up or skip it pressing
`<Ctrl>+<C>` and configure it later (or never).

## 2. Configuring

`@imqueue/cli` tool does not require mandatory configuration. By the way
if you going to work on a big project with a large subset of services
it may be useful to define global configuration once and simplify most of
the typing commands in your terminal.

If configuration step was skipped during installation or you need to re-define
existing config, use the following command:

~~~bash
> imq config init
~~~

<div class="row movie">
    <input type="checkbox" id="install-movie">
    <label for="install-movie" class="medium-12 columns">Watch screencast</label>
    <div class="medium-12 columns embed-container">
        <iframe
            src="https://www.youtube.com/embed/4zuAmpeDHM4"
            frameborder="0"
            allow="autoplay; encrypted-media"
            allowfullscreen>
        </iframe>
    </div>
</div>

## 3. Enable Completions

After installation and configuration it is recommended to turn on completions 
support for `imq` command in your terminal. Simply run:

~~~bash
> imq completions on
~~~

and follow further instructions. Currently it supports `bash` and `zsh` 
terminals.

## 4. Usage

IMQ command line tool was created specially free you up from writing
boilerplate when making `@imqueue` based back-end services. There are 2 major
things it can do for you:

1. Create services from pre-defined boilerplate templates
2. Manage clients code generation

### 4.1 Creating Service



### 4.2 Generating client