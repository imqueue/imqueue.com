// Redis / RabbitMQ / Kafka / NATS / Postgres LISTEN-NOTIFY / load balancing — the infrastructure
// cluster. Pages read in full for this: /blog/redis-message-bus-patterns/ and
// /blog/postgres-notify-duplicate-listeners/. Load balancing judged from its full heading list plus
// all six of its anchored FAQ answers, which are in the index verbatim.
//
// /blog/redis-message-bus-patterns/ walks the actual primitives: pub/sub is fire-and-forget and a
// message published with no subscriber is gone; lists are competing-consumer work queues (LPUSH /
// RPOP) with BRPOP / BLMOVE so there is no polling; reliable list delivery means moving the message
// atomically into a per-consumer processing list with LMOVE (Redis 6.2+); Streams are an append-only
// log with consumer groups, ids and acks, closer to Kafka, worth it for replay; keyspace
// notifications need notify-keyspace-events Ex on ElastiCache. Then where @imqueue/core sits on top.
//
// /blog/postgres-notify-duplicate-listeners/ is the definitive page on the broadcast problem: NOTIFY
// delivers to every session that issued LISTEN, so three replicas handle every notification three
// times with no error and no metric moving. It then rejects the three obvious fixes (elect by config
// = single point of failure with no backlog; dedupe in the handler = all N do the work; session-level
// advisory locks = you still write liveness yourself), and documents singleListener, the one lock
// table, deadlock_check reading pg_stat_activity so the liveness detector IS Postgres, and the two
// handover paths.
//
// /blog/load-balancing-microservices-without-a-load-balancer/ argues the internal-path case: why
// pulling beats pushing, three ways to add capacity, what a balancer still does better, fairness and
// head-of-line effects, and how you know competing consumers is keeping up.
//
// What decides the negatives here: the site explains these primitives and its own use of them. It
// never teaches RabbitMQ's, Kafka's or NATS's client libraries, and it is a Node.js and TypeScript
// site — so the Java, Python, C#, Go, Rust and Spring Boot variants have no answer on it.
// "pg" in this export is also paying-guest accommodation in India, and a film rating.

import type { PositiveJudgement, NegativeJudgement } from './types.ts';

const REDIS_BUS = [
  'redis as a message broker', 'redis as a message bus', 'redis as a message queue',
  'redis as event bus', 'redis as message queue for microservices',
  'using redis as a message broker', 'using redis as a message queue',
  'redis message queue example', 'redis message queue persistence',
  'redis message queue nodejs', 'nodejs redis message queue', 'redis job queue node js',
  'what is redis pub sub', 'redis pub sub in nodejs', 'redis pub sub nodejs',
  'redis pub sub nodejs example', 'redis message broker vs kafka',
  'redis message broker vs rabbitmq', 'redis message queue vs kafka',
  'redis message queue vs rabbitmq',
];

const RPC_OVER_REDIS = ['rpc over redis'];

const LISTEN_NOTIFY = [
  'listen notify in postgres', 'postgres listen and notify', 'postgres listen notify',
  'postgres listen notify alternative', 'postgres listen notify example',
  'postgres listen notify nodejs', 'postgres listen notify performance',
  'postgres listen notify scalability', 'postgres listen notify trigger',
  'postgres listen notify tutorial', 'postgres listen notify vs kafka',
  'postgres listen notify vs redis', 'postgres listen/notify does not scale',
  'postgres-style notify/listen', 'postgres. listen. notify queue',
  'postgresql notify example', 'node postgres listen notify', 'what is postgres listen notify',
];

// The Postgres-as-a-queue question: /blog/bullmq-alternatives/ covers pg-boss on SKIP LOCKED, and
// pg-boss vs Graphile Worker, which is exactly what these ask.
const POSTGRES_QUEUE = [
  'job queue in postgres', 'node postgres job queue', 'nodejs job queue without redis',
  'nodejs postgres job queue', 'postgres as job queue', 'postgres based job queue',
  'postgres job queue', 'postgres job queue skip locked', 'postgres task queue',
  'postgresql job queue',
];

