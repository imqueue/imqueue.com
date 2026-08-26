// Delivery semantics / monolith extraction / testing — 346 queries, all three pages read in full.
//
// /blog/guaranteed-message-delivery-cost/ is the site's definitive treatment of delivery semantics.
// It defines at-most-once, at-least-once and exactly-once; states that exactly-once DELIVERY is not
// achievable and no broker provides it, with the Two Generals reason; distinguishes exactly-once
// PROCESSING (idempotent effects, which is what Kafka transactions and SQS FIFO dedup actually are);
// and says in as many words that at-least-once is what "guaranteed delivery" means "here and in
// RabbitMQ, SQS, NATS JetStream and Kafka alike". Then @imqueue's two modes with measured cost
// (~200k unreliable vs ~120k safe), what safeDeliveryTtl governs, and a decision guide whose second
// question is "is the work idempotent?" with idempotency keys and dedupe checks.
//
//   -> So a query about a delivery SEMANTIC has a real answer here even when it names a broker the
//      page does not: the answer is broker-independent and the page gives it outright. The old rules
//      called 35 of these a content gap ("delivery semantics of a specific third-party broker") and
//      6 more ("idempotency — the subject of none"). Both verdicts were wrong.
//   -> A query about a broker's own CONFIGURATION for delivery (Kafka Connect, KIP-98, Debezium,
//      Flink, enable_exactly_once_delivery) is not answered here, and that is a different thing.
//
// /blog/monolith-to-services-first-extraction/ is about HOW to extract one capability: picking a
// loosely-coupled, clearly-bounded, independently-valuable capability; naming good candidates
// (image/PDF processing, notifications, pricing, search indexing) and bad ones; defining the seam as
// a typed call with code; keeping the blast radius small; iterating only if it paid off.
//   -> It never argues whether to use microservices at all. The old "monolith-versus-microservices
//      debate itself" gap verdict was CORRECT, and stands.
//
// /blog/testing-microservices-without-the-whole-stack/ is three layers: the service is an ordinary
// TypeScript class so unit-test it directly; typed generated clients are seams and a fake that drifts
// stops compiling; one real service plus the queue for serialization, delivery and timeouts.
//   -> It does not cover contract testing, Pact, chaos, load, performance, security or the tooling
//      ecosystem. The old "test disciplines beyond the layered approach" gap was right about those.

import type { PositiveJudgement, NegativeJudgement } from './types.ts';

