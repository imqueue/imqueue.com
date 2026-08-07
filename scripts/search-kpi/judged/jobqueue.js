// Job-queue cluster — 348 queries (bullmq / bull / bee-queue / agenda / pg-boss / kue / graphile),
// judged after reading both pages in full.
//
// /blog/bullmq-alternatives/ is a LANDSCAPE page. It opens by saying what BullMQ is (~500K weekly
// downloads, the Redis default), then gives a seven-row table — BullMQ, Bee-Queue, pg-boss, Agenda,
// @imqueue/job, cloud queues, Bull v3 — with datastore, best-for and LICENCE for each; a section per
// option including pg-boss vs Graphile Worker (both SKIP LOCKED) and "Kue is deprecated"; a section
// arguing Kafka / RabbitMQ / Redis pub-sub are a different layer, not alternatives; a decision guide;
// and five FAQ answers including "job queue or workflow engine" (which names Temporal).
//
// /blog/imqueue-vs-bullmq/ is a HEAD-TO-HEAD. It has whole sections on delayed & scheduled delivery
// (all three layers), on retries and backoff (return-a-delay vs BullMQ's declarative policy), a
// "Where BullMQ goes further" list naming dead-lettering, priorities, repeatable/cron, rate limiting,
// flows and progress/dashboards, and a feature table with rows for guaranteed delivery, concurrent
// workers, delayed jobs and job TTL.
//
// THE LINE THIS CLUSTER TURNS ON, and it is a fact about these two pages: neither one teaches
// BullMQ's API. They compare capabilities and help you choose. So a query about which queue to use,
// or about a capability the head-to-head has a section for, has a real answer here. A query about
// BullMQ's own syntax, options, errors, deployment or ecosystem does not — no page on this site
// documents another library's API, and returning a comparison page to someone who wants
// `queue.add()` would be the wrong answer, not a near miss.

'use strict';

// Choosing between queues, and what the landscape is.
const CHOOSING = [
  'alternative for bullmq', 'alternative of bullmq', 'alternative to bullmq',
  'bullmq alternative nodejs', 'bullmq alternative reddit', 'bullmq alternative without redis',
  'bullmq alternatives', 'bullmq alternatives reddit', 'bullmq free alternative',
  'bullmq pro alternative', 'bullmq redis alternative', 'bullmq without redis',
  'nestjs bullmq alternative', 'pg-boss alternative',
  // Bull v3 vs BullMQ — "The predecessor" section answers exactly this
  'bull js vs bullmq', 'bull or bullmq', 'bull queue vs bullmq', 'bull vs bullmq',
  'bull vs bullmq nestjs', 'bullmq bull', 'bullmq or bull', 'bullmq vs bull',
  'bullmq vs bull js', 'nestjs bullmq vs bull', 'npm bull vs bullmq',
  'bullmq vs bullmq pro',
  // the Postgres options, including the pg-boss vs Graphile Worker subsection
  'graphile worker vs pg-boss', 'pg boss vs graphile', 'pg boss vs', 'pg-boss',
  'bullmq vs graphile worker', 'how does pg boss work', 'bullmq with postgres',
  'bullmq postgres', 'pg boss vs rabbitmq', 'pg boss vs redis',
  // "What about Kafka, RabbitMQ or Redis pub/sub?" — the different-layer section
  'bullmq and rabbitmq', 'bullmq kafka', 'bullmq or kafka', 'bullmq or rabbitmq',
  'bullmq vs kafka', 'bullmq vs kafka vs rabbitmq', 'bullmq vs pubsub',
  'bullmq vs rabbitmq', 'bullmq vs rabbitmq performance', 'bullmq vs rabbitmq reddit',
  'bullmq vs rabbitmq vs kafka', 'bullmq vs rabbitmq vs redis', 'bullmq vs rabbitmq vs sqs',
  'bullmq vs redis', 'bullmq vs redis pub sub', 'bullmq vs redis queue',
  'bullmq vs redis streams', 'bullmq x rabbitmq', 'bullmq or redis',
  'redis bullmq vs kafka', 'redis y bullmq', 'bullmq and redis', 'bullmq on redis',
  'bullmq with redis', 'bullmq redis',
  // managed queues and workflow engines — both are rows/FAQ answers on the page
  'bullmq vs aws sqs', 'bullmq vs cloud tasks', 'bullmq vs sqs', 'bullmq or sqs',
  'bullmq sqs', 'bullmq vs temporal', 'bullmq or temporal', 'bullmq vs agenda',
  'bullmq vs',
  // what BullMQ is, and the licence column
  'bullmq', 'bullmq what is it', 'bullmq meaning', 'bullmq explained',
  'bullmq is used for', 'bullmq used for', 'bullmq use cases', 'bullmq full form',
  'bullmq que es', 'bullmq how it works', 'bullmq message queue', 'bullmq job queue',
  'bullmq queue', 'bullmq job', 'bullmq license', 'bullmq is free', 'bullmq free',
  'bullmq is open source', 'bullmq open source', 'bullmq js', 'bullmq node',
  'bullmq nodejs', 'bullmq in node js',
];

