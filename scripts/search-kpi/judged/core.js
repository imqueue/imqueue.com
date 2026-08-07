// The last 412 natural queries — the on-topic core, plus the remaining keyword wreckage.
//
// Judged against pages whose headings and anchored FAQ answers are all in `answers.md`, and whose
// bodies I read where the call was close. Notable content facts driving these:
//
//   * "how do microservices communicate" is the single biggest block here (~60 queries) and
//     /blog/nodejs-service-communication-options-2026/ exists to answer exactly it: six options with
//     a side-by-side table and "What we would actually tell you to pick".
//   * The site never DEFINES an API gateway generically, but /tutorial/api-service/ builds a GraphQL
//     one over the fleet and /tutorial/rest-api/ rebuilds it as REST/OpenAPI with Swagger UI. So
//     "build an api gateway in node" is answered and "what is an api gateway" is not. The old gap
//     verdict on the generic question was right.
//   * Circuit breakers: two pages state outright that @imqueue ships none, and say what the queue
//     gives you instead. /blog/rpc-over-redis-nodejs/#is-there-a-circuit-breaker is that answer, and
//     it is an indexed section, so it is the precise target for the pattern-level question. Hunting
//     for a Node circuit-breaker LIBRARY (opossum) has no answer here.
//   * Back-pressure: /blog/backpressure-nodejs-services/ is about a downstream SERVICE slowing down,
//     not about Node stream back-pressure. The old "back-pressure in Node streams" gap was right.
//   * Old gap verdicts confirmed correct by this pass: generic API gateway, horizontal vs vertical
//     scaling as a concept, general microservices theory, general TypeScript/Node advice, generating
//     clients from an OpenAPI document, the JSON-RPC specification itself.
//   * "IMQ" is also a Spanish health insurer with dental clinics in Bilbao, Pamplona and Vitoria.

'use strict';

const COMMUNICATE = [
  'how communicate asynchronously between two microservices',
  'how different microservices communicate with each other', 'how do microservices communicate',
  'how do microservices communicate internally',
  'how do microservices communicate internally and externally',
  'how do microservices communicate reliably with each other',
  'how do microservices communicate securely',
  'how do microservices communicate with each other',
  'how do microservices communicate with each other example',
  'how do microservices communicate with each other synchronous vs asynchronous',
  'how do the microservices communicate with each other',
  'how do you communicate between microservices',
  'how independent microservices communicate with each other',
  'how many ways microservices communicate with each other',
  'how microservices are communicating with each other',
  'how microservices can communicate with each other', 'how microservices communicate',
  'how microservices communicate asynchronously',
  'how microservices communicate between each other',
  'how microservices communicate each other', 'how microservices communicate internally',
  'how microservices communicate to each other',
  'how microservices communicate with each other',
  'how microservices communicate with each other in node js',
  'how microservices communicate with each other interview questions',
  'how microservices communicate with each other synchronously',
  'how microservices communicate with each other using rest api',
  'how microservices communicate with database', 'how microservices talk to each other',
  'how microservices will communicate with each other',
  'how multiple microservices communicate with each other',
  'how services communicate in microservices', 'how should microservices communicate',
  'how should microservices communicate with each other',
  'how to communicate between microservices',
  'how to communicate between microservices in node js',
  'how to communicate between microservices nodejs',
  'how to communicate between two microservices', 'how to communicate multiple microservices',
  'how to make microservices communicate', 'how to make microservices communicate with each other',
  'how to make two microservices communicate', 'how to secure microservices communicate with each other',
  'how two microservices communicate', 'how two microservices communicate with each other',
  'microservices how do they communicate', 'microservices how they communicate',
  'microservices how to communicate',
];

