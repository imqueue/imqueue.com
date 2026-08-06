# Documentation: guides, tutorial & API reference

Source: {{ siteUrl }}/docs/

Everything you need to build, run and scale @imqueue services — from a two-minute
quickstart to the full API reference. Arrived with one specific question? The
[FAQ]({{ siteUrl }}/api/faq/) answers nineteen of the most common ones
directly, each on its own anchor at `{{ siteUrl }}/api/faq/#<question-slug>`.
[markdown]({{ siteUrl }}/api/faq/index.md)

## Sections

1. [Getting Started]({{ siteUrl }}/get-started/) — install the CLI, scaffold a
   service and generate its client: your first @imqueue service in a few minutes.
2. [Tutorial]({{ siteUrl }}/tutorial/) — build a complete example app, one service
   at a time, up to a GraphQL API and production deployment, then front the same
   fleet with REST.
3. [CLI User Guide]({{ siteUrl }}/cli/) — scaffold, generate and run services with
   the `imq` RAD CLI: configure it, wire up VCS/CI/registry providers, and drive a
   whole local fleet.
4. [API Reference]({{ siteUrl }}/api/) — the RPC and Messaging APIs explained
   (services, clients, decorators and adapters), plus the generated reference for
   every documented package.
5. [Using AI Assistants]({{ siteUrl }}/using-ai-assistants/) — a paste-ready context
   block for Claude, ChatGPT, Cursor and Copilot, plus the machine-readable docs
   endpoints (`llms.txt`, markdown mirrors) agents can fetch.
6. [MCP Server]({{ siteUrl }}/mcp/) — wire @imqueue into Claude, Cursor, VS Code,
   JetBrains and more: the `@imqueue/mcp` server gives an agent live docs search,
   service scaffolding and CLI control as tools.
7. [Agent Recipes]({{ siteUrl }}/agents/) — machine-oriented procedures an AI
   assistant can follow to make a change: the contracts each relies on, commands
   that prove it worked, and the failure modes to expect.

## Also on this site

- [Introduction]({{ siteUrl }}/intro/) — what the framework is and the principles behind it.
- [Blog]({{ siteUrl }}/blog/) — guides and comparisons, including how @imqueue differs from gRPC, tRPC, NestJS, Moleculer and BullMQ.
- [/llms.txt]({{ siteUrl }}/llms.txt) — this site indexed for AI agents.