const SEMANTICS = [
  'at least once delivery', 'at least once delivery guarantee', 'at least once delivery meaning',
  'at least once delivery model', 'at least once delivery pattern',
  'at least once delivery semantics', 'at least once delivery vs',
  'at least once delivery vs exactly once delivery', 'at least once delivery wikipedia',
  'at least once delivery with idempotent consumers', 'at least once message delivery',
  'at least once vs exactly once delivery', 'at most once delivery guarantee',
  'at most once message delivery', 'at most once vs at least once delivery',
  'exactly once delivery', 'exactly once delivery guarantee', 'exactly once delivery impossible',
  'exactly once delivery là gì', 'exactly once delivery semantics',
  'exactly once delivery vs exactly once processing', 'exactly once message delivery',
  'exactly-once delivery problem', 'is exactly once delivery possible',
  'why exactly once delivery is impossible', 'you cannot have exactly once delivery',
  'how to achieve exactly once delivery', 'how to ensure exactly once delivery',
  'how to guarantee exactly once delivery', 'distributed systems exactly once delivery',
  'message delivery guarantees', 'message queue delivery guarantees',
  'guaranteed message delivery', 'guaranteed delivery message queue',
  'reliable message delivery', 'what does at least once delivery mean',
  'what is at least once delivery', 'what is exactly once delivery',
  'what does guaranteed delivery mean', 'queue at least once delivery',
  'message delivery guarantee modes in amqp',
  // named brokers — the page names four of them and its claim covers the rest
  'at least once delivery aws', 'at least once delivery kafka', 'at least once delivery pubsub',
  'at least once delivery rabbitmq', 'at least once delivery sqs', 'at most once delivery kafka',
  'activemq exactly once delivery', 'akka message delivery guarantees',
  'apache kafka exactly once delivery', 'aws eventbridge at least once delivery',
  'aws sns at least once delivery', 'aws sns exactly once delivery',
  'aws sqs at least once delivery', 'aws sqs exactly once delivery',
  'azure event hub at least once delivery', 'azure service bus at least once delivery',
  'azure service bus exactly once delivery', 'ddb stream at least once delivery',
  'does kafka guarantee at least once delivery', 'does kafka guarantee exactly once delivery',
  'does kafka have exactly once delivery', 'does kafka offer exactly once delivery',
  'does kafka support exactly once delivery semantics',
  'does rabbitmq guarantee exactly-once delivery',
  'does sns guarantee at least once delivery', 'does sqs guarantee at least once delivery',
  'does sqs guarantee exactly once delivery', 'dynamodb streams at least once delivery',
  'event grid at least once delivery', 'event hub at least once delivery',
  'eventbridge at least once delivery', 'eventbridge exactly once delivery',
  'exactly once delivery aws', 'exactly once delivery in kafka', 'exactly once delivery kafka',
  'exactly once delivery pub sub', 'exactly once delivery pubsub',
  'exactly once delivery rabbitmq', 'exactly once delivery sqs',
  'fifo queue exactly once delivery', 'firehose at least once delivery',
  'gcp exactly once delivery', 'gcp pubsub exactly once delivery',
  'google pubsub exactly once delivery', 'ibm mq exactly once delivery',
  'ibm mq guaranteed message delivery', 'is kafka at least once delivery',
  'is sns at least once delivery', 'is sqs at least once delivery',
  'is sqs exactly once delivery', 'kinesis at least once delivery',
  'kinesis exactly once delivery', 'message delivery guarantees in kafka',
  'message delivery guarantees kafka', 'message delivery guarantees rabbitmq',
  'mqtt at least once delivery', 'nats at least once delivery', 'nats exactly once delivery',
  'nats jetstream exactly once delivery', 'only once delivery kafka',
  'pub sub at least once delivery', 'redis at least once delivery',
  'service bus at least once delivery', 'service bus exactly once delivery',
  'signalr guaranteed message delivery', 'sns at least once delivery',
  'sns exactly once delivery', 'sqs fifo exactly once delivery',
  'what is at least once delivery in kafka',
  // idempotency — the decision guide's second question, with keys and dedupe checks
  'idempotency in microservices', 'idempotency meaning in microservices',
  'idempotency microservices', 'idempotent operations in microservices',
  'how to achieve idempotency in microservices',
];

const MONOLITH = [
  'breaking monolith to microservices', 'convert monolith to microservices example',
  'decomposing monolith to microservices', 'from monolith to microservices',
  'how do i decide when to split a monolith into services',
  'how to convert monolith to microservices', 'how to migrate monolith to microservices',
  'how to split a monolith into microservices', 'how to split monolith to microservices',
  'migrating monolith to microservices challenges', 'migration from monolith to microservices',
  'migration of monolith to microservices', 'monolith into microservices',
  'monolith to microservices', 'monolith to microservices architecture',
  'monolith to microservices at scale', 'monolith to microservices best practices',
  'monolith to microservices conversion', 'monolith to microservices design patterns',
  'monolith to microservices evolutionary patterns', 'monolith to microservices example',
  'monolith to microservices meaning', 'monolith to microservices migration',
  'monolith to microservices migration patterns',
  'monolith to microservices migration strategies', 'monolith to microservices patterns',
  'monolith to microservices refactoring project', 'monolith to microservices strategy',
  'monolith to microservices transformation', 'monolithic application to microservices example',
  'monolithic to microservices architecture with patterns & best practices',
  'monolithic to microservices challenges', 'monolithic to microservices migration challenges',
  'monolithic to microservices migration design patterns',
  'monolithic to microservices migration steps', 'monolithic to microservices steps',
  'moving from monolith to microservices architecture', 'refactoring monolith to microservices',
  'why move from monolith to microservices',
];

