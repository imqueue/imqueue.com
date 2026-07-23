---
chapter: 6
title: Deployment
docLabel: TUTORIAL — CHAPTER 6
lead: "Ship your services: per-service Docker images, environment-based configuration, and horizontal scaling for any load."
description: "Ship your @imqueue services to production: Docker images per service, environment configuration, and horizontal auto-scaling for any load."
keywords: "@imqueue deployment, deploy Node.js microservices, Docker microservices, horizontal scaling, scale microservices, production Node.js services, containerize TypeScript service"
ogType: article
---

This chapter covers the various aspects of deploying @imqueue-based services.

There are many ways to deploy, depending on your needs. The most immediate is
development deployment; another is shipping production packages. The deployment
scheme also varies by environment — you might want to use every physical core of
a single server, or spread many small containerised images across a network.

@imqueue-based services are ready to meet any of these needs, but it's up to your
developers and DevOps to decide how. The @imqueue/cli default template also
provides some ready-to-use deployment functionality out of the box.

**For services to scale in any direction, they must either be stateless or
provide a mechanism to synchronise state across processes and network instances.
Keep this in mind throughout implementation.**

What does that mean in practice?

Imagine a service that keeps some state in memory — say, the list of
authenticated users:

~~~typescript
import { IMQService, expose } from '@imqueue/rpc';

class MyService extends IMQService {
    private usersList: any[] = [];

    @expose()
    public addUser(data: any) {
        this.usersList.push(data);
    }
}
~~~

Each time a remote client calls `addUser()`, the service mutates its in-memory
state. With a single instance running, this works fine. But launch several copies
and you're in trouble: after a few `addUser()` calls, each copy holds a different
internal state — and the divergence is unpredictable.

That's undesirable, so you must either implement a mechanism to share state
between copies, or store and mutate the state in an external tool such as a
database. Rolling your own state-sharing is usually non-trivial and prone to
side-effects, so unless you're confident in how it works, we recommend designing
your services to be stateless. Stateless services behave predictably across every
deployment scenario.

For example, this tutorial suggests implementing the
[Car service](https://github.com/imqueue-sandbox/car) with an in-memory car
database, which is stateful by design. But that database is largely static data:
we refresh it roughly once every 24 hours, all running copies do so at about the
same time, and we otherwise only read from it. There are minor side-effects, but
they're insignificant for this system. It's neither good nor bad — you just need
to understand what you're doing and what the consequences are.

### Scaling options

Services are designed to run in multi-process environments. Since JavaScript on
Node.js is single-threaded by nature, one process uses the power of only one
core. On a multi-core machine you'll usually want to use all available cores,
which you can do with a couple of configuration options. These are service (or
client) options, and can be set in `config.ts`:

~~~typescript
export const serviceOptions: Partial<IMQServiceOptions> = {
    multiProcess: true,  // default: false — turned off
    childrenPerCore: 2,  // default: 1
};
~~~

Set `multiProcess: true` to enable multi-process mode (or manage the value
through environment variables). By default this forks one worker per available
core. In real-world runs you may find that using all available capacity requires
more than one process per core: increasing `childrenPerCore` adds more context
switching per core but can still yield an overall performance gain. Treat it as a
tuning knob — experiment to find the value that works best for your workload.

If your deployment is based on small single-core containers, you probably don't
need to touch the multi-process options at all. Either way, the right settings
come from testing and experimentation.

### Building containers

The @imqueue/cli default template gives each service a `Dockerfile` and a set of
Docker npm scripts, so you can build and run an image for any service locally:

~~~bash
npm run docker:build
npm run docker:run
npm run docker:stop
npm run docker:ssh
~~~

Local builds require, of course, a Docker engine installed on your machine.

Continuous integration runs on GitHub Actions. Every service created by
@imqueue/cli ships a `.github/workflows/build.yml` that, on each push and pull
request, installs dependencies and runs the test suite across the current LTS
and latest Node.js versions — verifying the build stays green. (Which CI
provider is wired in depends on how you configured the tool; GitHub Actions is
the default, with CircleCI and Travis also available.)

Building and publishing images to a container registry is left to your own
deployment pipeline — run `npm run docker:build` there and push the resulting
image. Pre-built Docker images can then be pulled and deployed across many cloud
environments — AWS, Azure, Google Cloud Platform and others. From there it's a
matter of configuring your cloud environment: enabling auto-scaling and anything
else you need.

One important note about running @imqueue clients in Docker containers: unless
you name your clients explicitly, each client generates a unique name based on
the operating system's UUID. Since Docker images share the same OS UUID out of
the box, you should set a unique value on the first image build — usually in
`/etc/machine-id` or `/var/lib/dbus/machine-id`. Consult the documentation for
your container's base OS to find the correct location.

### Environment variables

Environment variables are a powerful way to separate configuration across
environments without maintaining multiple config codebases. On cloud platforms
such as AWS you might use Parameter Store to supply configuration, while for local
development you can use `.env` files.

This requires some setup in the service's `config.ts`. Configure each option to
read from an environment variable first (which you define yourself) and fall back
to a default value. We covered this in
[chapter 2](/tutorial/user-service#configuring-the-service).

We strongly recommend following the same approach for any configuration in your
real-world services, and documenting the expected environment variables in your
README files — so that anyone deploying to a new environment can tune their setup
easily.

### Running it locally

We've covered the many options available when deploying @imqueue services. As you
can see, it's a flexible solution, able to satisfy any load and suitable for
horizontal scaling and cloud deployments.

For this tutorial we'll focus on the default development environment, so you can
run the example services from our
[codebase](https://github.com/imqueue-sandbox) and experiment with them.

First, clone all the repositories locally. Let's assume a dedicated directory,
for example `~/imqueue-sandbox`:

~~~bash
mkdir ~/imqueue-sandbox
cd ~/imqueue-sandbox
git clone git@github.com:imqueue-sandbox/api.git
git clone git@github.com:imqueue-sandbox/auth.git
git clone git@github.com:imqueue-sandbox/car.git
git clone git@github.com:imqueue-sandbox/time-table.git
git clone git@github.com:imqueue-sandbox/user.git
git clone git@github.com:imqueue-sandbox/web-app.git
~~~

Next, make sure Redis, MongoDB and PostgreSQL are running on your development
machine.

You'll also need a PostgreSQL database named `tutmq`, owned by a user `tutmq`
with the password `tutmq` — or change the time-table service's configuration to
use different names.

Then run each service in its own terminal window (or use a multiplexer such as
`screen` or `tmux` if you prefer):

~~~bash
cd ~/imqueue-sandbox/[service_dir]
npm run dev
~~~

where `[service_dir]` is one of `user`, `auth`, `car`, `time-table` or `api`.
The services talk to each other over the message queue and ship pre-generated
static clients, so you can start them in any order — a service simply queues its
calls until the peer it needs becomes available.

Once the API service is running, the GraphiQL web interface is available at
[http://localhost:8888/](http://localhost:8888/).

Finally, start the React-based web interface:

~~~bash
cd ~/imqueue-sandbox/web-app
npm start
~~~

You can now use the application at
[http://localhost:3000/](http://localhost:3000/).

Happy hacking!
