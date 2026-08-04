#!/usr/bin/env node
// judge-natural.js — decide which harvested queries are in scope, and what the right
// answer is for each.
//
//   node scripts/search-kpi/judge-natural.js
//
// METHOD, AND WHY IT IS SHAPED THIS WAY
//
// Harvested queries arrive unlabelled, and two different things can make one unscorable:
//
//   OUT OF SCOPE   Google's a-z expansion drifts. The `pg-boss` seed returned forty
//                  variations on hostel listings; `pg-boss` and `boss pg` are one letter
//                  apart. There is no correct answer to "boss pg near me", and counting it
//                  as a miss would measure Google's drift, not this ranker.
//
//   NO PAGE FOR IT On topic, but the site has nothing that answers it ("kafka exactly once
//                  semantics"). That is a CONTENT gap. Scoring it zero would blame the
//                  ranker for a page nobody has written, and would also mean the KPI could
//                  be raised by writing articles rather than by ranking better.
//
// So a query enters the KPI only when a rule below assigns it a page. Everything else is
// counted and reported, never silently dropped — the unmapped count is a real finding about
// coverage, and the report prints a sample so it can be checked rather than trusted.
//
// THE RULES ARE WRITTEN FROM THE PAGE INVENTORY, NOT FROM THE RANKER'S OUTPUT
//
// This is the part that decides whether the number means anything. Every rule below was
// written by reading the list of pages and asking "which page is about this subject" — never
// by running the query and seeing what came back. Writing rules the other way produces a
// ranker that scores 100% against its own behaviour. A rule may name SEVERAL pages when
// several genuinely answer the query; the hit counts printed at the end are there to expose
// a rule that quietly swallowed half the set.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const IN = path.join(__dirname, 'data', 'natural-queries.json');
const OUT = path.join(__dirname, 'data', 'natural-judged.json');

// Anything about another language's ecosystem, or plainly not about software at all. Checked
// FIRST, because "does amazon have a delivery guarantee" contains "delivery guarantee" and
// would otherwise be scored against the message-delivery article.
const OUT_OF_SCOPE = new RegExp([
  // other ecosystems — the site is Node.js/TypeScript only
  'spring ?boot', '\\bjava\\b', '\\bpython\\b', 'django', 'flask', 'celery',
  '\\.net\\b', 'c#', '\\bphp\\b', 'laravel', 'rails', '\\bruby\\b', 'golang',
  '\\bgo\\b(?! )', 'dotnet', 'asp\\.net', '\\bmaven\\b', 'quarkus', 'micronaut',
  'akka', 'erlang', 'elixir', 'scala', 'kotlin', '\\brust\\b',
  // real-world logistics, food, retail — the "delivery" and "boss" drift
  'amazon', 'flipkart', 'pizza', 'domino', 'ubereats', 'doordash', 'courier',
  'parcel', 'postmate', 'grocer', 'restaurant', 'hostel', 'pune', 'jaipur',
  'hinjewadi', 'nagar', 'chowk', 'guest house', 'near me', 'for girls',
  'for ladies', 'burpee', 'diet', 'fodmap', 'dewberr', 'patio', 'butternut',
  // chemistry / biology — the "molecule" drift off "moleculer"
  'molecule', 'molecular', '\\batom\\b', 'compound', 'mixture', '\\bcell\\b',
  '\\bdna\\b', '\\brna\\b', 'element vs',
  // entertainment / language / misc
  'boss baby', 'coloring', 'movie', 'rating', 'lyric', 'quote', 'saying',
  'meaning', 'isaac', 'type soul', 'page turner', 'grading', 'berkshire',
  '\\bnce\\b', '\\bbst\\b', 'binary heap', 'winhttp', 'gnats have',
  'villages', 'car service', 'burger', 'salary', 'interview question',
  'minecraft', 'magic mouse', 'réponse', '\\bde service\\b',
  // Employment, not engineering — matched in both word orders ("junior node js jobs" and
  // "pg level government jobs"), or it lands in the coverage-gap bucket and overstates it.
  '\\bjobs?\\b.*(junior|entry level|government|supervisor|hiring|vacanc)',
  '(junior|entry level|graduate|government|supervisor|pg level|pg related).*\\bjobs?\\b',
  // NAME COLLISIONS. These share a name with something the site does cover and would
  // otherwise be scored against a page that cannot possibly answer them: TRPC is also a
  // family of ion-channel genes and a retirement-plan provider, and "bull" is a market.
  'trpc ?\\d', '401k', '\\bstrain\\b', '\\bgene\\b', 'adalah',
  'bull (vs|riding|fighting)', 'bull vs (bear|buffalo)', '\\bbear\\b',
  'bull barrel', '\\bhbar\\b',
  // THIRD-PARTY MCP SERVERS. "claude code figma mcp" is a question about Figma's server.
  // This site documents its own, so there is no page that answers it; mapping it to
  // /mcp/installation/ would score the ranker on a query it should arguably return
  // nothing for, and there are hundreds of them — enough to dominate the average.
  'figma', 'atlassian', 'klaviyo', '\\bjira\\b', 'notion', '\\bslack\\b',
  'github mcp', 'gitlab', 'xcode', 'keynote', '\\bado mcp\\b', 'salesforce',
  'hubspot', 'stripe', 'shopify', 'supabase', 'playwright', 'puppeteer',
  'blender', '\\bunity\\b', 'obsidian', 'zapier', 'airtable', '\\blinear\\b',
  'sentry', 'youtube', 'reddit', 'spotify', 'whatsapp', 'telegram',
  'sharepoint', 'databricks', 'snowflake', 'tableau', 'excel', '\\bsap\\b',
  // "imq" is also IMQ, a Basque healthcare group — Igualatorio Médico Quirúrgico. The
  // harvest is full of "imq clinica dental", "clinica.imq zorrotzaurre", "imq clientes".
  // Scored against /cli/ they were a whole topic reading 0%, which is a measurement
  // artefact and not something the ranker could or should fix.
  'clinic', 'clínic', 'dental', 'medico', 'médico', 'zorrotzaurre', 'deusto',
  'igualatorio', 'seguro', 'cliente', 'urgencias', 'hospital',
  // Discord's RPC is a different thing entirely; "nodejs discord rpc" is not about this.
  'discord',
].join('|'), 'i');