const TESTING = [
  'how to test microservices', 'e2e testing microservices',
  'integration testing between microservices', 'integration testing for microservices',
  'integration testing in microservices', 'integration testing multiple microservices',
  'integration testing of microservices', 'integration testing with microservices',
  'microservices testing example', 'microservices testing framework',
  'microservices testing means', 'microservices testing pyramid',
  'microservices testing strategy', 'test microservice là gì', 'test microservices locally',
  'testing event driven microservices', 'testing for microservices', 'testing in microservices',
  'testing in microservices architecture', 'testing microservices',
  'testing microservices architecture', 'testing microservices best practices',
  'testing microservices the sane way', 'testing of microservices',
  'testing pyramid for microservices', 'testing strategy for microservices architecture',
  'unit testing in microservices', 'unit testing microservices',
];

// ================================================= NEGATIVE

// A specific product's own configuration for achieving a delivery guarantee.
const BROKER_CONFIG = [
  'debezium exactly once delivery', 'enable_exactly_once_delivery',
  'flink exactly once delivery', 'how to ensure exactly once delivery in kafka',
  'kafka connect exactly once delivery', 'kafka producer exactly once delivery',
  'kip 98 exactly once delivery and transactional messaging',
  'which message delivery semantic is guaranteed by kafka connect',
];

// "delivery" as parcels, post and text messages.
const POSTAL = [
  'delivered exactly reviews', 'delivery done or done delivery', 'delivery message example',
  'delivery quotes sayings', 'delivery time quotes', 'do you do delivery meaning',
  'does amazon have a delivery guarantee', 'estimated delivery date courier',
  'first delivery attempt meaning', 'first delivery meaning', 'guarantee letter delivery',
  'guaranteed mail delivery', 'how long after shipping is delivery',
  'instant delivery meaning', 'is sms guaranteed delivery', 'late delivery meaning',
  'loose delivery meaning', 'message delivery restrictions', 'missed delivery meaning',
  'no delivery meaning', 'on its way delivery meaning', 'order out for delivery meaning',
  'sms guaranteed delivery', 'what does delivered mean on message',
  "what happens if a special delivery doesn't arrive", 'what is royal mail guaranteed delivery',
  'what is royal mail special delivery guaranteed', 'what is special delivery guaranteed',
  "why won't my message deliver",
];

// Whether to adopt microservices at all. The extraction page assumes you have decided.
const THE_DEBATE = [
  'microservices back to monolith', 'monolith and microservices difference',
  'monolith in microservices', 'monolith microservices hybrid',
  'monolith microservices serverless', 'monolith or microservices',
  'monolith or microservices reddit', 'monolith over microservices',
  'monolith và microservices', 'monolith vs microservices',
  'monolith vs microservices adalah', 'monolith vs microservices architecture',
  'monolith vs microservices comparison', 'monolith vs microservices cost',
  'monolith vs microservices example', 'monolith vs microservices explained',
  'monolith vs microservices là gì', 'monolith vs microservices nedir',
  'monolith vs microservices pros and cons', 'monolith vs microservices reddit',
  'monolith vs microservices system design', 'monolith vs microservices tradeoffs',
  'monolith vs microservices vs serverless',
  'monolith vs microservices when not to use microservices',
  'monolith vs microservices when to use', 'monolith with microservices',
  'monolithic microservices and serverless architectures',
];