const GATEWAY = [
  'api gateway for microservices in node js', 'api gateway for nodejs', 'api gateway in nodejs',
  'api gateway microservices nodejs', 'api gateway node js example', 'api gateway nodejs',
  'api gateway nodejs example', 'api gateway nodejs express', 'api gateway using node js',
  'api gateway with nodejs', 'best api gateway for node js', 'build api gateway using node js',
  'create an api gateway using nodejs and express', 'create api gateway node js',
  'how to create api gateway in node js', 'implement api gateway in nodejs',
  'node js api gateway example', 'node js as api gateway', 'node js express api gateway',
  'nodejs api gateway framework', 'graphql api gateway microservices',
  'graphql gateway microservices',
];

const SCHEDULED = [
  'alternative to cron', 'alternative to node cron', 'node cron alternatives',
  'cron job for node js', 'cron job in nodejs', 'cron job nodejs', 'cron job on node js',
  'cron job schedule nodejs', 'cron job scheduler node js', 'cron job using node js',
  'cron job with node js', 'dynamic cron job nodejs', 'nodejs run cron job',
  'schedule job nodejs', 'task scheduling nodejs', 'background process nodejs',
  'background task in nodejs', 'background task nodejs',
];

const JOB_QUEUE = [
  'background jobs for nodejs', 'background jobs in nodejs', 'background jobs nodejs',
  'node background jobs', 'nodejs background jobs', 'nodejs background jobs library',
  'node js job queue', 'nodejs job queue', 'node js queue jobs', 'nodejs task queue',
  'nodejs work queue', 'nodejs in memory job queue',
];

const CIRCUIT_BREAKER = [
  'circuit breaker in microservices nodejs', 'circuit breaker in nodejs',
  'circuit breaker microservices node js', 'circuit breaker nodejs',
  'circuit breaker pattern in microservices nodejs', 'circuit breaker pattern in nodejs',
  'circuit breaker pattern nodejs', 'how to implement circuit breaker in nodejs',
];

const MESSAGE_QUEUE = [
  'message queue for node js', 'message queue in node js', 'message queue in nodejs',
  'message queue nodejs', 'node js message queue', 'nodejs message queue',
  'message broker for node js', 'message broker in nodejs', 'message broker nodejs',
  'is the build in node.js message queue good',
];

const RPC = [
  'nodejs rpc', 'nodejs rpc client', 'nodejs rpc framework', 'nodejs rpc server',
  'node js rpc framework', 'rpc between microservices', 'rpc communication between microservices',
  'rpc in nodejs',
];

const REST_VS_RPC = ['rest vs rpc'];

const TYPE_SAFETY = [
  'end to end type safety typescript', 'microservices in typescript',
  'microservices with typescript', 'type safe api client', 'typescript for microservices',
  'typescript in microservices architecture effective patterns and techniques',
  'typescript microservices', 'typescript microservices example',
  'node js typescript microservices',
];

const TYPED_RPC = [
  'rpc in typescript', 'typescript rpc', 'typescript rpc framework', 'typescript rpc library',
];

const FRAMEWORK_CHOICE = [
  'best message queue for node js', 'best microservices framework for node js',
  'best node js framework for microservices', 'best node js microservices framework',
  'node js framework for microservices', 'nodejs microservices framework',
  'typescript microservices framework', 'node js most popular framework',
];

const DISCOVERY = [
  'service discovery example', 'service discovery in microservices nodejs',
  'service discovery in nodejs', 'service discovery nodejs', 'what is service discovery',
  'why do we need service discovery in microservices', 'service mesh vs service discovery',
];

const SHUTDOWN = [
  'graceful shutdown in nodejs', 'graceful shutdown node js express', 'graceful shutdown nodejs',
  'how to gracefully shutdown node js server', 'nodejs graceful shutdown docker',
  'nodejs graceful shutdown kubernetes', 'zero downtime deployment node js',
];

const VERSIONING = [
  'api versioning example', 'api versioning in microservices', 'api versioning microservices',
  'how do you handle api versioning in microservices',
  'how do you implement api versioning in microservices',
  'microservices api versioning best practices', 'microservices versioning best practices',
  'purpose of api versioning in microservices', 'what is api versioning',
];