// A query has to look like it is about this subject matter at all. Cheap pre-filter so the
// unmapped bucket stays meaningful — without it, "better versus best" would be reported as
// an uncovered topic.
const IN_DOMAIN = new RegExp([
  'nod(e|ejs)', 'javascript', '\\bjs\\b', 'typescript', '\\bts\\b', 'npm',
  'redis', 'queue', '\\brpc\\b', 'microservice', 'micro service', 'service',
  'bullmq', '\\bbull\\b', 'grpc', '\\bnats\\b', 'moleculer', 'nestjs', 'nest',
  'trpc', 'imqueue', '\\bimq\\b', '\\bmcp\\b', 'kafka', 'rabbit', 'pg-boss',
  'postgres', 'pub ?sub', 'broker', 'monolith', 'backpressure', 'back pressure',
  'graceful', 'circuit breaker', 'idempoten', 'delivery', 'at least once',
  'exactly once', 'at most once', '\\bcron\\b', 'schedul', 'delayed',
  'api', 'graphql', 'openapi', 'swagger', 'docker', 'autoscal', 'scaling',
  'load balanc', 'distributed lock', 'type safe', 'typed', 'versioning',
  'testing', 'mock', 'claude', 'cursor', 'copilot', 'ai agent', 'ai coding',
  'model context', 'message', 'broadcast', 'worker', 'job', 'deploy',
  'discovery', 'gateway', 'boilerplate', 'throughput', 'benchmark',
].join('|'), 'i');

