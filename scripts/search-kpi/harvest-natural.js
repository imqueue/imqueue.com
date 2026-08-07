#!/usr/bin/env node
// harvest-natural.js — collect REAL search strings people type, from Google autocomplete.
//
//   node scripts/search-kpi/harvest-natural.js [--out FILE]
//
// WHY AUTOCOMPLETE
//
// The point of the natural set is that nobody on this project wrote it. Queries invented
// by whoever is tuning the ranker are the queries the ranker already handles — that is how
// every weight in search.js got set, and it is why the tuning kept breaking a query three
// words away. Google's suggest endpoint returns actual popular completions for a prefix, so
// the phrasing, the word order and the misspellings are the public's, not ours.
//
// Seeds are the site's own topics (a query about Kubernetes operators is not a search this
// site can answer, and measuring it would measure nothing), but every seed is expanded with
// a-z so the suggestions travel well past the seed wording. The seed decides the subject;
// Google decides the words.
//
// Output is a deduplicated JSON array of raw query strings, and it is the harvest OF RECORD:
// check-kpi.js asserts that judged/*.js decides every query in this file exactly once, so a query
// cannot quietly leave the measurement by being dropped from a list.
//
// Ground truth is assigned separately, in judged/*.js, by reading the page that answers each query
// — harvesting and judging must not be the same step, or the temptation is to keep the queries that
// happen to work.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const OUT = (() => {
  const i = process.argv.indexOf('--out');

  return i === -1
    ? path.join(__dirname, 'data', 'natural-queries.json')
    : process.argv[i + 1];
})();

// The subjects this site actually has pages about. Grouped only for readability.
const SEEDS = [
  // queue / transport
  'nodejs message queue', 'node js message queue', 'redis message queue nodejs',
  'redis as a message bus', 'redis pub sub nodejs', 'message broker nodejs',
  'nodejs job queue', 'node job queue redis', 'background jobs nodejs',
  'bullmq', 'bullmq alternative', 'bullmq vs', 'bull vs bullmq',
  'pg-boss', 'postgres job queue', 'postgres listen notify',
  'rabbitmq nodejs', 'kafka nodejs microservices', 'nats nodejs',
  // rpc
  'nodejs rpc', 'rpc over redis', 'rpc between microservices',
  'typescript rpc', 'json rpc nodejs', 'grpc nodejs',
  'grpc vs rest', 'grpc vs message queue', 'internal api rest or rpc',
  'trpc', 'trpc vs grpc', 'trpc microservices',
  // frameworks
  'nodejs microservices framework', 'typescript microservices',
  'moleculer', 'moleculer vs', 'nestjs microservices',
  'nestjs microservices transport', 'best nodejs microservices framework',
  'microservice boilerplate nodejs',
  // patterns / operations
  'service discovery nodejs', 'do i need service discovery',
  'load balancing microservices', 'load balancer for microservices',
  'graceful shutdown nodejs', 'zero downtime deploy nodejs',
  'back pressure nodejs', 'backpressure nodejs stream',
  'circuit breaker nodejs', 'retry failed request nodejs',
  'at least once delivery', 'exactly once delivery',
  'guaranteed message delivery', 'message delivery guarantees',
  'idempotency microservices', 'distributed lock redis nodejs',
  'horizontal scaling nodejs', 'autoscaling microservices',
  // delivery / jobs
  'delayed jobs nodejs', 'scheduled tasks nodejs', 'cron job nodejs',
  'node cron alternative', 'schedule job without redis',
  // types / clients
  'type safe api client', 'generate typescript client from api',
  'typed service client', 'share types between services',
  'end to end type safety typescript', 'api versioning microservices',
  'breaking api changes microservices',
  // testing / migration
  'testing microservices', 'integration testing microservices nodejs',
  'mock microservice in tests', 'monolith to microservices',
  'extract service from monolith', 'when to split a monolith',
  // architecture / gateways
  'graphql gateway microservices', 'api gateway nodejs',
  'rest api gateway swagger', 'openapi nodejs typescript',
  'microservices docker compose', 'deploy microservices docker',
  // product-specific
  'imqueue', '@imqueue', 'imqueue nodejs', 'imqueue framework',
  'imq cli', 'imqueue tutorial', 'imqueue license', 'imqueue vs',
  // ai / mcp
  'mcp server', 'mcp server install', 'model context protocol',
  'claude code mcp', 'cursor mcp server', 'ai coding agent nodejs',
  'ai agent code generation typescript',
  // misc dev intent
  'nodejs microservices tutorial', 'microservices best practices nodejs',
  'nodejs services talk to each other', 'how microservices communicate',
];

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');
const ENDPOINT = 'https://suggestqueries.google.com/complete/search';
const CONCURRENCY = 4;
const DELAY_MS = 60;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function suggest(prefix) {
  const url = `${ENDPOINT}?client=firefox&hl=en&q=${encodeURIComponent(prefix)}`;

  try {
    const response = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (search-kpi harvester; imqueue.org)' },
    });

    if (!response.ok) return [];

    const body = JSON.parse(await response.text());

    return Array.isArray(body[1]) ? body[1] : [];
  } catch {
    return [];
  }
}

async function main() {
  // Seed alone, plus seed + " " + letter. The letter expansion is what gets past the seed's
  // own wording into phrasings nobody here would have thought to type.
  const prefixes = [];

  for (const seed of SEEDS) {
    prefixes.push(seed);

    for (const letter of ALPHABET) prefixes.push(`${seed} ${letter}`);
  }

  console.log(`[harvest] ${SEEDS.length} seeds -> ${prefixes.length} prefixes`);

  const found = new Map();
  let done = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < prefixes.length) {
      const prefix = prefixes[cursor++];

      for (const suggestion of await suggest(prefix)) {
        const clean = String(suggestion).toLowerCase().trim().replace(/\s+/g, ' ');

        if (clean.length > 2 && !found.has(clean)) found.set(clean, prefix);
      }

      done++;

      if (done % 200 === 0) {
        console.log(`[harvest] ${done}/${prefixes.length} prefixes, ${found.size} unique queries`);
      }

      await sleep(DELAY_MS);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const queries = [...found.keys()].sort();

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(queries, null, 0)}\n`);

  console.log(`[harvest] wrote ${queries.length} unique queries -> ${OUT}`);
}

main();
