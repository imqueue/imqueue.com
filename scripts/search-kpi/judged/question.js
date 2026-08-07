// The 115 hand-written chat-shaped questions, re-judged from content.
//
// These are well-formed questions, so most of them have one precise answer rather than a topic. Where
// an indexed anchored section answers the question exactly, that section is the target — a whole
// 5455-word page is the wrong answer to "how do I mount HttpProtect as express middleware". Where the
// answer is a page's whole subject, the page is the target.
//
// One case deliberately targets an /agents/ recipe: "is there a recipe I can hand to an assistant for
// scheduled work" asks for a recipe, and /agents/delayed-scheduled-work/ is that artefact. Everywhere
// else the narrative article wins, because /agents/ says so itself.

'use strict';

const FAQ = '/api/faq/';
const LB = '/blog/load-balancing-microservices-without-a-load-balancer/';
const SD = '/blog/do-nodejs-backends-need-service-discovery/';
const CLIENTS = '/blog/stop-hand-writing-microservice-clients/';

// [query, target, also[], topic]
const QUESTION = [
  // ---- getting started and the CLI
  ['how do I create my first @imqueue service?', '/get-started/',
    ['/tutorial/user-service/', '/cli/creating-services/'], 'getting started'],
  ['what do I need installed before I can use @imqueue?', '/get-started/',
    ['/cli/installation/'], 'getting started'],
  ['how do I run a service on my own machine?', '/get-started/',
    ['/cli/managing-local-services/'], 'getting started'],
  ['how do I install the imq command line tool?', '/cli/installation/', ['/get-started/'], 'cli install'],
  ['can I get tab completion for the imq command?', '/cli/installation/', [], 'cli install'],
  ['which files does the imq tool write to my home directory?', '/cli/installation/',
    ['/blog/isolated-imq-cli-environments/'], 'cli install'],
  ['what is @imqueue actually for?', '/intro/', ['/'], 'what it is'],
  ['where should I start reading the documentation?', '/docs/', [], 'what it is'],
  ['how do I scaffold a service without answering prompts?', '/cli/creating-services/', [], 'scaffolding'],
  ['can I preview what the generator will do before it does it?', '/cli/creating-services/', [], 'scaffolding'],
  ['how do I use my own project template instead of the built-in one?', '/cli/custom-templates/', [], 'templates'],
  ['how do I choose which CI system a new service is set up for?', '/cli/providers/',
    ['/cli/creating-services/'], 'providers'],
  ['how do I point the tooling at our self-hosted GitLab?', '/cli/providers/',
    ['/cli/troubleshooting/'], 'providers'],
  ['where do I put my container registry token?', '/cli/configuration/', ['/cli/providers/'], 'cli config'],
  ['how do I start and stop all my local services at once?', '/cli/managing-local-services/', [], 'local fleet'],
  ['how do I tail the output of several services together?', '/cli/managing-local-services/', [], 'local fleet'],
  ['how do I bump one dependency across every service I own?', '/cli/managing-local-services/',
    ['/cli/real-world-scenarios/'], 'local fleet'],
  ['the generator hangs waiting for input on our build server', '/cli/troubleshooting/',
    ['/cli/creating-services/'], 'cli troubleshooting'],
  ['commit fails saying it cannot detect my email address', '/cli/troubleshooting/', [], 'cli troubleshooting'],
  ['creating the repository comes back with a 403', '/cli/troubleshooting/', [], 'cli troubleshooting'],
  ['how do I override a setting for just one service?', '/cli/configuration/', [], 'cli config'],
  ['how would I teach the tooling about another git host?', '/cli/extensibility/', ['/cli/providers/'], 'extensibility'],
  ['which optional packages can be added for me at generation time?', '/cli/package-catalog/', [], 'addons'],
  ['how do I coordinate a release across several services?', '/cli/clients-and-versioning/',
    ['/cli/real-world-scenarios/'], 'versioning'],

  // ---- defining a service
  ['how do I make a method callable from another service?',
    `${FAQ}#how-do-i-expose-a-service-method-so-it-can-be-called-remotely`, ['/api/'], 'service definition'],
  ['why did my method argument end up typed as any?',
    `${FAQ}#why-must-removecomments-be-false-in-a-project-that-uses-imqueue`, ['/api/'], 'service definition'],
  ['how do I return a class instance over RPC?',
    `${FAQ}#how-do-i-return-a-complex-type-over-rpc-with-classtype-and-property`, ['/api/'], 'service definition'],
  ['how do I declare the fields of an object I send between services?',
    `${FAQ}#how-do-i-return-a-complex-type-over-rpc-with-classtype-and-property`, ['/api/'], 'service definition'],
  ['what does a service class have to extend?', '/api/', ['/glossary/'], 'service definition'],
  ['where do the types in the generated client come from?',
    `${CLIENTS}#why-is-jsdoc-required-if-typescript-already-has-types`, ['/api/'], 'service definition'],
  ['how do I describe a method so the client knows its shape?', '/api/',
    [`${FAQ}#how-do-i-expose-a-service-method-so-it-can-be-called-remotely`], 'service definition'],

  // ---- clients
  ['how do I get a typed client for a service someone else wrote?',
    `${FAQ}#how-do-i-generate-a-typed-client-for-a-running-service`, ['/cli/clients-and-versioning/'], 'clients'],
  ['should I write the client by hand?', CLIENTS, [], 'clients'],
  ['how do I regenerate clients after changing a service?',
    `${CLIENTS}#what-happens-if-i-forget-to-regenerate`, ['/cli/clients-and-versioning/'], 'clients'],
  ['how do I keep callers working when I change a method signature?',
    '/blog/versioning-microservices-without-breaking-callers/', [], 'versioning'],
  ['can two versions of one service run at the same time?',
    '/blog/versioning-microservices-without-breaking-callers/#can-i-run-two-versions-of-the-same-imqueue-service-at-once',
    [], 'versioning'],
  ['what is the difference between a generated client and a dynamic one?', '/glossary/', ['/api/'], 'clients'],

  // ---- delivery, timeouts, throughput
  ['does a message survive a worker crashing mid-call?', '/blog/guaranteed-message-delivery-cost/',
    ['/blog/graceful-shutdown-zero-drop-deploys/'], 'delivery guarantees'],
  ['what does it cost me to turn on guaranteed delivery?', '/blog/guaranteed-message-delivery-cost/',
    ['/blog/benchmarking-imqueue-throughput/'], 'delivery guarantees'],
  ['will the same message ever be handled twice?',
    '/blog/nodejs-service-communication-options-2026/#does-at-least-once-delivery-mean-duplicate-work',
    ['/blog/guaranteed-message-delivery-cost/'], 'delivery guarantees'],
  ['is a failed call retried for me automatically?',
    '/blog/rpc-over-redis-nodejs/#does-imqueue-retry-a-failed-rpc-call', [], 'rpc behaviour'],
  ['how long does a call wait before giving up?', '/glossary/',
    [`${SD}#what-happens-if-a-service-is-down-when-someone-calls-it`], 'rpc behaviour'],
  ['how do I stop one slow consumer from drowning the others?',
    `${LB}#what-if-one-service-instance-is-much-slower-than-the-others`,
    ['/blog/backpressure-nodejs-services/'], 'load balancing'],
  ['how many messages per second can this actually do?', '/blog/benchmarking-imqueue-throughput/', [], 'throughput'],
  ['how do several copies of a service share the work?',
    `${LB}#how-does-a-message-queue-decide-which-service-instance-gets-a-message`, ['/glossary/'], 'load balancing'],

  // ---- delayed and background work
  ['how do I run something a few minutes from now?', '/blog/scheduled-work-without-a-job-system/',
    ['/api/'], 'delayed work'],
  ['do I need a separate job queue for background work?', '/blog/scheduled-work-without-a-job-system/',
    ['/blog/imqueue-vs-bullmq/'], 'delayed work'],
  ['how do I make a task repeat on a schedule?', '/blog/scheduled-work-without-a-job-system/',
    ['/agents/delayed-scheduled-work/'], 'delayed work'],
  ['how do I retry with a backoff I control myself?',
    `${FAQ}#how-do-i-run-a-job-later-with-a-delay-and-retry-it-if-it-fails`,
    ['/blog/imqueue-vs-bullmq/'], 'delayed work'],
  ['should I use this or BullMQ for background jobs?', '/blog/imqueue-vs-bullmq/',
    ['/blog/bullmq-alternatives/'], 'job queue choice'],
  ['how do I push work onto a queue and have a worker pick it up?',
    `${FAQ}#how-do-i-run-a-job-later-with-a-delay-and-retry-it-if-it-fails`,
    ['/blog/imqueue-vs-bullmq/'], 'delayed work'],

  // ---- caching
  ['how do I avoid recomputing an expensive method result?', '/api/',
    ['/blog/rpc-over-redis-nodejs/#how-do-i-stop-duplicate-concurrent-calls-doing-the-same-work-twice'], 'caching'],
  ['how do I invalidate a cached result when the row changes?',
    `${FAQ}#how-do-i-cache-a-service-method-result-and-invalidate-it-when-a-table-row-changes`, [], 'caching'],
  ['how do I drop every cached entry that touches one tag?',
    `${FAQ}#how-do-i-cache-one-value-that-several-unrelated-events-should-invalidate`, [], 'caching'],
  ['can I plug in my own cache backend?', '/api/', [], 'caching'],

  // ---- postgres
  ['how do I react to a row changing in postgres?',
    `${FAQ}#how-do-i-listen-for-postgres-notifications-with-only-one-replica-handling-each`,
    ['/blog/postgres-notify-duplicate-listeners/'], 'postgres'],
  ['every replica gets the same postgres notification, how do I stop that?',
    '/blog/postgres-notify-duplicate-listeners/',
    [`${FAQ}#how-do-i-listen-for-postgres-notifications-with-only-one-replica-handling-each`], 'postgres'],
  ['how do I close postgres listeners cleanly on shutdown?',
    `${FAQ}#how-does-the-pgpubsub-inter-process-lock-work-and-when-should-i-turn-it-off`,
    ['/blog/postgres-notify-duplicate-listeners/'], 'postgres'],
  ['which database layer should I pick for a new service?', '/api/', ['/cli/package-catalog/'], 'data layer'],

  // ---- observability
  ['how do I see where the time goes in a call across services?',
    `${FAQ}#how-do-i-register-opentelemetry-instrumentation-once-at-startup-so-every-rpc-is-traced`,
    ['/api/'], 'observability'],
  ['we already run the datadog agent, what do I install?', '/cli/package-catalog/', ['/api/'], 'observability'],
  ['how do I get structured json logs out of a service?',
    `${FAQ}#how-do-i-write-structured-json-logs-from-a-service-to-a-file`, [], 'logging'],
  ['what name does a traced service report itself under?', '/cli/package-catalog/', [], 'observability'],
  ['how do I know a service is alive without a registry?',
    `${SD}#how-do-i-know-a-service-is-healthy-without-a-registry`,
    [`${FAQ}#how-do-i-auto-scale-imqueue-services`], 'service discovery'],

  // ---- hardening
  ['how do I reject bad input before it reaches my method?',
    `${FAQ}#how-do-i-validate-method-arguments-with-decorators-before-the-method-runs`, [], 'validation'],
  ['how do I rate limit callers by ip address?',
    `${FAQ}#how-do-i-protect-an-http-gateway-from-too-many-requests-per-ip`, [], 'hardening'],
  ['how do I check whether an address is inside a subnet?',
    `${FAQ}#how-do-i-check-whether-an-ip-address-is-inside-a-cidr-range`, [], 'networking'],

  // ---- running it
  ['how do I shut a service down without dropping in-flight work?',
    '/blog/graceful-shutdown-zero-drop-deploys/', [], 'graceful shutdown'],
  ['how do I deploy this with docker?', '/tutorial/deployment/', [], 'deployment'],
  ['how do I add more capacity when traffic grows?', `${LB}#how-do-i-scale-an-imqueue-service`,
    [`${FAQ}#how-do-i-auto-scale-imqueue-services`], 'scaling'],
  ['which environment variables does a service read?', '/api/', ['/cli/configuration/'], 'configuration'],
  ['do I need a load balancer in front of my services?', `${LB}#do-i-still-need-a-load-balancer-anywhere`,
    [LB], 'load balancing'],
  ['how do I scale the redis broker itself?', `${FAQ}#how-do-i-auto-scale-the-imqueue-broker`,
    ['/blog/horizontally-scalable-redis-broker/'], 'scaling'],

  // ---- testing
  ['how do I test a service that calls three others?',
    '/blog/testing-microservices-without-the-whole-stack/', [], 'testing services'],
  ['is there a way to run one service without booting everything?',
    '/blog/testing-microservices-without-the-whole-stack/', ['/cli/managing-local-services/'], 'testing services'],

  // ---- comparisons
  ['how is this different from nestjs microservices?', '/blog/imqueue-vs-nestjs/', ['/compare/'], 'nestjs'],
  ['why not just use nats?', '/blog/imqueue-vs-nats/', ['/compare/'], 'nats'],
  ['why would I pick this over grpc?', '/blog/grpc-vs-message-queue-rpc/', ['/compare/'], 'grpc'],
  ['how does this compare to trpc?', '/blog/imqueue-vs-trpc/', ['/compare/'], 'trpc'],
  ['what about moleculer, can I migrate off it gradually?',
    '/blog/imqueue-vs-moleculer/#can-i-migrate-from-moleculer-to-imqueue-incrementally',
    ['/blog/imqueue-vs-moleculer/'], 'moleculer'],
  ['when is this the wrong tool for the job?',
    '/blog/nodejs-service-communication-options-2026/#when-is-imqueue-the-wrong-choice',
    ['/compare/', '/'], 'fit'],
  ['which of these options needs the least infrastructure?',
    '/compare/#which-option-needs-the-least-infrastructure', ['/compare/'], 'fit'],
  ['what are my options for services talking to each other in node?',
    '/blog/nodejs-service-communication-options-2026/', ['/compare/'], 'service communication'],
  ['do I have to expose REST between my own services?', '/blog/internal-apis-dont-need-rest/', [], 'rest'],

  // ---- architecture
  ['how do I pull the first service out of a monolith safely?',
    '/blog/monolith-to-services-first-extraction/', [], 'monolith to services'],
  ['do I need consul or etcd for service discovery?',
    `${SD}#is-a-message-queue-a-replacement-for-consul-or-etcd`, [SD], 'service discovery'],
  ['what patterns does redis give me beyond publish and subscribe?',
    '/blog/redis-message-bus-patterns/', [], 'redis message bus'],
  ['how much boilerplate does this actually remove?',
    '/blog/cutting-boilerplate-nodejs-microservices/', [CLIENTS], 'boilerplate'],
  ['how do I do request and reply over a message queue?',
    '/blog/rpc-over-message-queue-nodejs/', ['/blog/rpc-over-redis-nodejs/'], 'rpc'],
  ['how do I keep types in step across service boundaries?',
    '/blog/type-safe-service-communication-typescript/', [CLIENTS], 'type safety'],
  ['is there a single broker everything goes through?', '/intro/', ['/blog/horizontally-scalable-redis-broker/'], 'architecture'],

  // ---- the tutorial
  ['how do I put a graphql gateway in front of my services?', '/tutorial/api-service/', [], 'api gateway'],
  ['how do I call one service from inside another?', '/tutorial/auth-service/', ['/api/'], 'tutorial'],
  ['is there a worked example I can follow end to end?', '/tutorial/', ['/get-started/'], 'tutorial'],
  ['how do I add a REST front door instead of graphql?', '/tutorial/rest-api/', [], 'api gateway'],
  ['how do I wire a react front end to this?', '/tutorial/rest-web-app/', [], 'tutorial'],
  ['how do I set up the database for a domain service?', '/tutorial/other-services/', ['/api/'], 'data layer'],

  // ---- agents
  ['how do I let my coding agent read these docs?', '/using-ai-assistants/', ['/mcp/'], 'ai assistants'],
  ['how do I add this to cursor?', '/mcp/installation/', ['/mcp/'], 'mcp installation'],
  ['should my agent use the hosted endpoint or run it locally?',
    '/mcp/security/#local-or-hosted-which-should-you-use', ['/mcp/'], 'mcp security'],
  ['what can the agent actually change on my machine?', '/mcp/tools/', ['/mcp/security/'], 'mcp tools'],
  ['which tools does the server give my agent?', '/mcp/tools/', ['/mcp/'], 'mcp tools'],
  ['does it still work with no network?',
    '/mcp/security/#does-it-keep-working-offline-or-behind-a-corporate-firewall', ['/mcp/'], 'mcp security'],
  ['what should I ask my assistant to do first?', '/mcp/workflows/', ['/using-ai-assistants/'], 'mcp workflows'],

  // ---- vocabulary
  ['what does self-describing mean here?', '/glossary/', ['/intro/'], 'glossary'],
  ['what is a fleet?', '/glossary/', ['/cli/managing-local-services/'], 'glossary'],
  ['what do you mean by competing consumers?', '/glossary/', [LB], 'glossary'],
  ['what is an addon package?', '/glossary/', ['/cli/package-catalog/'], 'glossary'],
  ['what is a provider axis?', '/glossary/', ['/cli/creating-services/'], 'glossary'],

  // ---- isolated environments, recipes, project
  ['how do I give each project its own isolated imq setup?',
    '/blog/isolated-imq-cli-environments/', ['/agents/isolated-imq-environments/'], 'isolated cli'],
  ['how do I run two fleets side by side without them clashing?',
    '/blog/isolated-imq-cli-environments/', ['/agents/isolated-imq-environments/'], 'isolated cli'],
  // asks for a recipe to hand to an assistant, which is exactly what /agents/ pages are
  ['is there a recipe I can hand to an assistant for scheduled work?',
    '/agents/delayed-scheduled-work/', ['/blog/scheduled-work-without-a-job-system/'], 'agent recipes'],
  ['how do I report a security problem?', '/support/', ['/contact/', '/contributing/'], 'project'],
  ['where do I ask a question or file a bug?', '/support/', ['/contact/'], 'project'],
  ['how do I contribute a change?', '/contributing/', ['/support/'], 'project'],
];

module.exports = { QUESTION };