const LOAD_BALANCING = [
  'how load balancer works in microservices', 'how to do load balancing in microservices',
  'load balancer and microservices', 'load balancer for microservices',
  'load balancer in microservices', 'load balancer in microservices architecture',
  'load balancer in microservices example', 'load balancer microservices example',
  'load balancer with microservices', 'load balancing across microservices',
  'load balancing in microservices', 'load balancing in microservices example',
  'load balancing microservices', 'load balancing pattern in microservices',
  'microservices load balancing strategies',
];

// ================================================= NEGATIVE

// Redis's own commands, limits and operational properties.
const REDIS_OWN = [
  'redis get queue list', 'redis max requests per second', 'is redis distributed',
  'is redis reliable', 'redis message queue github', 'nodejs websocket redis pub sub',
  // @lock() is explicitly NOT distributed; the API reference says to use a Redis- or
  // database-backed lock instead, without documenting how to build one
  'distributed lock redis nodejs', 'distributed lock using redis',
];

// Another product's own client library. The site never teaches RabbitMQ, Kafka or NATS usage.
const OTHER_BROKER_CLIENT = [
  'implement rabbitmq in nodejs', 'node js rabbitmq auto reconnect',
  'node js rabbitmq consumer example', 'nodejs amqp client',
  'nodejs amqp connection manager', 'nodejs rabbitmq consumer',
  'rabbitmq + nodejs tutorial', 'rabbitmq and nodejs', 'rabbitmq com nodejs',
  'rabbitmq documentation nodejs', 'rabbitmq for nodejs', 'rabbitmq heartbeat nodejs',
  'rabbitmq implementation in node js', 'rabbitmq in nodejs',
  'rabbitmq integration with nodejs', 'rabbitmq node js github',
  'rabbitmq node js microservices', 'rabbitmq node js microservices github',
  'rabbitmq node npm', 'rabbitmq nodejs', 'rabbitmq nodejs client',
  'rabbitmq nodejs example', 'rabbitmq nodejs express', 'rabbitmq nodejs lib',
  'rabbitmq nodejs library', 'rabbitmq nodejs npm', 'rabbitmq nodejs typescript',
  'rabbitmq queue nodejs', 'rabbitmq rpc nodejs', 'rabbitmq streams nodejs',
  'rabbitmq with nodejs', 'spring amqp rabbitmq example',
  'kafka microservices example', 'nodejs kafka microservices',
  'nodejs microservices with kafka', 'why use kafka in microservices',
  'how microservices communicate with each other using kafka',
  'how to communicate between microservices using kafka',
  'nats examples', 'nats io nodejs', 'nats jetstream nodejs', 'nats jetstream nodejs example',
  'nats node js', 'nats node js client', 'nats node js example', 'nats nodejs',
  'nodejs nats jetstream',
];

// LISTEN/NOTIFY, a Postgres queue, or a message broker in another language or stack.
const OTHER_STACK = [
  'aurora postgres listen notify', 'aws aurora postgres listen notify',
  'django postgres listen notify', 'drizzle postgres listen notify',
  'go postgres listen notify', 'golang postgres job queue', 'jdbc postgres listen notify',
  'neon postgres listen notify', 'postgres job queue python', 'postgres listen notify c#',
  'postgres listen notify golang', 'postgres listen notify java',
  'postgres listen notify python', 'postgres listen notify spring boot',
  'postgres listen notify websocket', 'postgres task queue python',
  'postgresql listen notify example c#', 'postgresql listen notify example java',
  'postgresql listen notify example python', 'prisma postgres listen notify',
  'rust postgres job queue', 'rust postgres listen notify', 'spring postgres listen notify',
  'sqlalchemy postgres listen notify', 'tokio postgres listen notify',
  'redis as message broker java', 'redis as message broker python',
  'redis message broker c#', 'redis message broker example', 'redis message broker golang',
  'redis message broker spring boot', 'redis message queue c#', 'redis message queue golang',
  'redis message queue java', 'redis message queue python', 'redis message queue spring boot',
];

