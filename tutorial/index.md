---
layout: page
title: "Tutorial"
section_id: docs
screens:
  - "register.png"
  - "login.png"
  - "profile-details.png"
  - "profile-garage.png"
  - "time-table.png"
---

<div class="content">
    <div class="special-title centered-text">
        <i class="icon-book goldenrod-text"></i>
        <h1>{{ page.title }}</h1>
        <p>
            Step-by-step guide of building back-end services for car washing
            web application using @imqueue.
        </p>
        <p>
         For those who prefer to learn by example.
        </p>
        <p class="shortline"></p>
        <div class="spacing"></div>
    </div>
</div>
<div class="large-3 columns right panel radius toc" markdown="1">
<h4>Table Of Contents</h4>
<h5>Chapter 1. Introduction</h5>
{:#toc}
* TOC
{:toc}

<h5>Next Chapters</h5>
<div markdown="1">
 - [Chapter 2. User Service. Creating First Service](/tutorial/user-service)
 - [Chapter 3. Auth service. Inter-Service Communication](/tutorial/auth-service)
 - [Chapter 4. Other Services](/tutorial/other-services)
 - [Chapter 5. API. Integration](/tutorial/api-service)
 - [Chapter 6. Deployment](/tutorial/deployment)
</div>
</div>

## Tour Of Cars Washing

Within this tutorial we will learn by example how to build back-end services for
car washing time reservations application, disclosure all fundamentals about
using @imqueue framework.

Here is a visual idea of what our application should look like for the end user.

<div class="row">
<div class="large-8 columns">
    <ul data-orbit="">
        {% for image in page.screens %}
        <li>
            <img src="/images/tutorial/{{image}}">
        </li>
        {% endfor %}
    </ul>
</div>
</div>
<div class="row two spacing"></div>


You can get entire set of tutorial application source codes at
[GitHub](https://github.com/imqueue-sandbox).

## Architecture

By a reason let's assume we decided to build-up our web application using
React/Relay/GraphQL stack of technologies on a Front-End backed by
GraphQL API endpoint in front of @imqueue based services at Back-End.

While a Front-end Team will work on creating specified user interfaces we will
focus in this tutorial on creating back-end services.

Let's agree we suggested to split our back-end system into a set of small
decoupled services, each of which can be developed in a parallel by a small
teams. Due to requirements we decided the following services to be
implemented:

- **User service** - implements user data manipulations. Team choice of
  technologies are: NodeJS/TypeScript, @imqueue over Redis, MongoDB.
- **Auth service** - implements authentication routines. Team choice of
  technologies are: NodeJS/TypeScript, @imqueue over Redis, JSON Web tokens,
  Redis.
- **Car service** - implements cars data service. Team choice of technologies
  are: NodeJS/TypeScript, @imqueue over Redis, static data source with
  custom in-memory data storage.
- **Time-Table service** - time reservations service implementing an ability
  to manage reservation events. Team choice of technologies are:
  NodeJS/TypeScript, @imqueue over Redis, PostgreSQL as data storage engine.
- **API endpoint service** - implements GraphQL endpoint service which
  orchestrates data access to underlying services, described above. Team choice
  of technologies are: NodeJS/TypeScript, @imqueue over Redis to access underlying
  services and graphql, graphql-relay, express, express-graphql for implementing
  GraphQL endpoint access over HTTP/HTTPS.

Hence our high-level architecture of application will look like this:

<p style="text-align:center">
<img src="/images/tutorial/app-hla.svg" alt="App High Level Architecture" />
</p>

## Getting All Benefits

Command line tool for @imqueue provides an ability to integrate 3-rd party
development tools, like Travis CI, DockerHub and GitHub within the default
template, so while the service is created using the tool, we can gain all
benefits of automatically set up repository, continuous integration and docker
image builds with a single command. So what we going to do as a first step is
to install and configure `@imqueue/cli`.

### Preparing Development Environment

Before start we need to set up [NodeJS](https://nodejs.org/). It is
recommended to install it using [NVM](https://github.com/creationix/nvm#installation)

As we agreed, we will also need to have Redis, MongoDB and PostgreSQL
installed. You can install them in your system using any comfortable way, like
using docker images, for example:
[Mongo](https://hub.docker.com/_/mongo/),
[Redis](https://hub.docker.com/_/redis/),
[PostgreSQL](https://hub.docker.com/_/postgres/).

Or just directly install them in your system if there are no objections
doing that.

### Installing @imqueue/cli

As told before, command line tool allows integrations with GitHub, DockerHub and
TravisCI. You may consider CLI to do that or not. If not, it will only create
local folders and files. So during the installation of the tool you have to
make a choice for that.

If you decide to use integrations, you must prepare GitHub and DockerHub
namespaces. For GitHub you should use your user namespace or create an
organisation. The same for DockerHub.

- Go to [GitHub](https://github.com). Create an account or log-in existing.
  Go to "Settings" -> "Organizations". Click "New organisation" and
  create one you will use as a namespace. Or just use your account name as
  namespace for publishing your app repositories. You will also need
  to create an auth token which grants @imqueue/cli to create and write to
  repositories in that namespace. To do that go to "Settings" -> "Developer
  settings" -> "Personal auth token" and create one.
- Go to [DockerHub](https://hub.docker.com/). Create an account or log-in
  existing. Go to "Organizations" tab and add a new organisation which
  you will use as a namespace for publishing your app images.

So, let's start. Just run a command:

~~~
npm i -g @imqueue/cli
~~~

At the end it will launch interactive configuration wizard. Just follow the
steps to complete your @imqueue/cli configuration.

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

After all these preparations done, we are ready to go to create our first
service.

Go to next chapter - [Creating First Service: User Service](/tutorial/user-service).