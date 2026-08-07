// tRPC / NestJS / gRPC cluster — 537 queries.
//
// Pages in play, and what each actually contains:
//
//   /blog/nodejs-service-communication-options-2026/  the six-option survey. REST is option 1 and
//     gRPC is option 2, with a "Side by side" table, "The two questions", and "What we would actually
//     tell you to pick". It also states explicitly that GraphQL, Kafka and WebSockets are NOT on the
//     list, and why. This is the page a general "X vs Y transport" question lands on.
//   /blog/grpc-vs-message-queue-rpc/  gRPC against QUEUE RPC — not against REST. .proto vs a service
//     class, failure and timeouts, what you operate, "gRPC vs @imqueue performance, honestly", and
//     where gRPC is the better choice.
//   /blog/internal-apis-dont-need-rest/  the impedance-mismatch argument for internal calls, and
//     "When REST is still the right call".
//   /blog/imqueue-vs-trpc/  what tRPC is for, what @imqueue is for, the same contract side by side,
//     transport and coupling, using them together, and six FAQ answers.
//   /blog/imqueue-vs-nestjs/  different layers of the stack, the typing difference in code,
//     addressing and routing, TRANSPORT CHOICE (Nest's transporters), feature scope, and seven FAQ
//     answers including whether Nest's Redis transporter does the same job.
//   /compare/  the one matrix across gRPC, tRPC, NestJS, Moleculer, NATS, BullMQ and REST.
//
// TWO CONTENT FACTS DECIDE THE NEGATIVES:
//   1. The site publishes no gRPC-vs-REST measurements and says so — "the published @imqueue numbers
//      are aggregate round-trips on one rig, not a head-to-head". So latency, payload-size, benchmark
//      and speed-test queries have no answer here, however on-topic they look.
//   2. The site teaches @imqueue's API. It never teaches gRPC's, tRPC's or NestJS's. Every router,
//      procedure, decorator, adapter and folder-structure query belongs to that project's own docs.

'use strict';

// ------------------------------------------------- the six-option survey

const OPTIONS = [
  'grpc and rest api', 'grpc and rest api difference', 'explain grpc vs rest',
  'grpc vs rest', 'grpc vs rest api', 'grpc vs rest api example', 'grpc vs rest call',
  'grpc vs rest comparison', 'grpc vs rest difference', 'grpc vs rest example',
  'grpc vs rest for microservices', 'grpc vs rest http', 'grpc vs rest http2',
  'grpc vs rest in microservices', 'grpc vs rest microservices', 'grpc vs rest nodejs',
  'grpc vs rest pros and cons', 'grpc vs rest protocol', 'grpc vs rest request',
  'grpc vs rest tradeoffs', 'grpc vs rest use cases', 'grpc vs rest vs',
  'grpc vs rest vs graphql', 'grpc vs rest api vs graphql', 'grpc vs rest vs http',
  'grpc vs rest when to use',
  'grpc vs rest which is better', 'grpc or rest reddit', 'grpc vs rest reddit',
  'grpc vs rest api reddit', 'grpc vs rest hacker news', 'grpc vs rest medium',
  'grpc vs rest stackoverflow', 'grpc vs rest system design', 'grpc vs rest benefits',
  'is grpc better than rest', 'what is grpc vs rest', 'what is grpc vs rest api',
  'when to use grpc vs rest api', 'why grpc vs rest', 'rest vs grpc endpoint',
  'rest vs grpc vs messaging', 'rpc vs grpc vs rest', 'grpc vs rest which is faster',
  'grpc vs rest client', 'grpc vs rest security', 'grpc and rest together',
  'grpc vs rest vs kafka', 'grpc vs rest vs rabbitmq', 'grpc vs event driven',
];

// ------------------------------------------------- gRPC against a queue

const GRPC_VS_QUEUE = [
  'grpc vs message queue', 'grpc microservices nodejs',
];

// ------------------------------------------------- REST for internal calls

