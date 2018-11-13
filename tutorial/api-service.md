---
layout: page
title: "Tutorial"
section_id: docs
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
<h5>Chapter 5. API Service. Integration</h5>
{:#toc}
* TOC
{:toc}

<h5>Next Chapters</h5>
<div markdown="1">
 - [Chapter 6. Deployment](/tutorial/deployment)
</div>

<h5>Previous Chapters</h5>
<div markdown="1">
 - [Chapter 1. Introduction](/tutorial/)
 - [Chapter 2. User service](/tutorial/user-service)
 - [Chapter 3. Auth service. Inter-Service Communication](/tutorial/auth-service)
 - [Chapter 4. Other services](/tutorial/other-services)
</div>
</div>

<h2>Chapter 5. API Service. Integration</h2>

So here is one of the most interesting parts of our system. API service
is suggested to expose an external HTTP based interface and orchestrate
access to underlying backend services we have been already built.

This combines ideally with such a tool as GraphQL, which could act as
an orchestrator for underlying services, that's why we considering to
choose it.

In this tutorial we do not aim to discuss anything about GraphQL, but
we want to focus on @imqueue integrations. So, if you do not familiar
with GraphQL, consider to learn it using [corresponding](https://graphql.org/learn/)
[resources](https://www.graphql.com/tutorials/), or just skip this part
and refer [existing source code](https://github.com/imqueue-sandbox/api)
of API service we built for you on GitHub.

### Initializing the Service

Despite the fact that API Service differs by its structure and
implementation of what @imqueue usual service is we can re-use
@imqueue/cli to initialize it:

~~~bash
cd ~/my-tutorial-app
imq service create api ./api
~~~

It will install all required dependencies to work with @imqueue. By the
way, we do not need it to be a classic @imqueue service rather than we
need to build it as GraphQL server over HTTP, so we just need to add
required dependencies and re-work start script.

~~~bash
npm i --save express express-graphql graphql graphql-relay \
    graph-fields-list graphql-validity \
    body-parser compression helmet core-js
npm i --save-dev @types/body-parser @types/compression \
    @types/core-js @types/express @types/express-graphql \
    @types/graphql @types/graphql-relay @types/helmet
~~~

> **NOTE!**. It is not principles which stack of technologies you are
> choosing at this point to build-up API service. You may consider to
> choose Apollo GraphQL server instead, or any other solution you may
> prefer. We just giving the official Facebook's stack over express
> with manually selected set of add-ons, but this way is not mandatory.

### RPC Pattern

### Building The Clients

### Querying The Services
