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
    description: "The @imqueue/cli (imq) manual — a tool that scaffolds services, wires VCS/CI/registry providers, generates typed RPC clients and runs a local fleet.",
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
    lead: "@imqueue/cli (the imq command) resolves every option through four layers — a command-line flag, the project's .imqrc.json, the global config, then a prompt. This page covers that precedence, the structured v4 schema, secrets, git transport, and every IMQ_* environment variable.",
    description: "@imqueue/cli configuration: the flag → .imqrc.json → global config → prompt precedence, the v4 schema, secrets handling, and the env var reference.",
    keywords: "imq config, imqueue cli configuration, imqrc.json, imq config init, vcs.protocol, IMQ_CLI_HOME, imqueue env variables",
  },
  {
    wiki: "Creating-Services.md", out: "creating-services.md", url: "/cli/creating-services/", nav: "Creating Services",
    title: "Creating Services",
    lead: "imq service create — scaffold a service from a template and, optionally, create the repo, provision CI secrets, commit, push and tag it.",
    description: "Create @imqueue services with imq service create: the four provider axes, every option, --dry-run previews, failure and rollback, and non-interactive CI use.",
    keywords: "imq service create, imqueue scaffold service, service generator, four axis provider model, dry-run, non-interactive service create, .imqrc.json",
  },
  {
    wiki: "Package-Catalog.md", out: "package-catalog.md", url: "/cli/package-catalog/", nav: "Package Catalog",
    title: "Package Catalog",
    lead: "Add secondary @imqueue libraries to a new service with --packages, wired in automatically from a data-driven catalog.",
    description: "The @imqueue/cli addon package catalog: adding libraries with --packages, exclusive vs feature groups, what each addon injects, and extending the catalog.",
    keywords: "imq packages, imqueue addon catalog, --packages, service addons, opentelemetry pg-cache sequelize, imq service packages",
  },
  {
    wiki: "Providers.md", out: "providers.md", url: "/cli/providers/", nav: "Providers",
    title: "Providers",
    lead: "@imqueue/cli scaffolds a service along four independent axes — template, VCS host, CI provider and container registry — each selected by a flag. This page lists every provider on those axes, the credentials each one needs, and how the CI and registry choices compose.",
    description: "@imqueue/cli providers: GitHub/GitLab/Bitbucket, GitHub Actions/CircleCI/Travis, Docker Hub/Google/ECR/ACR registries, and enterprise/self-hosted overrides.",
    keywords: "imqueue cli providers, --vcs --ci --registry, github gitlab bitbucket, github actions circleci travis, dockerhub artifact registry ecr acr, enterprise self-hosted",
  },
  {
    wiki: "Clients-and-Versioning.md", out: "clients-and-versioning.md", url: "/cli/clients-and-versioning/", nav: "Clients & Versioning",
    title: "Clients & Versioning",
    lead: "Generate strongly-typed RPC clients from running services, and bump versions across many services to trigger CI.",
    description: "@imqueue/cli client generation and versioning: imq client generate for typed RPC clients, and imq service update-version to release across many services.",
    keywords: "imq client generate, typed rpc client, imq service update-version, version bump microservices, imqueue client generation, update-version vs up",
  },
  {
    wiki: "Managing-Local-Services.md", out: "managing-local-services.md", url: "/cli/managing-local-services/", nav: "Managing Local Services",
    title: "Managing Local Services",
    lead: "Run a whole fleet of services side by side with imq ctl, imq log and imq up — start, stop, tail logs and bulk-update dependencies.",
    description: "Manage a local @imqueue fleet: imq ctl start/stop/restart/status, combined colour-prefixed logs with imq log, and bulk dependency updates with imq up.",
    keywords: "imq ctl, imq log, imq up, local services, service discovery, start stop restart microservices, combined logs, bulk dependency update",
  },
  {
    wiki: "Custom-Templates.md", out: "custom-templates.md", url: "/cli/custom-templates/", nav: "Custom Templates",
    title: "Custom Templates",
    lead: "Every service imq scaffolds comes from a template: the built-in default, a published one, or your own — pointed at by name, git URL or local path. This page covers selecting a template, the v2 imq-template.json manifest, %TOKEN substitution and fragment overlays.",
    description: "Author @imqueue/cli templates: selecting a template, the v2 imq-template.json manifest, %TOKEN substitution, fragment overlays, and writing your own.",
    keywords: "imqueue custom templates, imq-template.json, %TOKEN substitution, template v2 manifest, addon token points, fragment overlays, IMQ_TEMPLATES_REPO",
  },
  {
    wiki: "Extensibility.md", out: "extensibility.md", url: "/cli/extensibility/", nav: "Extensibility",
    title: "Extensibility",
    lead: "@imqueue/cli is adapted to an environment without forking it: environment-variable overrides for enterprise hosts, data-driven templates and an addon catalog in JSON, and a typed provider registry contributors extend in one place.",
    description: "Extend @imqueue/cli: the four-axis provider model, environment seams for enterprise hosts, data-driven templates and catalog, and how to add a provider.",
    keywords: "imqueue cli extensibility, provider model, add a provider, environment seams, data-driven templates, catalog.json, contributor guide",
  },
  {
    wiki: "Real-World-Scenarios.md", out: "real-world-scenarios.md", url: "/cli/real-world-scenarios/", nav: "Real-World Scenarios",
    title: "Real-World Scenarios",
    lead: "End-to-end walkthroughs that chain the imq commands together — a new service on GitHub/Actions/Docker Hub, the same on GitHub Enterprise, running a local @imqueue fleet, dependency maintenance, and a coordinated fleet-wide release.",
    description: "@imqueue/cli end-to-end recipes: a new service on GitHub/Actions/Docker Hub, GitHub Enterprise, running a local fleet, and coordinated fleet-wide releases.",
    keywords: "imqueue cli examples, service create recipes, local fleet workflow, dependency maintenance, coordinated release, github enterprise example, org standardisation",
  },
  {
    wiki: "Troubleshooting.md", out: "troubleshooting.md", url: "/cli/troubleshooting/", nav: "Troubleshooting",
    title: "Troubleshooting",
    lead: "Fixes for the @imqueue/cli failures people actually hit: imq config init hanging in CI, template fetch and SSH errors, git identity and push failures, imq ctl finding no services, and how to reset the CLI's state entirely.",
    description: "Troubleshoot @imqueue/cli: prompts hanging in CI, template fetch and SSH issues, git identity and push failures, enterprise hosts, and resetting state.",
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