const INTERNAL_REST = [
  'grpc vs rest for mobile app', 'grpc web vs rest',
];

// ------------------------------------------------- tRPC

const TRPC = [
  'trpc', 'trpc adalah', 'trpc alternatives', 'trpc and grpc', 'trpc api', 'trpc backend',
  'trpc bff', 'trpc explained', 'trpc for microservices', 'trpc in monorepo',
  'trpc kya hai', 'trpc meaning', 'trpc microservices', 'trpc monorepo', 'trpc protocol',
  'trpc rest api', 'trpc vs', 'trpc vs express', 'trpc vs graphql', 'trpc vs grpc',
  'trpc vs grpc performance', 'trpc vs grpc vs graphql', 'trpc vs grpc vs graphql vs rest',
  'trpc vs grpc vs rest', 'trpc vs grpc vs rpc', 'trpc vs rest', 'trpc vs rest api',
  'trpc what is it', 'what is trpc vs grpc', 'grpc vs trpc reddit', 'trpc service',
  'trpc framework', 'trpc web',
];

// ------------------------------------------------- NestJS

const NESTJS = [
  '@nestjs/microservices transport', 'microservices in nestjs', 'microservices using nestjs',
  'nestjs and microservices', 'nestjs for microservices', 'nestjs microservices',
  'nestjs microservices architecture', 'nestjs microservices communication',
  'nestjs microservices gateway', 'nestjs microservices grpc', 'nestjs microservices kafka',
  'nestjs microservices mqtt', 'nestjs microservices nats', 'nestjs microservices rabbitmq',
  'nestjs microservices redis', 'nestjs microservices rest api', 'nestjs microservices sqs',
  'nestjs microservices service discovery', 'nestjs microservices tcp',
  'nestjs microservices types', 'nestjs microservices with api gateway',
  'nestjs microservices api gateway', 'nestjs microservices http', 'nestjs with microservices',
  'nestjs nestjs microservices', 'nestjs multiple microservices', 'is nestjs worth it',
  'what is nestjs used for', 'why use nestjs', 'nestjs benefits',
  'nestjs microservices graphql', 'nestjs microservice and http',
  'nestjs microservice http transport', 'nestjs connect microservices',
];

// ------------------------------------------------- the matrix

const COMPARE = [
  'grpc vs rest vs graphql performance', 'grpc vs rest vs protobuf', 'grpc vs rest json',
  'grpc vs rest serialization',
  'grpc vs rest with protobuf',
];

// ================================================= NEGATIVE

// The site publishes no wire-level measurements and says so outright.
const NO_BENCHMARKS = [
  'grpc performance vs rest', 'grpc vs rest api benchmark', 'grpc vs rest api performance',
  'grpc vs rest api speed', 'grpc vs rest benchmark', 'grpc vs rest latency',
  'grpc vs rest payload size', 'grpc vs rest performance',
  'grpc vs rest performance benchmark', 'grpc vs rest performance comparison',
  'grpc vs rest performance test', 'grpc vs rest response time', 'grpc vs rest speed',
  'grpc vs rest speed comparison', 'grpc vs rest speed test', 'grpc vs tcp performance',
  'grpc web vs rest performance', 'nodejs grpc performance', 'grpc message size',
  'grpc vs rest file upload',
];

// Another language's gRPC or REST story.
const OTHER_LANGUAGE = [
  'dotnet grpc vs rest', 'go grpc vs rest', 'google grpc vs rest', 'grpc khác gì với rest',
  'grpc vs rest .net', 'grpc vs rest c#', 'grpc vs rest diferencias', 'grpc vs rest español',
  'grpc vs rest golang', 'grpc vs rest in fastapi', 'grpc vs rest java',
  'grpc vs rest performance .net core', 'grpc vs rest performance c#',
  'grpc vs rest performance golang', 'grpc vs rest performance java',
  'grpc vs rest python', 'grpc vs rest spring boot', 'rust grpc vs rest',
  'qdrant grpc vs rest', 'trpc .net', 'trpc angular', 'trpc flutter',
  'trpc go', 'trpc golang', 'trpc java', 'trpc kotlin', 'trpc python', 'trpc rust',
  'trpc fastapi',
];