// Load balancing in another ecosystem, or a named balancer pattern the page does not cover.
const LB_ELSEWHERE = [
  'client side load balancing in microservices example',
  'client side load balancing spring boot microservices',
  'load balancing in microservices .net core',
  'load balancing in microservices interview questions',
  'load balancing in microservices spring boot',
  'load balancing in microservices spring boot example',
  'load balancing in spring boot microservices example',
  'load balancing spring boot microservices',
  'load balancing spring boot microservices using netflix ribbon',
  'load balancing tools in microservices', 'load balancer in microservices java',
  'load balancer in microservices kubernetes', 'load balancer in microservices spring boot',
  'load balancer in microservices spring boot example',
  'how to implement load balancing in microservices spring boot',
  'server side load balancing in microservices example',
  'server side load balancing microservices spring boot',
  'spring boot microservices load balancing example',
  'what is load balancing in spring microservices',
];

// Postgres's own SQL and server configuration.
const POSTGRES_OWN = ['postgres like example', 'postgres listen address'];

// "pg" is paying-guest accommodation in India, and a film rating. "nats" is also gnats.
const NOISE = [
  'big boss pg jaipur', 'boss baby pg', 'boss baby pg rating', 'boss chill pg',
  'boss ladies pg', 'boss level pg', 'boss level pg rating', 'boss pg & hostel',
  'boss pg anant nagar', 'boss pg and guest house', 'boss pg and guest house for girls',
  'boss pg and guest house for girls photos', 'boss pg and guest house for girls reviews',
  'boss pg and guest house photos', 'boss pg hinjewadi', 'boss pg hinjewadi phase 1',
  'boss pg hinjewadi phase 2', 'boss pg laxmi chowk', 'boss pg mukai nagar',
  'boss pg near me', 'boss pg only for girls', 'boss pg only for girls photos',
  'boss pg only for ladies', 'boss pg only for ladies photos', 'boss pg pune',
  'helluva boss pg rating', 'horrible bosses pg rating', 'pg 8 salary', 'pg bad words',
  'pg hugo boss', 'pg level government jobs', 'pg manager app', 'pg motoring boss',
  'pg r rating', 'pg related jobs', 'pg remove pg', 'pg salary', 'pg supervisor job',
  'sariga pg bigg boss', 'sariga pg bigg boss family', 'sariga pg bigg boss husband',
  'sarika pg bigg boss', 'the boss pg rating', 'do gnats have noses', 'nats lineup',
];

export const positive: readonly PositiveJudgement[] = [
  ['/blog/redis-message-bus-patterns/', 'redis message bus', REDIS_BUS],
  ['/blog/rpc-over-redis-nodejs/', 'rpc over redis', RPC_OVER_REDIS],
  ['/blog/postgres-notify-duplicate-listeners/', 'listen notify', LISTEN_NOTIFY],
  ['/blog/bullmq-alternatives/', 'postgres as a queue', POSTGRES_QUEUE],
  ['/blog/load-balancing-microservices-without-a-load-balancer/', 'load balancing', LOAD_BALANCING],
];

export const negative: readonly NegativeJudgement[] = [
  ["Redis's own commands, limits and operational properties", REDIS_OWN],
  ["another broker's own client library — the site never teaches them", OTHER_BROKER_CLIENT],
  ['LISTEN/NOTIFY, a Postgres queue or a broker in another language or stack', OTHER_STACK],
  ['load balancing in another ecosystem, or a balancer pattern not covered', LB_ELSEWHERE],
  ["Postgres's own SQL and server configuration", POSTGRES_OWN],
  ['"pg" as paying-guest accommodation or a film rating; "nats" as gnats', NOISE],
];