// A capability the head-to-head compares directly, section by section.
const CAPABILITY = [
  'bullmq attempts', 'bullmq backoff', 'bullmq exponential backoff', 'bullmq retry',
  'bullmq retry failed job', 'bullmq dead letter queue', 'bullmq dlq',
  'bullmq delay', 'bullmq delayed jobs', 'bullmq scheduled jobs', 'bullmq scheduler',
  'bullmq queue scheduler', 'bullmq repeatable jobs', 'bullmq priority',
  'bullmq priority queue', 'bullmq queue priority', 'bullmq rate limit', 'bullmq limiter',
  'bullmq throttling', 'bullmq flows', 'bullmq flow producer', 'bullmq child jobs',
  'bullmq waiting children', 'bullmq workflows', 'bullmq board', 'bullmq bull board',
  'bullmq dashboard', 'bullmq ui', 'bullmq ui dashboard', 'bullmq gui', 'bullmq job progress',
  'bullmq update progress', 'bullmq stalled', 'bullmq stalled job', 'bullmq ttl',
  'bullmq concurrency', 'bullmq worker concurrency', 'bullmq queue concurrency',
  'bullmq global concurrency', 'bullmq multiple workers', 'bullmq multiple consumers',
  'bullmq worker', 'bullmq persistence',
];

// Queue-versus-cron is what "delayed and scheduled work without adding a job system" argues about:
// its "Recurrence, honestly" and "When a job system is the right call" sections are the answer.
const VS_CRON = ['bullmq vs cron', 'bullmq vs cronjob', 'bullmq vs node cron'];

// ---------------------------------------------------------------- NEGATIVE

// BullMQ's own API, options, error messages and operations. No page here documents them.
const OWN_API = [
  'bullmq add job', 'bullmq api', 'bullmq architecture', 'bullmq batch',
  'bullmq batch processing', 'bullmq best practices', 'bullmq cancel job', 'bullmq cli',
  'bullmq cluster mode', 'bullmq deduplication', 'bullmq error handling',
  'bullmq event listener', 'bullmq events', 'bullmq examples', 'bullmq failed vs error',
  'bullmq fifo', 'bullmq get job by id', 'bullmq group key', 'bullmq groups',
  'bullmq health check', 'bullmq high memory usage', 'bullmq hooks',
  'bullmq horizontal scaling', 'bullmq how many queues', 'bullmq how many workers',
  'bullmq install', 'bullmq interface', 'bullmq ioredis', 'bullmq job options',
  'bullmq job timeout', 'bullmq jobid', 'bullmq lock duration', 'bullmq logs',
  'bullmq long running job', 'bullmq metrics', 'bullmq missing key for job',
  'bullmq missing lock for job', 'bullmq monitoring', 'bullmq observability',
  'bullmq on error', 'bullmq on failed', 'bullmq opentelemetry', 'bullmq options',
  'bullmq queue close', 'bullmq queue events',
  'bullmq queue name cannot contain', 'bullmq queue options', 'bullmq queue.add',
  'bullmq redis keys', 'bullmq remove job', 'bullmq sandboxed worker', 'bullmq setup',
  'bullmq status', 'bullmq telemetry', 'bullmq testing', 'bullmq timeout',
  'bullmq timeout job', 'bullmq tls', 'bullmq types', 'bullmq typescript',
  'bullmq update job data', 'bullmq usage', 'bullmq worker events', 'bullmq zod',
  'bullmq latest version', 'bullmq cron', 'bullmq cron job',
];

// Deploying or hosting BullMQ somewhere, or pairing it with another runtime or store.
const OWN_OPS = [
  'bullmq aws', 'bullmq bun', 'bullmq bun redis', 'bullmq cloud',
  'bullmq dashboard docker', 'bullmq docker', 'bullmq and dragonfly', 'bullmq express',
  'bullmq expressjs', 'bullmq fastify', 'bullmq frontend', 'bullmq grafana',
  'bullmq grafana dashboard', 'bullmq heroku', 'bullmq hosting', 'bullmq in nestjs',
  'bullmq kubernetes', 'bullmq mongodb', 'bullmq nest', 'bullmq nestjs',
  'bullmq nestjs example', 'bullmq nextjs', 'bullmq node redis', 'bullmq on aws',
  'bullmq on vercel', 'bullmq proxy', 'bullmq railway', 'bullmq redis nodejs',
  'bullmq sqlite', 'bullmq ui docker', 'bullmq upstash', 'bullmq upstash redis',
  'bullmq workbench', 'bullmq board nestjs', 'nestjs bullmq vs rabbitmq',
  // 'bullmq mcp' belongs to the MCP module, which owns every MCP query
];