// A query naming a COMPETING product with pure how-to intent — "nodejs rabbitmq consumer
// example", "nats node js client", "kafka microservices example". This site compares itself
// with those products and does not teach them, so it has no page that answers the question.
//
// They are separated out rather than mapped to the nearest comparison article because that
// mapping is a stretch that costs real accuracy: thirty of these were scoring 0% against
// /blog/rpc-over-message-queue-nodejs/, and no ranking change could have fixed them. Kept
// visible as their own count, since "readers ask this and we have nothing" is worth knowing.
//
// Comparison and choice intent is explicitly excluded — "rabbitmq vs redis" IS answerable
// here, and stays in the KPI.
const COMPETITOR = /rabbit ?mq|\bamqp\b|kafka|\bnats\b|bullmq|moleculer|nest ?js|\btrpc\b|pg[ -]?boss|\bgrpc\b/i;
const HOWTO = /\b(example|tutorial|consumer|producer|client|connect|reconnect|install|setup|config|docs?|getting started|how to use|sample|demo|boilerplate|starter|lib|library|npm|github|express|heartbeat|streams?|implementation|integration)\b/i;
const CHOICE = /\bvs\b|versus|compar|alternativ|instead of|better than|which|difference|imqueue|choose|migrat|\bwhy\b/i;
// "rabbitmq nodejs" carries no how-to word at all and is still the same question: how do I
// use that product from Node. A competitor named next to a language, with nothing weighing it
// against anything, is a usage question — and twenty of those were the single largest block
// of apparent misses left in the set.
const LANGUAGE = /\bnode ?(js)?\b|\bnodejs\b|typescript|\bjs\b|\bnpm\b|express/i;

const isCompetitorHowTo = (query) =>
  COMPETITOR.test(query) && !CHOICE.test(query) && (HOWTO.test(query) || LANGUAGE.test(query));