const AUTOSCALING = [
  'autoscaling in microservices', 'autoscaling microservices',
  'horizontal and vertical scaling nodejs', 'horizontal scaling in nodejs',
  'horizontal scaling nodejs',
];

const DEPLOYMENT = [
  'deploy microservices in docker', 'deploy microservices using docker',
  'deploying microservices in docker containers',
  'deploying microservices with docker and kubernetes', 'docker compose file for microservices',
  'docker compose for microservices',
  'docker compose multiple microservices', 'docker microservices example',
  'how do you deploy microservices using docker',
  'how to deploy multiple microservices in docker', 'microservice docker compose example',
  'microservices architecture with docker compose', 'microservices deployment process',
  'microservices deployment using docker and kubernetes', 'microservices docker compose',
  'microservices with docker compose',
];

const BACKPRESSURE = ['back pressure explained', 'back pressure in nodejs', 'back pressure nodejs'];

const TUTORIAL = [
  'node js microservices architecture tutorial', 'node js microservices example',
  'nodejs microservices tutorial',
];

const SCAFFOLD = ['nodejs microservice boilerplate'];

// ================================================= NEGATIVE

const OTHER_ECOSYSTEM = [
  'how do microservices communicate with each other in kubernetes',
  'how do microservices communicate with each other in spring boot',
  'how do netflix microservices communicate', 'how java microservices communicate with each other',
  'how microservices communicate with each other c#',
  'how microservices communicate with each other .net core',
  'how microservices communicate with each other in aws',
  'how microservices communicate with each other in azure',
  'how microservices communicate with each other in java',
  'how microservices communicate with each other in kubernetes',
  'how microservices communicate with each other in .net',
  'how microservices communicate with each other in .net core',
  'how microservices communicate with each other in spring boot',
  'how microservices communicate with each other spring boot',
  'how microservices communicate with each other spring boot example',
  'how microservices communicate with each other using resttemplate',
  'how spring boot microservices communicate with each other',
  'how spring microservices communicate with each other',
  'how to communicate between microservices in java',
  'how to communicate between microservices in .net core',
  'how to communicate between microservices in spring boot',
  'how to communicate microservices in spring boot',
  'how to communicate multiple microservices in spring boot',
  'how to microservices communicate with each other in c#',
  'how to microservices communicate with each other in spring boot',
  'how to microservices communicate with each other java',
  'how to deploy java microservices in docker', 'docker compose microservices spring boot',
  'spring boot microservices docker compose',
  'spring boot microservices with docker compose example',
  'spring boot microservices with docker compose example github',
  'graphql spring boot microservices example', 'eureka service discovery node js',
  'effect typescript rpc', 'golang typescript rpc', 'go typescript rpc',
  'python typescript rpc', 'rust typescript rpc', 'typescript rust rpc',
  'use hono rpc client for type safe api communication',
];

// A specific vendor's gateway product, or the generic definition the site never gives.
const GATEWAY_ELSEWHERE = [
  'api gateway examples', 'api gateway is used for', 'api gateway lambda node js',
  'api gateway node js github', 'api gateway nodejs github', 'api gateway routing example',
  'aws api gateway nodejs', 'aws api gateway nodejs express',
  'aws lambda node js api gateway', 'kong api gateway nodejs',
  'node js lambda api gateway example',
];

// node-cron's own syntax, or a plain JS timer.
const CRON_OWN = [
  'cron job example', 'cron job node js example', 'cron job nodejs example',
  'cron job nodejs express', 'create cron job in node js', 'node js cron job every minute',
  'nodejs cron job every hour', 'node js cron job example', 'node js cron job not trigger',
  'nodejs delay function',
];

// Hunting for a Node circuit-breaker library. The site ships none and documents none.
const CIRCUIT_LIBRARY = [
  'circuit breaker for node js', 'circuit breaker library node js',
  'circuit breaker library nodejs', 'circuit breaker node js express',
  'node js circuit breaker opossum', 'circuit breaker examples', 'circuit breaker function',
];