// A BullMQ port or equivalent in another language. The site is Node.js and TypeScript only.
const OTHER_LANGUAGE = [
  'bullmq alternative for golang', 'bullmq alternative for java',
  'bullmq alternative for python', 'bullmq c#', 'bullmq elixir', 'bullmq for golang',
  'bullmq for python', 'bullmq go', 'bullmq golang', 'bullmq in python', 'bullmq java',
  'bullmq kotlin', 'bullmq laravel', 'bullmq php', 'bullmq python',
  'bullmq python alternative', 'bullmq rust', 'bullmq or celery', 'bullmq vs celery',
  'bullmq vs sidekiq',
];

// Tools the site never names, so it makes no comparison to draw on.
const UNCOMPARED = [
  'bullmq vs airflow', 'bullmq vs ingest', 'bullmq or inngest', 'bullmq vs mqtt',
  'bullmq vs n8n', 'bullmq vs trigger', 'bullmq vs trigger dev',
  'bullmq vs worker threads', 'pg boss vs pgmq',
];

// BullMQ Pro's commercial terms, and project media and branding.
const OWN_PROJECT = [
  'bullmq course', 'bullmq docs', 'bullmq documentation', 'bullmq free tier',
  'bullmq git', 'bullmq github', 'bullmq icon', 'bullmq logo', 'bullmq logo png',
  'bullmq logo svg', 'bullmq medium', 'bullmq npm', 'bullmq npm package',
  'bullmq npmjs', 'bullmq pricing', 'bullmq pro', 'bullmq pro pricing',
  'bullmq reddit', 'bullmq svg', 'bullmq tutorial', 'bullmq yarn', 'bullmq youtube',
];

// pg-boss's own API, schema, integrations and project material.
const PG_BOSS_OWN = [
  'pg boss admin dashboard', 'pg boss api', 'pg boss bun', 'pg boss changelog',
  'pg boss concurrency', 'pg boss cron', 'pg boss documentation', 'pg boss example',
  'pg boss migration', 'pg boss monitor', 'pg boss natok', 'pg boss neon',
  'pg boss node', 'pg boss nodejs', 'pg boss part 3', 'pg boss performance',
  'pg boss postgres', 'pg boss prisma', 'pg boss priority', 'pg boss pub sub',
  'pg boss python', 'pg boss queue', 'pg boss reddit', 'pg boss retry',
  'pg boss rust', 'pg boss schedule', 'pg boss schema', 'pg boss singleton',
  'pg boss singleton key', 'pg boss supabase', 'pg boss team size',
  'pg boss transaction', 'pg boss tutorial', 'pg boss types', 'pg boss typescript',
  'pg boss with nestjs', 'pg boss worker', 'pg boss.work', 'pg-boss dashboard',
  'pg-boss docs', 'pg-boss drizzle', 'pg-boss github', 'pg-boss golang',
  'pg-boss nestjs', 'pg-boss next js', 'pg-boss npm', 'pg-boss postgresql',
  'pg-boss ui', 'pg-boss version',
];

// "bull" harvested as a word, not the library.
const NOISE = [
  'bull riding vs bull fighting', 'bull vs bear strategy', 'bull vs bear trap',
  'bull vs bear who wins', 'bull vs buffalo vs cow', 'hbar vs bull barrel',
];

module.exports = {
  positive: [
    ['/blog/bullmq-alternatives/', 'job queue choice', CHOOSING],
    ['/blog/imqueue-vs-bullmq/', 'job queue features', CAPABILITY],
    ['/blog/scheduled-work-without-a-job-system/', 'delayed and scheduled work', VS_CRON],
  ],
  negative: [
    ["BullMQ's own API, options and error messages", OWN_API],
    ['deploying BullMQ, or pairing it with another runtime or store', OWN_OPS],
    ['a job queue in another language ecosystem', OTHER_LANGUAGE],
    ['a tool the site never compares against', UNCOMPARED],
    ["BullMQ Pro's commercial terms, or project media and branding", OWN_PROJECT],
    ["pg-boss's own API, schema and integrations", PG_BOSS_OWN],
    ['"bull" harvested as a word, not the library', NOISE],
  ],
};