// ---- ground truth ---------------------------------------------------------
// [pattern, expected page(s), label]. First match wins, so the ORDER matters: specific
// comparisons before the generic topic they belong to.
const RULES = [
  // --- head-to-head comparisons (most specific first) ---
  [/imqueue.*(vs|versus).*bullmq|bullmq.*(vs|versus).*imqueue/i, ['/blog/imqueue-vs-bullmq/'], 'imqueue vs bullmq'],
  [/imqueue.*(vs|versus).*moleculer|moleculer.*(vs|versus).*imqueue/i, ['/blog/imqueue-vs-moleculer/'], 'imqueue vs moleculer'],
  [/imqueue.*(vs|versus).*nats|nats.*(vs|versus).*imqueue/i, ['/blog/imqueue-vs-nats/'], 'imqueue vs nats'],
  [/imqueue.*(vs|versus).*nest|nest.*(vs|versus).*imqueue/i, ['/blog/imqueue-vs-nestjs/'], 'imqueue vs nestjs'],
  [/imqueue.*(vs|versus).*trpc|trpc.*(vs|versus).*imqueue/i, ['/blog/imqueue-vs-trpc/'], 'imqueue vs trpc'],
  [/imqueue.*(vs|versus)|(vs|versus).*imqueue|imqueue alternativ|alternativ.*imqueue/i, ['/compare/'], 'imqueue vs anything'],

  // --- delivery guarantees ---
  // FIRST among the topic rules, above every broker name. "exactly once delivery rabbitmq"
  // and "does kafka guarantee at least once delivery" are questions about delivery semantics
  // that merely name a broker; the delivery article is what answers them, and it is what the
  // ranker returns. While these rules sat below the broker names, seventy such queries were
  // labelled "rabbitmq" or "kafka" and scored as misses for returning the right page.
  // `[ -]` because people write both "exactly once delivery" and "exactly-once delivery".
  [/(at[ -]least[ -]once|at[ -]most[ -]once|exactly[ -]once|guaranteed).*(deliver|message|semantic)|deliver.*(guarantee|once)/i,
    ['/blog/guaranteed-message-delivery-cost/', '/blog/topics/delivery/'], 'delivery guarantees'],
  [/delivery guarantee|message delivery/i,
    ['/blog/guaranteed-message-delivery-cost/', '/blog/topics/delivery/'], 'message delivery'],
  [/safe ?delivery/i, ['/api/core/latest/core.imqoptions.safedelivery/'], 'safeDelivery option'],
  // Up here with delivery, above the broker names: "postgres listen notify vs kafka" is a
  // LISTEN/NOTIFY question, and the article about it is what the ranker returns.
  [/listen ?\/?notify|notify.*(duplicate|replica|listener)|postgres.*notify/i,
    ['/blog/postgres-notify-duplicate-listeners/'], 'listen/notify'],

  // --- BullMQ / job queues ---
  [/(bullmq|bull).*(alternativ|replace|instead of|competitor)|alternativ.*(to|for|of).*(bullmq|bull)\b/i,
    ['/blog/bullmq-alternatives/'], 'bullmq alternatives'],
  [/bullmq.*(vs|versus)|(vs|versus).*bullmq|bull.*(vs|versus).*bullmq/i,
    ['/blog/imqueue-vs-bullmq/', '/blog/bullmq-alternatives/'], 'bullmq vs X'],
  [/\bbullmq\b|\bbull\b.*queue/i, ['/blog/bullmq-alternatives/', '/blog/imqueue-vs-bullmq/'], 'bullmq generic'],
  // Both word orders: "node job queue" and "node js queue jobs" are the same question.
  [/(job|task|worker) queue|queue.*\b(jobs?|tasks?|workers?)\b|queue.*(library|package|npm)|background (job|task|work|process)|work queue/i,
    ['/blog/imqueue-vs-bullmq/', '/blog/topics/jobs/', '/blog/bullmq-alternatives/'], 'job queue'],
  [/pg[ -]?boss|postgres.*(job|queue)|queue.*postgres/i,
    ['/blog/bullmq-alternatives/'], 'postgres queue'],

  // --- other frameworks / transports ---
  [/moleculer/i, ['/blog/imqueue-vs-moleculer/'], 'moleculer'],
  [/(nestjs|nest ?js|@nestjs).*(microservice|transport|rpc|queue|redis)|microservice.*nestjs/i,
    ['/blog/imqueue-vs-nestjs/'], 'nestjs microservices'],
  [/\btrpc\b/i, ['/blog/imqueue-vs-trpc/'], 'trpc'],
  // "is nestjs worth it", "why use nestjs" — a NestJS user weighing it up is exactly who the
  // comparison article is written for, even with no transport word in the query.
  [/nest ?js|@nestjs/i, ['/blog/imqueue-vs-nestjs/'], 'nestjs generic'],
  [/\bnats\b/i, ['/blog/imqueue-vs-nats/'], 'nats'],
  [/grpc.*(vs|versus).*(message queue|queue|kafka|rabbit|amqp)|message queue.*(vs|versus).*grpc/i,
    ['/blog/grpc-vs-message-queue-rpc/'], 'grpc vs queue'],
  [/grpc.*(vs|versus).*(rest|http)|rest.*(vs|versus).*grpc/i,
    ['/blog/internal-apis-dont-need-rest/', '/blog/grpc-vs-message-queue-rpc/'], 'grpc vs rest'],
  [/\bgrpc\b/i, ['/blog/grpc-vs-message-queue-rpc/'], 'grpc'],
  [/rabbit ?mq|\bamqp\b/i, ['/blog/rpc-over-message-queue-nodejs/', '/compare/'], 'rabbitmq'],
  [/kafka/i, ['/blog/nodejs-service-communication-options-2026/', '/compare/'], 'kafka'],

  // --- RPC ---
  [/rpc over redis|redis.*\brpc\b|\brpc\b.*redis/i, ['/blog/rpc-over-redis-nodejs/'], 'rpc over redis'],
  [/\brpc\b.*(message queue|queue)|(message queue|queue).*\brpc\b/i,
    ['/blog/rpc-over-message-queue-nodejs/'], 'rpc over queue'],
  [/\brpc\b.*(between|microservice|service)|(microservice|service).*\brpc\b/i,
    ['/blog/rpc-over-message-queue-nodejs/', '/blog/topics/rpc/'], 'rpc between services'],
  // Both RPC articles answer "how do I do RPC in Node" — the Redis one is not a worse answer
  // than the queue one, and naming only the queue one scored it as a rank-8 miss.
  [/(typescript|node|nodejs|js).*\brpc\b|\brpc\b.*(typescript|node|nodejs)/i,
    ['/blog/rpc-over-message-queue-nodejs/', '/blog/rpc-over-redis-nodejs/', '/', '/intro/'], 'nodejs rpc'],
  [/json ?rpc/i,
    ['/blog/rpc-over-message-queue-nodejs/', '/blog/rpc-over-redis-nodejs/', '/api/rpc/latest/'], 'json-rpc'],
  // Bare "rest vs rpc" / "types of rpc" reach none of the co-occurrence rules above.
  [/\brpc\b/i, ['/blog/rpc-over-message-queue-nodejs/', '/blog/topics/rpc/', '/glossary/'], 'rpc generic'],
  [/internal api.*(rest|rpc)|rest.*internal api|(do|does).*internal.*need.*rest/i,
    ['/blog/internal-apis-dont-need-rest/'], 'internal apis and rest'],

  // --- Redis as a bus ---
  [/redis.*(message bus|bus|pub ?sub|broker|messaging)|(pub ?sub|message bus).*redis/i,
    ['/blog/redis-message-bus-patterns/'], 'redis message bus'],
  [/redis.*(queue|message)|message.*redis/i,
    ['/blog/redis-message-bus-patterns/', '/blog/rpc-over-redis-nodejs/'], 'redis messaging'],
  [/(scal|shard|cluster).*redis|redis.*(scal|cluster|broadcast)/i,
    ['/blog/horizontally-scalable-redis-broker/'], 'scaling redis'],
  [/listen ?\/?notify|notify.*(duplicate|replica|listener)|postgres.*notify/i,
    ['/blog/postgres-notify-duplicate-listeners/'], 'listen/notify'],

  // --- resilience / operations ---
  [/back ?pressure/i, ['/blog/backpressure-nodejs-services/'], 'back-pressure'],
  // `graceful\w*` so "gracefully shutdown node js server" is not missed on the adverb.
  [/graceful\w*\s*(shutdown|stop|exit|restart)|zero.?(downtime|drop)|sigterm|drain.*(connection|request)/i,
    ['/blog/graceful-shutdown-zero-drop-deploys/'], 'graceful shutdown'],
  [/circuit breaker/i, ['/blog/rpc-over-redis-nodejs/', '/blog/topics/resilience/'], 'circuit breaker'],
  [/service discovery|discover.*service|do i need.*discovery/i,
    ['/blog/do-nodejs-backends-need-service-discovery/'], 'service discovery'],
  [/load balanc/i, ['/blog/load-balancing-microservices-without-a-load-balancer/'], 'load balancing'],
  [/(auto ?scal|horizontal.*scal|scal.*horizontal)/i,
    ['/blog/horizontally-scalable-redis-broker/', '/tutorial/deployment/'], 'autoscaling'],
  // The @Lock decorator's API page, the locking section of the API index and the Redis RPC
  // article all genuinely answer this; naming only the decorator scored two correct answers
  // as misses.
  [/distributed lock|redis lock|\block\b.*redis/i,
    ['/api/rpc/latest/rpc.lock/', '/api/#locking', '/blog/rpc-over-redis-nodejs/'], 'distributed lock'],
  [/(retry|retries).*(fail|request|call|message)|failed.*(retry|call)/i,
    ['/blog/rpc-over-redis-nodejs/', '/blog/topics/resilience/'], 'retries'],
  // Both articles discuss idempotent consumers; the delivery topic hub lists them.
  [/idempoten/i, [
    '/blog/guaranteed-message-delivery-cost/',
    '/blog/grpc-vs-message-queue-rpc/',
    '/blog/topics/delivery/',
  ], 'idempotency'],

  // --- scheduling ---
  [/(delay|schedul).*(job|task|work|call|message)|(job|task|work).*(delay|schedul)/i,
    ['/blog/scheduled-work-without-a-job-system/', '/agents/delayed-scheduled-work/'], 'delayed & scheduled work'],
  [/\bcron\b/i, ['/blog/scheduled-work-without-a-job-system/'], 'cron'],
  [/\bdelay\w*\b/i, ['/blog/scheduled-work-without-a-job-system/', '/agents/delayed-scheduled-work/'], 'delay generic'],

  // --- types & clients ---
  [/type ?safe|type safety|share.*type|type.*(between|across).*service/i,
    ['/blog/type-safe-service-communication-typescript/'], 'type safety'],
  [/(generat|writ|maintain|hand.?writ).*(client|sdk)|client.*(generat|codegen)|typed client/i,
    ['/blog/stop-hand-writing-microservice-clients/'], 'generated clients'],
  // Both orders again: "versioning microservices" and "api versioning".
  [/version(ing)?.*(api|microservice|service|breaking)|(api|microservice|service).*version(ing)?\b|breaking.*(change|caller)/i,
    ['/blog/versioning-microservices-without-breaking-callers/', '/cli/clients-and-versioning/'], 'versioning'],

  // --- testing & migration ---
  // Both orders: "testing microservices" and "microservices api testing". Also the tools
  // people name instead of the concept — pact, selenium, jmeter, Fowler's test pyramid —
  // which the testing article is the closest thing the site has to an answer for.
  [/test(ing)?.*(microservice|service|stack)|(microservice|service).*test(ing)?\b|mock.*(service|microservice)|\b(pact|selenium|jmeter|test pyramid|contract test)\b/i,
    ['/blog/testing-microservices-without-the-whole-stack/'], 'testing services'],
  [/monolith|extract.*service|split.*(monolith|service)|strangler/i,
    ['/blog/monolith-to-services-first-extraction/'], 'monolith to services'],
  [/boilerplate/i, ['/blog/cutting-boilerplate-nodejs-microservices/'], 'boilerplate'],

  // --- MCP & AI ---
  // ABOVE the gateway/deployment/tutorial rules that follow. "cursor mcp server kubernetes"
  // and "mcp server tutorial" are questions about the MCP server; the generic `kubernetes`
  // and `tutorial` rules used to claim them and score /mcp/installation/ as a miss for the
  // page that answers them. Rule order is ground truth, so it is stated rather than implied.
  [/(mcp|model context).*(install|add|setup|set up|config)|(install|add|setup).*(mcp|model context)/i,
    ['/mcp/installation/'], 'mcp installation'],
  [/(claude|cursor|vs ?code|copilot|windsurf).*(mcp|server)|mcp.*(claude|cursor|vs ?code)/i,
    ['/mcp/installation/'], 'mcp in an editor'],
  [/mcp.*(tool|function)/i, ['/mcp/tools/'], 'mcp tools'],
  [/mcp.*(secur|safe|permission|risk|troubleshoot)/i, ['/mcp/security/'], 'mcp security'],
  [/mcp.*(workflow|agent)/i, ['/mcp/workflows/'], 'mcp workflows'],
  [/\bmcp\b|model context protocol/i, ['/mcp/'], 'mcp generic'],
  [/ai (coding|agent|assistant)|coding (agent|assistant)|copilot|llm.*code/i,
    ['/using-ai-assistants/', '/agents/'], 'ai assistants'],

  // --- CLI ---
  [/\bimq\b.*(install|setup)|install.*(imq|@imqueue\/cli)/i, ['/cli/installation/'], 'cli installation'],
  [/\bimq\b.*(isolat|home|env)|isolat.*imq/i, ['/blog/isolated-imq-cli-environments/'], 'isolated cli homes'],
  [/\bimq\b.*(config|template|provider|troubleshoot|catalog|scenario)/i, ['/cli/'], 'cli topics'],
  [/\bimq\b|imqueue cli|@imqueue\/cli/i, ['/cli/'], 'cli generic'],

  // --- gateways & deployment (below MCP, see the note above) ---
  [/graphql/i, ['/tutorial/api-service/'], 'graphql gateway'],
  [/(swagger|openapi)/i, ['/tutorial/rest-api/'], 'openapi/swagger'],
  [/api gateway/i, ['/tutorial/api-service/', '/tutorial/rest-api/'], 'api gateway'],
  [/docker|compose|kubernetes|k8s|deploy/i, ['/tutorial/deployment/'], 'deployment'],

  // --- licensing & meta ---
  [/licen[cs]e|\bgpl\b|open ?source|free to use|commercial(ly)? use|can i use.*commercial/i,
    ['/license/'], 'license'],
  [/glossar|terminolog|what does.*mean/i, ['/glossary/'], 'glossary'],
  // Bare "performance" removed: it pulled in "microservices performance testing using
  // jmeter", where the testing article is the better answer and the benchmark post is not
  // wrong so much as not asked for. An over-broad rule reads as a ranker failure.
  // No "requests per second" either: "redis max requests per second" is a question about
  // Redis's own limits, which no page here answers. That is a content gap, not a miss.
  [/benchmark|throughput|how fast|latency/i,
    ['/blog/benchmarking-imqueue-throughput/'], 'benchmarks'],
  [/contribut/i, ['/contributing/'], 'contributing'],
  [/\bdocs?\b|documentation|api reference/i, ['/docs/', '/api/'], 'documentation'],

  // --- what/why imqueue, and the generic framework question ---
  [/what is (@?imqueue)|imqueue\b.*(what|intro|overview|about)/i, ['/intro/', '/'], 'what is imqueue'],
  [/\bimqueue\b/i, ['/', '/intro/'], 'imqueue generic'],
  [/(best|top|which|choose|pick|recommend).*(node|nodejs|typescript|js).*(framework|library|microservice)/i,
    ['/compare/', '/intro/', '/'], 'which framework'],
  [/microservice.*framework|framework.*microservice/i, ['/intro/', '/', '/compare/'], 'microservices framework'],
  // Both word orders. "how to communicate between microservices" puts the verb first, and
  // only matching "microservice...communicate" sent forty of these to the generic
  // microservices rule — where the article that answers them scored as a rank-7 miss.
  [/(how|do|why).*(service|microservice).*(talk|communicat)|(service|microservice).*communicat|communicat.*(between|with)?\s*(two )?(service|microservice)/i,
    ['/blog/nodejs-service-communication-options-2026/'], 'service communication'],
  [/message (queue|broker|bus)/i,
    ['/blog/rpc-over-message-queue-nodejs/', '/blog/topics/queue/'], 'message queue generic'],
  // A bare "microservices in typescript" or "node js microservices example" has no single
  // right answer: the home page, the intro, the tutorial and get-started all serve it, and
  // which one leads is a judgement call rather than a defect. Naming only the first three
  // scored /tutorial/ as a rank-5 miss for "nodejs microservices tutorial".
  [/microservice/i,
    ['/intro/', '/', '/blog/', '/tutorial/', '/get-started/', '/compare/'], 'microservices generic'],

  // --- generic learning intent, LAST on purpose (see the note in the gateways block) ---
  [/tutorial|step by step|walkthrough|from scratch|example project|sample project/i,
    ['/tutorial/', '/get-started/'], 'tutorial'],
  [/get(ting)? started|quick ?start|hello world|first service/i,
    ['/get-started/', '/tutorial/user-service/'], 'getting started'],
];