// Protocols the site never puts in the comparison.
const UNCOMPARED = [
  'grpc vs rest full form', 'grpc vs rest interview questions', 'grpc vs rest template',
  'grpc vs rest vs graphql vs soap', 'grpc vs rest vs graphql vs websocket',
  'grpc vs rest vs graphql vs websocket vs soap',
  'grpc vs rest vs mqtt', 'grpc vs rest vs soap', 'grpc vs rest vs websocket',
  'json rpc vs grpc vs rest', 'thrift vs grpc vs rest', 'grpc and rest on same port',
  'trpc vs orpc', 'trpc orpc', 'trpc vs zod', 'trpc stands for', 'trpc full form',
];

// gRPC's own API and Node tooling. The site never teaches gRPC.
const GRPC_OWN = [
  'grpc api example nodejs', 'grpc api nodejs', 'grpc client example',
  'grpc endpoint example', 'grpc examples', 'grpc for nodejs', 'grpc gateway nodejs',
  'grpc in nodejs', 'grpc metadata nodejs', 'grpc nodejs', 'grpc nodejs client',
  'grpc nodejs example', 'grpc nodejs express', 'grpc nodejs tutorial',
  'grpc nodejs typescript', 'grpc on nodejs', 'grpc reflection nodejs',
  'grpc streaming nodejs', 'grpc using nodejs', 'grpc web nodejs', 'grpc with nodejs',
  'grpc-node npm', 'implement grpc in nodejs', 'node js grpc server example',
  'nodejs and grpc', 'nodejs grpc client example', 'nodejs grpc codegen',
  'nodejs grpc interceptor', 'nodejs grpc js', 'nodejs grpc server',
];

// tRPC's own API, adapters, integrations, tooling and project material.
const TRPC_OWN = [
  'drizzle zod trpc', 'k6 trpc', 'trpc agent', 'trpc agent go', 'trpc auth',
  'trpc authentication', 'trpc batching', 'trpc best practices', 'trpc better auth',
  'trpc boilerplate', 'trpc browser', 'trpc bun', 'trpc bun adapter', 'trpc caching',
  'trpc client', 'trpc cloudflare workers', 'trpc context', 'trpc database',
  'trpc deno', 'trpc dependency injection', 'trpc devtools', 'trpc docs',
  'trpc documentation', 'trpc download file', 'trpc drizzle', 'trpc effect',
  'trpc electron', 'trpc endpoint', 'trpc error', 'trpc error codes',
  'trpc error handling', 'trpc example', 'trpc expo', 'trpc express',
  'trpc fastify', 'trpc file', 'trpc file upload', 'trpc formdata',
  'trpc get query key', 'trpc getting started', 'trpc github', 'trpc graphql',
  'trpc handle error', 'trpc headers', 'trpc hono', 'trpc hono adapter',
  'trpc honojs', 'trpc hooks', 'trpc http', 'trpc http2', 'trpc httpbatchlink',
  'trpc hydrate client', 'trpc in nextjs', 'trpc infer return type',
  'trpc infinite query', 'trpc input', 'trpc install', 'trpc invalidate',
  'trpc invalidate query', 'trpc io', 'trpc javascript', 'trpc jest', 'trpc js',
  'trpc json', 'trpc json rpc', 'trpc jotai', 'trpc jwt', 'trpc jwt auth',
  'trpc kafka', 'trpc keep previous data', 'trpc koa', 'trpc lambda', 'trpc link',
  'trpc llms txt', 'trpc logger', 'trpc logging', 'trpc login', 'trpc login app',
  'trpc meta', 'trpc middleware', 'trpc mock',
  'trpc msw', 'trpc mutation', 'trpc nest', 'trpc nestjs', 'trpc next',
  'trpc nextjs', 'trpc nextjs app router', 'trpc node', 'trpc nodejs', 'trpc npm',
  'trpc nuxt', 'trpc observable', 'trpc onerror', 'trpc onsuccess', 'trpc openapi',
  'trpc opentelemetry', 'trpc optimistic update', 'trpc output', 'trpc panel',
  'trpc playground', 'trpc prefetch', 'trpc prisma', 'trpc procedures',
  'trpc query', 'trpc query cache', 'trpc query input', 'trpc query invalidation',
  'trpc query key', 'trpc query options', 'trpc query params',
  'trpc query vs mutation', 'trpc queryclient', 'trpc quick start', 'trpc react',
  'trpc react native', 'trpc react query', 'trpc reddit', 'trpc router',
  'trpc server', 'trpc setup', 'trpc skills', 'trpc sse', 'trpc streaming',
  'trpc subscriptions', 'trpc tanstack', 'trpc tanstack query', 'trpc tanstack start',
  'trpc testing', 'trpc to openapi', 'trpc tutorial', 'trpc typescript', 'trpc ui',
  'trpc unable to transform response from server', 'trpc unit testing',
  'trpc upload file', 'trpc use', 'trpc use infinite query', 'trpc usemutation',
  'trpc usequery', 'trpc usequery onsuccess', 'trpc utils', 'trpc v11',
  'trpc version', 'trpc websockets', 'trpc with express', 'trpc with hono',
  'trpc with nestjs', 'trpc with nextjs', 'trpc with react query',
  'trpc with tanstack query', 'trpc youtube', 'trpc zod', 'trpc zod 4',
  'trpc zod error', 'trpc zod error handling', 'trpc zod form data', 'trpc zod v4',
  'trpc zod validation', 'trpc zustand', 'trpc logo', 'trpc date',
  'x trpc source',
];

