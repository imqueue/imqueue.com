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
some physical or virtual server or you may need to deploy a containerized
images.

Services based on @imqueue are ready to satisfy any of those needs, but
it is up to DevOps and Developer to decide how it should be organized.

By the way, @imqueue/cli default boilerplate template provides some
ready-to-use functionality related to deployment out-of-the-box.

**To have services ready for any kind of horizontal scaling them should be
either stateless, or there should be provided corresponding
synchronization mechanisms to share the state between different service
processes or network instances. This should be kept in mind by developer
during the implementation.**

What does that mean on practice?

TODO: blah-blah-blah...

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
Platform.



### Environment Variables

### Garbage Collection

### Development Deployment

### Production Builds

### Using Docker Images

### AWS: Deploying in Cloud Environments