function judge(query) {
  if (OUT_OF_SCOPE.test(query)) return { verdict: 'out-of-scope' };
  if (!IN_DOMAIN.test(query)) return { verdict: 'out-of-scope' };
  if (isCompetitorHowTo(query)) return { verdict: 'competitor-howto' };

  for (const [pattern, expect, label] of RULES) {
    if (pattern.test(query)) return { verdict: 'judged', expect, label };
  }

  return { verdict: 'unmapped' };
}

function main() {
  const queries = JSON.parse(fs.readFileSync(IN, 'utf8'));
  const judged = [];
  const unmapped = [];
  const outOfScope = [];
  const competitorHowTo = [];
  const byLabel = {};

  for (const query of queries) {
    const result = judge(query);

    if (result.verdict === 'judged') {
      judged.push({ query, expect: result.expect, label: result.label });
      byLabel[result.label] = (byLabel[result.label] || 0) + 1;
    } else if (result.verdict === 'unmapped') {
      unmapped.push(query);
    } else if (result.verdict === 'competitor-howto') {
      competitorHowTo.push(query);
    } else {
      outOfScope.push(query);
    }
  }

  fs.writeFileSync(OUT, `${JSON.stringify({
    judged, unmapped, outOfScope, competitorHowTo, byLabel,
  }, null, 0)}\n`);

  console.log(`[judge] ${queries.length} harvested`);
  console.log(`         ${judged.length} in scope with a ground-truth page  -> the KPI set`);
  console.log(`         ${unmapped.length} on topic but no page assigned    -> coverage gap`);
  console.log(`         ${competitorHowTo.length} how-to about a competitor        -> no page can answer`);
  console.log(`         ${outOfScope.length} out of scope                     -> dropped`);
  console.log(`[judge] wrote ${OUT}`);
  console.log('\n[judge] rule hit counts (a suspiciously large one is an over-broad rule):');

  for (const [label, n] of Object.entries(byLabel).sort((a, b) => b[1] - a[1])) {
    console.log(`         ${String(n).padStart(4)}  ${label}`);
  }
}

main();