// NestJS's own framework surface, tutorials, boilerplates and course material.
const NESTJS_OWN = [
  'difference between nodejs and nestjs', 'learn nestjs microservices',
  'nestjs background jobs', 'nestjs cli microservice', 'nestjs create microservice',
  'nestjs custom microservice', 'nestjs ecommerce microservices',
  'nestjs fastify microservice', 'nestjs generate microservice',
  'nestjs grpc microservice github', 'nestjs hybrid microservice',
  'nestjs microservice event', 'nestjs microservice exception filter',
  'nestjs microservice exception handling', 'nestjs microservice interceptor',
  'nestjs microservice kafka github', 'nestjs microservice logging',
  'nestjs microservice port', 'nestjs microservice repository',
  'nestjs microservices architecture github', 'nestjs microservices auth',
  'nestjs microservices authentication', 'nestjs microservices aws',
  'nestjs microservices aws lambda', 'nestjs microservices best practices',
  'nestjs microservices boilerplate', 'nestjs microservices boilerplate github',
  'nestjs microservices book',
  'nestjs microservices build & deploy a scaleable backend',
  'nestjs microservices build & deploy a scaleable backend download',
  'nestjs microservices build & deploy a scaleable backend free download',
  'nestjs microservices build & deploy a scaleable backend udemy',
  'nestjs microservices build a distributed job engine',
  'nestjs microservices clean architecture', 'nestjs microservices clientproxy',
  'nestjs microservices course', 'nestjs microservices deployment',
  'nestjs microservices docker', 'nestjs microservices docker compose',
  'nestjs microservices docs', 'nestjs microservices documentation',
  'nestjs microservices enterprise grade backend development',
  'nestjs microservices error handling', 'nestjs microservices eventpattern',
  'nestjs microservices example', 'nestjs microservices example github',
  'nestjs microservices folder structure', 'nestjs microservices full course',
  'nestjs microservices github', 'nestjs microservices github example',
  'nestjs microservices grpc example', 'nestjs microservices health check',
  'nestjs microservices install', 'nestjs microservices kafka example',
  'nestjs microservices kubernetes', 'nestjs microservices messagepattern',
  'nestjs microservices middleware', 'nestjs microservices monorepo',
  'nestjs microservices npm', 'nestjs microservices nx',
  'nestjs microservices package', 'nestjs microservices payload',
  'nestjs microservices pdf', 'nestjs microservices prisma',
  'nestjs microservices project', 'nestjs microservices project github',
  'nestjs microservices project structure', 'nestjs microservices rabbitmq example',
  'nestjs microservices rabbitmq github', 'nestjs microservices reddit',
  'nestjs microservices repo', 'nestjs microservices saga',
  'nestjs microservices setup', 'nestjs microservices starter',
  'nestjs microservices structure', 'nestjs microservices tcp example',
  'nestjs microservices template', 'nestjs microservices turborepo',
  'nestjs microservices tutorial', 'nestjs microservices udemy',
  'nestjs microservices version', 'nestjs microservices with grpc',
  'nestjs microservices with grpc api gateway and authentication',
  'nestjs microservices with kafka', 'nestjs microservices with rabbitmq',
  'nestjs microservices with rabbitmq api gateway & prisma',
  'nestjs monorepo microservices docker', 'nestjs monorepo microservices example',
  'nestjs monorepo microservices github', 'nestjs project example',
  'nestjs rabbitmq without microservices', 'nestjs redis microservice example',
  'nestjs run multiple microservices', 'nestjs service example',
  'nestjs start microservice', 'nestjs websocket microservice',
  'nestjs.microservices cqrs', 'saga pattern microservices nestjs kafka',
];

