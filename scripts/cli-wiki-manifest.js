// Editorial layer for the CLI User Guide (/cli/).
//
// The page BODIES are owned by @imqueue/cli and live in that repo's wiki/*.md;
// they are synced into src/org/cli/*.md by scripts/sync-cli-wiki.js. Everything
// in THIS file is website-only and never comes from the wiki: the chapter order,
// the on-page/sidebar titles, and the SEO front matter (lead, description,
// keywords). Add/remove/re-order a chapter here and both the generated pages and
// the sidebar (src/org/cli/cli.11tydata.js reads this file) follow automatically.
//
// `wiki` — source file name in the cli wiki.
// `out`  — output file under src/org/cli/ (index.md is the /cli/ landing page).
// `url`  — public URL (used for the sidebar + prev/next and link rewriting).
// `nav`  — short label shown in the sidebar.
// The rest are front-matter fields written verbatim onto each generated page.
const pages = [
  {
    wiki: "Home.md", out: "index.md", url: "/cli/", nav: "Overview",
    title: "CLI User Guide",
    lead: "Everything about the imq command — from installation to writing your own templates and adapting the tool to real-world projects.",
    description: "The @imqueue/cli (imq) user manual — a Rapid Application Development tool that scaffolds services, wires VCS/CI/registry providers, generates typed RPC clients and runs a local fleet.",
    keywords: "@imqueue/cli, imq command, imqueue CLI, Node.js microservice scaffolding, RPC client generator, service generator CLI, RAD tool, TypeScript microservices tooling",
  },
  {
    wiki: "Installation.md", out: "installation.md", url: "/cli/installation/", nav: "Installation",
    title: "Installation",
    lead: "Install @imqueue/cli, check requirements, upgrade from 3.x, and enable shell completions.",
    description: "Install @imqueue/cli globally, verify the imq command, upgrade from 3.x, enable bash & zsh completions, and see which files the CLI creates.",
    keywords: "install @imqueue/cli, imq install, npm i -g @imqueue/cli, imq completions, upgrade imqueue cli, imq requirements",
  },
  {
    wiki: "Configuration.md", out: "configuration.md", url: "/cli/configuration/", nav: "Configuration",
    title: "Configuration",
    lead: "How the CLI resolves options across config layers, the structured v4 schema, secrets, git transport, and every environment variable.",
    description: "@imqueue/cli configuration: the flag → .imqrc.json → global config → prompt → default precedence, the v4 schema, secrets handling, HTTPS vs SSH push, and env var reference.",
    keywords: "imq config, imqueue cli configuration, imqrc.json, imq config init, vcs.protocol, IMQ_CLI_HOME, imqueue env variables",
  },
  {
    wiki: "Creating-Services.md", out: "creating-services.md", url: "/cli/creating-services/", nav: "Creating Services",
    title: "Creating Services",
    lead: "imq service create — scaffold a service from a template and, optionally, create the repo, provision CI secrets, commit, push and tag it.",
    description: "Create @imqueue services with imq service create: the four provider axes, every option, --dry-run previews, the full create pipeline, failure & rollback, and non-interactive/CI usage.",
    keywords: "imq service create, imqueue scaffold service, service generator, four axis provider model, dry-run, non-interactive service create, .imqrc.json",
  },
  {
    wiki: "Package-Catalog.md", out: "package-catalog.md", url: "/cli/package-catalog/", nav: "Package Catalog",
    title: "Package Catalog",
    lead: "Add secondary @imqueue libraries to a new service with --packages, wired in automatically from a data-driven catalog.",
    description: "The @imqueue/cli addon package catalog: adding libraries with --packages, exclusive vs feature groups, what each addon injects, interactive selection, and extending the catalog.",
    keywords: "imq packages, imqueue addon catalog, --packages, service addons, opentelemetry pg-cache sequelize, imq service packages",
  },
  {
    wiki: "Providers.md", out: "providers.md", url: "/cli/providers/", nav: "Providers",
    title: "Providers",
    lead: "The typed provider registry behind the four axes — each VCS host, CI provider and container registry, the credentials it needs, and how CI and registry compose.",
    description: "@imqueue/cli providers: GitHub/GitLab/Bitbucket VCS hosts, GitHub Actions/CircleCI/Travis CI, Docker Hub/Google/AWS ECR/Azure ACR registries, M+N composition, and enterprise/self-hosted overrides.",
    keywords: "imqueue cli providers, --vcs --ci --registry, github gitlab bitbucket, github actions circleci travis, dockerhub artifact registry ecr acr, enterprise self-hosted",
  },
  {
    wiki: "Clients-and-Versioning.md", out: "clients-and-versioning.md", url: "/cli/clients-and-versioning/", nav: "Clients & Versioning",
    title: "Clients & Versioning",
    lead: "Generate strongly-typed RPC clients from running services, and bump versions across many services to trigger CI.",
    description: "@imqueue/cli client generation and versioning: imq client generate for typed RPC clients from a running service, and imq service update-version to release across many services.",
    keywords: "imq client generate, typed rpc client, imq service update-version, version bump microservices, imqueue client generation, update-version vs up",
  },
  {
    wiki: "Managing-Local-Services.md", out: "managing-local-services.md", url: "/cli/managing-local-services/", nav: "Managing Local Services",
    title: "Managing Local Services",
    lead: "Run a whole fleet of services side by side with imq ctl, imq log and imq up — start, stop, tail logs and bulk-update dependencies.",
    description: "Manage a local @imqueue fleet: imq ctl start/stop/restart/status, combined colour-prefixed logs with imq log, and bulk dependency updates with imq up, including source-level service discovery.",
    keywords: "imq ctl, imq log, imq up, local services, service discovery, start stop restart microservices, combined logs, bulk dependency update",
  },
  {
    wiki: "Custom-Templates.md", out: "custom-templates.md", url: "/cli/custom-templates/", nav: "Custom Templates",
    title: "Custom Templates",
    lead: "Use the built-in default, a published template, or your own — pointed at by name, git URL or local path — with %TOKEN substitution and fragment overlays.",
    description: "Author @imqueue/cli templates: selecting a template, the v2 imq-template.json manifest, %TOKEN substitution, addon token points, fragment overlays, and writing your own template.",
    keywords: "imqueue custom templates, imq-template.json, %TOKEN substitution, template v2 manifest, addon token points, fragment overlays, IMQ_TEMPLATES_REPO",
  },
  {
    wiki: "Extensibility.md", out: "extensibility.md", url: "/cli/extensibility/", nav: "Extensibility",
    title: "Extensibility",
    lead: "The seams for adapting the tool to your environment — environment overrides, data-driven templates and catalog, and how contributors add new providers.",
    description: "Extend @imqueue/cli: the four-axis provider model, environment seams for enterprise/self-hosted hosts, data-driven templates and catalog, and a contributor guide to adding providers.",
    keywords: "imqueue cli extensibility, provider model, add a provider, environment seams, data-driven templates, catalog.json, contributor guide",
  },
  {
    wiki: "Real-World-Scenarios.md", out: "real-world-scenarios.md", url: "/cli/real-world-scenarios/", nav: "Real-World Scenarios",
    title: "Real-World Scenarios",
    lead: "End-to-end walkthroughs that combine the commands — new services on different stacks, a local fleet, dependency maintenance and coordinated releases.",
    description: "@imqueue/cli end-to-end recipes: new service on GitHub/Actions/Docker Hub, GitLab/CircleCI/Google, GitHub Enterprise, running a local fleet, fleet-wide dependency maintenance and coordinated releases.",
    keywords: "imqueue cli examples, service create recipes, local fleet workflow, dependency maintenance, coordinated release, github enterprise example, org standardisation",
  },
  {
    wiki: "Troubleshooting.md", out: "troubleshooting.md", url: "/cli/troubleshooting/", nav: "Troubleshooting",
    title: "Troubleshooting",
    lead: "Common issues and their fixes — hanging prompts in CI, template fetch and push failures, discovery problems, and how to reset everything.",
    description: "Troubleshoot @imqueue/cli: prompts hanging in CI, template fetch/SSH issues, git identity and push (Repository not found) failures, enterprise host setup, service discovery, and resetting state.",
    keywords: "imqueue cli troubleshooting, repository not found, imq ctl no services, template fetch fails, git identity, imq client generate fails, reset ~/.imq",
  },
];

// Link targets in the wiki that point at the framework site itself, rewritten
// for this edition (the .org site links to its own home).
const externalRewrites = {
  "https://imqueue.com": "/",
  "https://imqueue.com/": "/",
};

module.exports = { pages, externalRewrites };