// Books, papers, conference material and diagrams about the migration.
const MONOLITH_MEDIA = [
  'from monolith to microservices a classification of refactoring approaches',
  'from monolith to microservices a comparative evaluation of decomposition frameworks',
  'from monolith to microservices a systematic literature survey',
  'from monolith to microservices book', 'from monolith to microservices by sam newman',
  'from monolith to microservices pdf',
  'migration from monolith to microservices benchmarking a case study',
  'monolith to microservices 2nd edition', 'monolith to microservices amazon',
  'monolith to microservices book', 'monolith to microservices book pdf',
  'monolith to microservices book reddit', 'monolith to microservices by sam newman',
  'monolith to microservices diagram', 'monolith to microservices epub',
  'monolith to microservices free pdf', 'monolith to microservices github',
  'monolith to microservices goodreads', 'monolith to microservices newman',
  "monolith to microservices o'reilly", "monolith to microservices o'reilly pdf",
  'monolith to microservices pdf', 'monolith to microservices pdf download',
  'monolith to microservices pdf free download', 'monolith to microservices pdf github',
  'monolith to microservices reddit', 'monolith to microservices sam newman',
  'monolith to microservices sam newman pdf github',
  'monolith to microservices strangler pattern',
  'monoliths to microservices migration problems and challenges a sms',
  'monolith vs microservices book', 'monolith vs microservices diagram',
  'monolith vs microservices interview questions', 'monolith vs microservices meme',
];

// The migration in another ecosystem, on a specific cloud, or as a named case study.
const MONOLITH_ELSEWHERE = [
  '.net monolith to microservices', 'aws transform monolith to microservices',
  'convert monolith to microservices case study', 'doordash monolith to microservices',
  'from monolith to microservices migrate and modernize with amazon eks',
  'java monolith to microservices',
  'learn spring modulith monolith to microservices seamlessly',
  'migrate monolithic to microservices azure', 'migrating monolith to microservices aws',
  'monolith to microservices aws', 'monolithic to microservices migration tools',
  'monolithic to microservices data migration strategy',
  'monolithic to microservices spring boot', 'netflix monolith to microservices',
  'rails monolith to microservices',
];

// Test disciplines and tooling the layered page does not cover.
const TESTING_ELSEWHERE = [
  'automation testing in microservices', 'chaos testing microservices',
  'component testing in microservices', 'component testing microservices',
  'contract testing for microservices', 'contract testing in microservices',
  'contract testing in microservices based systems a survey',
  'contract testing microservices', 'contract testing microservices example',
  'contract testing microservices spring boot', 'load testing microservices',
  'martin fowler microservices testing strategy', 'microservices api testing',
  'microservices automation testing using selenium',
  'microservices contract testing with pact', 'microservices performance testing',
  'microservices performance testing tools',
  'microservices performance testing using jmeter', 'microservices qa testing',
  'microservices security testing', 'microservices test automation',
  'microservices test automation framework',
  'microservices testing a systematic literature review',
  'microservices testing course', 'microservices testing honeycomb',
  'microservices testing interview questions',
  'microservices testing interview questions for experienced',
  'microservices testing tools', 'microservices testing tutorial',
  'microservices testing udemy', 'microservices testing using rest assured',
  'pact testing microservices', 'penetration testing microservices',
  'performance testing for microservices',
  'performance testing in microservices architecture',
  'performance testing of microservices', 'spring boot microservices testing',
  'testing java microservices', 'testing java microservices book',
  'testing java microservices pdf', 'testing java microservices pdf github',
  'testing microservices ai features', 'testing microservices book',
  'testing microservices fowler', 'testing microservices martin fowler',
  'testing microservices with mountebank', 'testing microservices with mountebank pdf',
  'testing of microservices spotify', 'unit testing microservices c#',
  'unit testing microservices spring boot', 'integration testing microservices spring boot',
];

export const positive: readonly PositiveJudgement[] = [
  ['/blog/guaranteed-message-delivery-cost/', 'delivery guarantees', SEMANTICS],
  ['/blog/monolith-to-services-first-extraction/', 'monolith to services', MONOLITH],
  ['/blog/testing-microservices-without-the-whole-stack/', 'testing services', TESTING],
];

export const negative: readonly NegativeJudgement[] = [
  ["a specific broker's own configuration for a delivery guarantee", BROKER_CONFIG],
  ['"delivery" as parcels, post and text messages', POSTAL],
  ['whether to adopt microservices at all — the extraction page assumes you have', THE_DEBATE],
  ['books, papers and diagrams about the migration', MONOLITH_MEDIA],
  ['the migration in another ecosystem, cloud, or as a named case study', MONOLITH_ELSEWHERE],
  ['test disciplines and tooling the layered approach does not cover', TESTING_ELSEWHERE],
];