// Node stream back-pressure, which is a different subject from a slow downstream service.
const STREAM_BACKPRESSURE = [
  'backpressure nodejs stream', 'nodejs backpressure in streams',
  'node js stream back pressure', 'nodejs transform stream backpressure',
];

// Scaling as a general concept, and general Node/TypeScript advice.
const GENERAL_CONCEPTS = [
  'horizontal scaling example', 'horizontal scaling vs vertical scaling',
  'horizontal vs vertical scaling which is better',
  'vertical vs horizontal scaling', 'what is horizontal scaling',
  'what is horizontal scaling in aws', 'what is horizontal scaling in database',
  'difference microservices and api', 'microservices patterns list', 'microservices vs api example',
  'purpose of microservices', 'what is the purpose of microservices architecture',
  'is node js good for backend', 'node js backend best practices', 'node js backend example',
  'typescript allow any type', 'typescript api example', 'typescript best practices',
  'typescript guidelines', 'typescript type example', 'type in typescript example',
  'is c type safe', 'typescript microservices pdf', 'nodejs microservices interview questions',
  'exam microservices architecture 64650', 'microservices release date',
];

// The JSON-RPC specification, and generating clients from an OpenAPI document.
const OTHER_SPECS = [
  'json rpc 2.0 nodejs', 'json rpc nodejs', 'json rpc request example', 'nodejs json rpc',
  'nodejs json rpc client', 'typescript json rpc', 'typescript json rpc client',
  'types of rpc', 'generate typescript api client from openapi',
  'generate typescript api client from swagger', 'nodejs discord rpc',
];

// Kubernetes' and Windows' own discovery, and Land Rover Discovery servicing.
const DISCOVERY_ELSEWHERE = [
  'do i need service discovery in kubernetes', 'does kubernetes have service discovery',
  'do i need winhttp web proxy auto discovery service', 'discovery car service cost',
  'discovery service cost', 'how often do i need to service my land rover discovery sport',
  'is discovery mandatory',
];

// IMQ is also a Spanish health insurer with dental clinics.
const IMQ_CLINIC = [
  'clinica dental deusto imq', 'clinica.imq zorrotzaurre', 'imq clientes', 'imq clinic',
  'imq clinica', 'imq clinica dental', 'imq clinica dental bilbao',
  'imq clinica dental pamplona', 'imq clinica dental vitoria', 'imq clinica san miguel',
];

// Everything the keyword tool dragged in on "alternative", "page", "boss", "split", "vs",
// "delivery", "service client", "circuit breaker", "back pressure", "type" and "jobs".
const NOISE = [
  'alternative or alternatives', 'alternatives to grading', 'alternatives to low fodmap diet',
  'alternatives to n/a', 'alternative to half burpee', 'beat the alternative meaning',
  'benefits of dewberries', 'berkshire villages list', 'better versus best',
  'between nce and nd which one is higher', 'boss page isaac', 'boss page turner',
  'boss page type soul', 'bs better than ba', 'bst vs binary heap', 'bu vs bc',
  'cheaper alternatives to a patio', 'cheaper alternatives to butternut box',
  'coloring page boss baby', 'de del difference', 'de versus del',
  'delayed start date for new job', 'disney cars minis codes', 'grazing vs browsing',
  'halt healthier alternative', 'healthy alternatives to drugs', 'healthy alternative to jam',
  'healthy side alternatives', 'herediano vs alajuelense prediction',
  'how often do anemones split', 'how to get rid of cursor in minecraft mac',
  'install minecraft server', 'is api safe', 'is express shipping guaranteed',
  'is no back pressure bad', 'jimmy page boss sd1', 'karen page boss daredevil',
  'macular degeneration', 'magic mouse cursor not moving', 'mail type service client',
  'message type service client', 'microservices vs microservices', 'model the way examples',
  'mono split vs multi split', 'mouse pointer intermittently freezes', 'my mouse finger hurts',
  'natural alternatives menahga', 'north vs south differences', 'page 6 boss babe award',
  'page boss mine phone', "page's boss in the madison", "page's boss on the madison",
  'page six boss babe award', 'pge supervisor', 'pge supervisor jobs', 'pge supervisor salary',
  'range vs pasture', 'réponse type service client', 'saddle point vs max vs min',
  'service client 3f', 'service client red', 'service client ter', 'should i split my monstera',
  'type de service client', 'types of alternative fuels', 'weak vs semi strong vs strong',
  'what are alternative fuels an alternative to', 'what does no downtime mean',
  'what is better pasture raised vs grass fed', 'what is shipping guarantee',
  'when to split anemones', 'when to split monstera', 'yeni t roc', 'zero downtime meaning',
  'back pressure vs pressure drop', 'back pressure vs true pressure',
  'circuit breaker closing time', 'circuit breaker operating time', 'circuit breaker rules',
  'circuit breaker schedule', 'main circuit breaker types', 'junior node js jobs',
  'node js entry level jobs', 'nodejs backend jobs', 'immich microservices docker compose',
  'is docker compose free', 'ups the graceful shutdown period has ended',
];