// TRPC1-7 are transient receptor potential ion channels, and the acronym also belongs to a
// retirement-plan company in Oklahoma, a pigeon club and a luggage brand.
const NOISE = [
  'tllc y trpc', 'trpc 401k', 'trpc blood', 'trpc channels', 'trpc chennai',
  'trpc colorado', 'trpc company', 'trpc company gurgaon', 'trpc ct',
  'trpc dragon boat', 'trpc full form in law', 'trpc full form in medical',
  'trpc gene', 'trpc gurgaon', 'trpc gurgaon address', 'trpc gurgaon office',
  'trpc inhibitor', 'trpc jobs', 'trpc kanal', 'trpc kayak', 'trpc ltd',
  'trpc luggage', 'trpc manufacturing indonesia', 'trpc office', 'trpc oklahoma',
  'trpc pigeon club', 'trpc pittsburgh', 'trpc plan services', 'trpc range',
  'trpc retirement', 'trpc retirement login', 'trpc service team private limited',
  'trpc service team private limited gurgaon', 'trpc the retirement plan company',
  'trpc thurston', 'trpc tripura', 'trpc web login', 'trpc3', 'trpc5', 'trpc6',
  'trpcnna strain',
];

module.exports = {
  positive: [
    ['/blog/nodejs-service-communication-options-2026/', 'service communication options', OPTIONS],
    ['/blog/grpc-vs-message-queue-rpc/', 'grpc vs queue rpc', GRPC_VS_QUEUE],
    ['/blog/internal-apis-dont-need-rest/', 'rest for internal apis', INTERNAL_REST],
    ['/blog/imqueue-vs-trpc/', 'trpc', TRPC],
    ['/blog/imqueue-vs-nestjs/', 'nestjs microservices', NESTJS],
    ['/compare/', 'alternatives matrix', COMPARE],
  ],
  negative: [
    ['the site publishes no wire-level gRPC/REST measurements, and says so', NO_BENCHMARKS],
    ["another language ecosystem's gRPC, REST or tRPC story", OTHER_LANGUAGE],
    ['a protocol the site never puts in the comparison', UNCOMPARED],
    ["gRPC's own API and Node tooling", GRPC_OWN],
    ["tRPC's own API, adapters and integrations", TRPC_OWN],
    ["NestJS's own framework surface, tutorials and courses", NESTJS_OWN],
    ['TRPC as an ion channel, a retirement company, a pigeon club', NOISE],
  ],
};
