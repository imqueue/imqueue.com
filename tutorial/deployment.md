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
<h5>Chapter 6. Deployment</h5>
{:#toc}
* TOC
{:toc}

<h5>Previous Chapters</h5>
<div markdown="1">
 - [Chapter 1. Introduction](/tutorial/)
 - [Chapter 2. User Service. Creating First Service](/tutorial/user-service)
 - [Chapter 3. Auth service. Inter-Service Communication](/tutorial/auth-service)
 - [Chapter 4. Other Services](/tutorial/other-services)
 - [Chapter 5. API. Integration](/tutorial/api-service)
</div>
</div>

<h2>Chapter 6. Deployment</h2>

In this chapter we would try to cover different aspects and
possibilities related to @imqueue based services deployment.

There are variety of ways to deploy services depending on the needs.
The first need you might have is, of course, development deployment.
Another one case is when you need to deploy production packages.

Contrastingly, the deployment scheme may be different for different types
of environments, like you may need to utilize all physical cores of
some physical or virtual server or you may need to spread across network
many of small containerized images.

Services based on @imqueue are ready to satisfy any of those needs, but
it is up to DevOps and Developer to decide how it should be organized.

By the way, @imqueue/cli default boilerplate template provides some
ready-to-use functionality related to deployment out-of-the-box.

**To have services ready for any kind of scaling them should be
either stateless, or there should be provided corresponding
synchronization mechanisms to share the state between different service
processes or network instances. This should be kept in mind by developer
during the implementation.**

What does that mean on practice?

Lets imagine our service will store in memory some state data, like a
list of authenticated users:

~~~typescript
import { IMQService } from '@imqueue/rpc';

class MyService extends IMQService {
    private usersList: any[] = [];

    @expose()
    public addUser(data: any) {
        this.userList.push(data);
    }
}
~~~

Now each time `addUser()` is called by a remote client our service will
change its internal in-memory state. Unless we will have only one
instance of service running everything will work as expected. By the
way, if we will launch several copies of such service we will get into
trouble. As far as after several calls of `addUser()` by remote
clients internal state of different running copies of the service
will be different. Different unpredictably.

Such kind of behavior is undesired, so either we have to implement
some mechanism allowing us to share state between service copies or
we have to use some external tool to store and change the state, for
example, it could be a database. Usually, own implementation of state
sharing is non-trivial and may fall into causing a lot of side-effects.
Unless you are experienced to understand how it works we would recommend
to design your services as stateless. In this case you won't have any
unexpected behavior of your system during different deployment needs.

For example, in this tutorial, we suggested to implement
[Car Service](https://github.com/imqueue-sandbox/car) as a service
with in-memory car database storage, which is stateful service by
design. However, the car database is predominantly static data, which
we decided to try to update once per 24 hours, and that action should be
done by all running copies almost at the same time and we never change
the stored in-memory data in any other way, only reading from it.
By the way, there are some small side-effects, but we may agree they are
not significant for our system work. It's not good, nor bad, you just
need to understand what you're doing and which consequences this can
have.

### Scaling Options

Services are ready by design to run in multi-process environments. As we
know JavaScript running under NodeJS by its nature is single-threaded,
so one process will utilize only the power of one core. If you deploy
the service on multi-core environment you may want to utilize all
available resources. So, this could be done using corresponding
configuration options. Those options are related to either service, or
client configuration and can be defined via `config.ts` file:

~~~typescript
export const serviceOptions: Partial<IMQClientOptions> = { // or client options as well
    multiProcess: true, // by default is false - turned off
    childrenPerCore: 2, // by default is 1
}
~~~

To enable multi-process run you can set `miltiProcess: true` for your
service or manage this value via external environment variables.
In this case, by default, it will fork a number of service workers
equal to the number of available cores in the system, 1 worker per core.
By fact, in a real-world launch, it may be found that to utilize all
available power you may need to increase number of processes running per
core. Despite the fact that it will increase number of context switching
on each core you may gain overall performance boost of your system. As a
recommendation, you can try to play with `childrenPerCore` values to
experimentally detect the most valuable number of child processes.

Of course, those values can be set either directly on `config.ts` or
managed externally by environment variables.

If your deployment schema based on a small single-core containers there
is, probably, no need to modify multi-process related configuration.
Anyway, exact implementation requires exact testing and experiments.

### Building Containers

Out-of-the-box @imqueue/cli default boilerplate template can be tuned to
build Docker images for your services. This either can be done locally
using corresponding script commands for npm inside service or managed by
TravisCI-based continuous integration processes, or both.

These commands are docker-related and should be available for the
service created by @imqueue/cli:

~~~bash
npm run docker:build
npm run docker:run
npm run docker:stop
npm run docker:ssh
~~~

For local builds it is required, of course, to have docker engine
installed in your system.

Continuous integration builds are enabled if your service was created
using `--dockerize` option and provides correct docker namespace on
DockerHub within `--docker-namespace` option. Those can be pre-set as
a part of imq command line tool global configuration.

TravisCI is configured to build-up a docker image on any commit to
verify if there is no errors.

Image is going to be published to a configured DockerHub namespace in a
case there was set a version tag on a github repository. Dev versions
are usually treated as those which match X.X.X-X semver version format.
Those images will obtain docker dev tag. Docker images tagged as release
versions are made from a builds triggered on a special `release` branch
of git repository.

Usually pre-build docker images can be easily pulled and deployed in
many different cloud environments like AWS, Azure or Google Cloud
Platform. Now it is just a matter of tuning your cloud environment
enabling auto-scaling features and whatever you need else.

There is one important thing to note about running @imqueue clients
in a docker containers. If you're not using custom naming of your
clients, each time client is created it will try to generate a client
unique name based on operating system UUID. As far as all docker images
out-of-the-box will obtain the same OS UUID, you should set it on the
first image build to a unique value. That should be usually done in
`/etc/machine-id` or `/var/lib/dbus/machine-id`, etc. Please, refer
to a documentation related to an OS used as a base image of your container
to find a proper location.

### Environment Variables

Environment variables is a powerful way to separate configuration for
different environments without a need to maintain different configs
codebase. On cloud platforms, like AWS, you may suggest to utilize
Parameter Store to provide environment configuration for your services,
on a local development deployments you may utilize `.env` files to
configure your services specific options.

All that needs some specific configuration to be set on service's
`config.ts`. You can configure available options in a way, when you
try initially to read from environment variables first (which you
are supposed to define yourself) and as a fallback use some default
values. We already discussed these possibilities in
[chapter 2](http://localhost:4000/tutorial/user-service#service-configuration)
of this tutorial.

We strongly recommend to follow the same way any time you want to
introduce some specific configuration to your real-world services,
providing detailed description of which environment vars service
expected to be provided in your README files, so later during
deployment to different environments anyone can easily tune their
setups.

### Development Run

So, we discussed about various different options available during
@imqueue services deployment. As you may see, it is very flexible
solution, allowing you to satisfy any deployment needs to cover
any system load needs, suitable for horizontal scaling, cloud platforms
deployments, etc.

In this tutorial we will focus only on a default development environment
just to make sure you are able to launch the services, which we
deliver as example from our [codebase](https://github.com/imqueue-sandbox).
And make them available to you for learning and experiments.

First what you will need is to clone all repos locally. Let's assume
you will clone all repos in some dedicated local directory,
for example, `~/imqueue-sandbox`:

~~~bash
mkdir ~/imqueue-sandbox
git clone git@github.com:imqueue-sandbox/api.git
git clone git@github.com:imqueue-sandbox/auth.git
git clone git@github.com:imqueue-sandbox/car.git
git clone git@github.com:imqueue-sandbox/time-table.git
git clone git@github.com:imqueue-sandbox/user.git
git clone git@github.com:imqueue-sandbox/web-app.git
~~~

Now you need to make sure you have Redis, MongoDB and PostgreSQL running
locally on your development machine.

You also will need to create database in PostgreSQL with the name `tutmq`
owned by a user `tutmq` identified by a password `tutmq`. Or you would
need to change the configuration of time-table service if you wish to
use other names.

After that simply run the services, each in a new terminal window, or
use screen if you prefer and you have it available on your OS.

~~~bash
cd ~/imqueue-sandbox
cd [service_dir]
npm run dev
~~~

where `[service_dir]` would be one of `user|auth|car|time-table|api`.
As we remember we have cross-communication between user and auth services,
with dynamic client build on run-time, so you have to launch user service
before starting auth service, or you may catch errors.

After launching API service, graphiql web interface should be available
to you at http://localhost:8888/

And we are ready to start React-based web interface for our application.

~~~bash
cd ~/imqueue-sandbox/web-app
npm start
~~~

Now you can play with it at http://localhost:3000/

Happy hacking!