module.exports = {
  positive: [
    ['/blog/nodejs-service-communication-options-2026/', 'service communication', COMMUNICATE],
    ['/tutorial/api-service/', 'api gateway', GATEWAY],
    ['/blog/scheduled-work-without-a-job-system/', 'scheduled work', SCHEDULED],
    ['/blog/bullmq-alternatives/', 'background jobs', JOB_QUEUE],
    ['/blog/rpc-over-redis-nodejs/#is-there-a-circuit-breaker', 'circuit breaker', CIRCUIT_BREAKER],
    ['/blog/rpc-over-message-queue-nodejs/', 'message queue for node', MESSAGE_QUEUE],
    ['/blog/rpc-over-message-queue-nodejs/', 'rpc between services', RPC],
    ['/blog/internal-apis-dont-need-rest/', 'rest vs rpc', REST_VS_RPC],
    ['/blog/type-safe-service-communication-typescript/', 'type safety', TYPE_SAFETY],
    ['/', 'typed rpc framework', TYPED_RPC],
    ['/compare/', 'framework choice', FRAMEWORK_CHOICE],
    ['/blog/do-nodejs-backends-need-service-discovery/', 'service discovery', DISCOVERY],
    ['/blog/graceful-shutdown-zero-drop-deploys/', 'graceful shutdown', SHUTDOWN],
    ['/blog/versioning-microservices-without-breaking-callers/', 'versioning', VERSIONING],
    ['/api/faq/#how-do-i-auto-scale-imqueue-services', 'autoscaling', AUTOSCALING],
    ['/tutorial/deployment/', 'deployment', DEPLOYMENT],
    ['/blog/backpressure-nodejs-services/', 'back-pressure', BACKPRESSURE],
    ['/tutorial/', 'tutorial', TUTORIAL],
    ['/cli/creating-services/', 'scaffolding', SCAFFOLD],
  ],
  negative: [
    ['the same question in another language ecosystem or cloud', OTHER_ECOSYSTEM],
    ["a vendor's gateway product, or the generic definition the site never gives", GATEWAY_ELSEWHERE],
    ["node-cron's own syntax, or a plain JS timer", CRON_OWN],
    ['hunting for a Node circuit-breaker library; the site ships and documents none', CIRCUIT_LIBRARY],
    ['Node stream back-pressure, a different subject from a slow downstream service', STREAM_BACKPRESSURE],
    ['scaling, microservices or TypeScript as a general concept', GENERAL_CONCEPTS],
    ['the JSON-RPC spec, or generating a client from an OpenAPI document', OTHER_SPECS],
    ["Kubernetes', Windows' or Land Rover's discovery", DISCOVERY_ELSEWHERE],
    ['IMQ the Spanish health insurer and its dental clinics', IMQ_CLINIC],
    ['keyword-tool wreckage on alternative / page / boss / split / vs / service client', NOISE],
  ],
};
