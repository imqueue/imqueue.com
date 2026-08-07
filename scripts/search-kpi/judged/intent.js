// The 19 intent queries — real `search_docs` calls made by an agent building the car-wash fleet.
// These are the ones I contaminated: last time I made the API reference page the target because
// accepting the FAQ "would saturate the metric". That is picking a label from the ranker's behaviour.
//
// Judged from content this time, and the content is unambiguous: EVERY ONE of these 19 is a
// near-verbatim restatement of an /api/faq/ section heading, and each of those sections is a separate
// indexed record with its own anchor. The section is not merely relevant — it IS the question, and it
// carries the working code, the failure modes, and links to every symbol it names.
//
//   query                                                    matching FAQ heading
//   "expose a service method so it can be called remotely"    "How do I expose a service method so it
//                                                              can be called remotely?"
//   "validate method arguments with decorators before the     identical wording
//    method runs"
//   ...and so on for 18 of the 19.
//
// So the target is the ANCHORED SECTION, not the page and not the reference. Section-level targeting
// is available — 110 records in the index carry a #fragment — and using it is the whole point: the
// answer to "how do I mount HttpProtect as express middleware" is one section, not a 5455-word page.
//
// ONE EXCEPTION, decided by content precedence (a page dedicated to the exact question beats the FAQ
// section that summarises it): "build my first TypeScript RPC service step by step" is answered in
// five commands by the FAQ, and in 3227 words by /tutorial/user-service/, whose H1 is "Build your
// first TypeScript RPC service". The tutorial chapter is the step-by-step; the FAQ is the summary.
//
// The API reference page for the symbol each answer names stays as `mustReach` — it must remain
// findable from the query that needed it, and that is reported as its own number rather than folded
// into P@1. That split is what exposed nine unreachable reference pages last time, a real defect the
// mislabelled 5.3% had been hiding.

'use strict';

const FAQ = '/api/faq/';

// [query, target, also[], topic, mustReach]
const INTENT = [
  ['build my first TypeScript RPC service step by step',
    '/tutorial/user-service/',
    [`${FAQ}#how-do-i-build-my-first-typescript-rpc-service-step-by-step`, '/get-started/'],
    'tutorial', null],

  ['expose a service method so it can be called remotely',
    `${FAQ}#how-do-i-expose-a-service-method-so-it-can-be-called-remotely`,
    ['/api/', '/glossary/'],
    'service definition', '/api/rpc/latest/rpc.expose/'],

  ['classType property decorators complex return type over RPC',
    `${FAQ}#how-do-i-return-a-complex-type-over-rpc-with-classtype-and-property`,
    ['/api/'],
    'service definition', '/api/rpc/latest/rpc.classtype/'],

  ['removeComments must be false because JSDoc is the runtime type source',
    `${FAQ}#why-must-removecomments-be-false-in-a-project-that-uses-imqueue`,
    ['/api/'],
    'service definition', '/api/rpc/latest/'],

  ['generate a typed client for a running service',
    `${FAQ}#how-do-i-generate-a-typed-client-for-a-running-service`,
    ['/cli/clients-and-versioning/', '/blog/stop-hand-writing-microservice-clients/'],
    'clients', '/cli/clients-and-versioning/'],

  ['validate method arguments with decorators before the method runs',
    `${FAQ}#how-do-i-validate-method-arguments-with-decorators-before-the-method-runs`,
    [],
    'validation', '/api/validation/latest/'],

  ['cache a service method result and invalidate it when a table row changes',
    `${FAQ}#how-do-i-cache-a-service-method-result-and-invalidate-it-when-a-table-row-changes`,
    [],
    'caching', '/api/pg-cache/latest/'],

  ['pg-cache cacheBy decorator',
    `${FAQ}#what-does-the-pg-cache-cacheby-decorator-do-that-cachewith-does-not`,
    [],
    'caching', '/api/pg-cache/latest/pg-cache.cacheby/'],

  ['tagged cache one value invalidated by several unrelated events',
    `${FAQ}#how-do-i-cache-one-value-that-several-unrelated-events-should-invalidate`,
    [],
    'caching', '/api/tag-cache/latest/'],

  ['run a job later with a delay and retry it if it fails',
    `${FAQ}#how-do-i-run-a-job-later-with-a-delay-and-retry-it-if-it-fails`,
    ['/blog/scheduled-work-without-a-job-system/', '/blog/imqueue-vs-bullmq/'],
    'delays and jobs', '/api/job/latest/'],

  ['listen for postgres notifications with only one replica handling each',
    `${FAQ}#how-do-i-listen-for-postgres-notifications-with-only-one-replica-handling-each`,
    ['/blog/postgres-notify-duplicate-listeners/'],
    'postgres', '/api/pg-pubsub/latest/'],

  ['PgPubSub inter-process lock so only one instance handles a notification',
    `${FAQ}#how-does-the-pgpubsub-inter-process-lock-work-and-when-should-i-turn-it-off`,
    ['/blog/postgres-notify-duplicate-listeners/'],
    'postgres', '/api/pg-pubsub/latest/pg-pubsub.pgiplock/'],

  ['avoid N+1 service calls when resolving nested GraphQL fields',
    `${FAQ}#how-do-i-avoid-n-1-service-calls-when-resolving-nested-graphql-fields`,
    [],
    'graphql', '/api/graphql-dependency/latest/'],

  ['register OpenTelemetry instrumentation once at startup so every RPC is traced',
    `${FAQ}#how-do-i-register-opentelemetry-instrumentation-once-at-startup-so-every-rpc-is-traced`,
    [],
    'observability', '/api/opentelemetry/latest/'],

  ['write structured JSON logs from a service to a file',
    `${FAQ}#how-do-i-write-structured-json-logs-from-a-service-to-a-file`,
    [],
    'logging', '/api/async-logger/latest/'],

  ['async-logger Logger transports configuration',
    `${FAQ}#how-do-i-configure-async-logger-logger-transports`,
    [],
    'logging', '/api/async-logger/latest/async-logger.logger/'],

  ['protect an HTTP gateway from too many requests per IP',
    `${FAQ}#how-do-i-protect-an-http-gateway-from-too-many-requests-per-ip`,
    [],
    'hardening', '/api/http-protect/latest/'],

  ['HttpProtect middleware mount express',
    `${FAQ}#how-do-i-mount-httpprotect-as-express-middleware`,
    [],
    'hardening', '/api/http-protect/latest/http-protect.httpprotect/'],

  ['check whether an IP address is inside a CIDR range',
    `${FAQ}#how-do-i-check-whether-an-ip-address-is-inside-a-cidr-range`,
    [],
    'networking', '/api/net/latest/'],
];

module.exports = { INTENT };
