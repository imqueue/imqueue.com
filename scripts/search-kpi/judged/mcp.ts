// MCP cluster — 867 queries, judged against the five MCP pages after reading them in full.
//
// The site documents exactly ONE MCP server: @imqueue/mcp. That single fact decides most of this
// cluster, and it is a fact about the content, not about any ranker.
//
//   /mcp/installation/  the per-client setup page. It gives the config file PATH and the exact JSON
//                       for Claude Code, Claude Desktop (Linux/macOS/Windows), Cursor (global and
//                       project), VS Code, Visual Studio 2022, JetBrains, Windsurf, Zed, Cline/Roo,
//                       Continue, OpenAI Codex CLI (TOML) and Gemini CLI — plus the mcpServers vs
//                       servers+"type":"stdio" trap, project scope via .mcp.json, the hosted HTTP
//                       form, and "Verify it worked". Any question of the form "how do I add or
//                       configure an MCP server in <one of those clients>" is what this page is FOR.
//   /mcp/tools/         every tool, its input, its return, side effects, and the read-only vs
//                       state-changing table.
//   /mcp/security/      the trust model AND the troubleshooting list: server doesn't appear, npx not
//                       found, Windows won't launch, first launch slow, imq not installed, hangs and
//                       times out, generate_client can't find the service, logs look truncated.
//   /mcp/workflows/     six end-to-end recipes and the tool chain each one runs.
//   /mcp/               what MCP is, what @imqueue/mcp is, install in 30 seconds, the hosted
//                       endpoint, and the at-a-glance table (registry id, transports, runtime).
//   /using-ai-assistants/  the paste-ready context block and the llms.txt / markdown-mirror endpoints.
//
// NOT covered anywhere, which is why the negatives below are negatives:
//   - any third party's MCP server (Figma, Jira, Snowflake, Playwright, Atlassian, …)
//   - writing or publishing an MCP server of your own, in any language
//   - the MCP specification, transports in the abstract, registries, marketplaces, directories
//   - a host's own adjacent features: skills, hooks, plugins, tool-search, admin policy, OAuth flows

// ---------------------------------------------------------------- POSITIVE

// Adding or configuring the server in a client the installation page documents by name, plus the
// client-agnostic "where does the config go / what shape is it" questions that page opens with.
import type { PositiveJudgement, NegativeJudgement } from './types.ts';

const INSTALL = [
  'add mcp server in cursor', 'claude code mcp', 'claude code mcp add',
  'claude code mcp add command', 'claude code mcp add scope', 'claude code mcp config',
  'claude code mcp config file', 'claude code mcp config file location',
  'claude code mcp config location', 'claude code mcp configuration file',
  'claude code mcp enable', 'claude code mcp file', 'claude code mcp file location',
  'claude code mcp global', 'claude code mcp guide', 'claude code mcp how to',
  'claude code mcp how to add', 'claude code mcp how to use', 'claude code mcp ide',
  'claude code mcp import', 'claude code mcp in cursor', 'claude code mcp in vscode',
  'claude code mcp install', 'claude code mcp intellij', 'claude code mcp json',
  'claude code mcp json config', 'claude code mcp json example', 'claude code mcp json file',
  'claude code mcp json format', 'claude code mcp json location', 'claude code mcp json schema',
  'claude code mcp list', 'claude code mcp local', 'claude code mcp location',
  'claude code mcp npx', 'claude code mcp official', 'claude code mcp on windows',
  'claude code mcp project scope', 'claude code mcp reconnect', 'claude code mcp registry',
  'claude code mcp reload', 'claude code mcp remove', 'claude code mcp scope',
  'claude code mcp server config', 'claude code mcp server config file',
  'claude code mcp server list', 'claude code mcp server setup', 'claude code mcp servers',
  'claude code mcp settings', 'claude code mcp settings file', 'claude code mcp setup',
  'claude code mcp tutorial', 'claude code mcp uninstall', 'claude code mcp update',
  'claude code mcp url', 'claude code mcp usage', 'claude code mcp user scope',
  'claude code mcp uv', 'claude code mcp uvx', 'claude code mcp version',
  'claude code mcp visual studio', 'claude code mcp vscode', 'claude code mcp windows',
  'claude code mcp http', 'claude code mcp delete', 'claude code mcp disable',
  'claude mcp server configuration file', 'claude mcp server configuration location',
  'claude mcp server configuration schema',
  'cursor add global mcp server', 'cursor add http mcp server', 'cursor add local mcp server',
  'cursor add mcp server json', 'cursor add mcp server url', 'cursor add new mcp server',
  'cursor ai mcp server', 'cursor cli mcp server', 'cursor enable mcp server',
  'cursor global mcp server', 'cursor how to add mcp server', 'cursor how to install mcp server',
  'cursor how to setup mcp server', 'cursor how to start mcp server', 'cursor ide mcp server',
  'cursor mcp server add', 'cursor mcp server config', 'cursor mcp server config file',
  'cursor mcp server configuration', 'cursor mcp server connect', 'cursor mcp server env',
  'cursor mcp server environment variables', 'cursor mcp server how to use',
  'cursor mcp server http', 'cursor mcp server install', 'cursor mcp server integration',
  'cursor mcp server json', 'cursor mcp server json file', 'cursor mcp server local',
  'cursor mcp server localhost', 'cursor mcp server per project', 'cursor mcp server remote',
  'cursor mcp server settings', 'cursor mcp server setup', 'cursor mcp server sse',
  'cursor mcp server stdio', 'cursor mcp server tutorial', 'cursor mcp server url',
  'cursor mcp server usage', 'cursor mcp servers', 'cursor mcp servers custom',
  'cursor project mcp server', 'cursor restart mcp server', 'cursor run mcp server',
  'cursor set up mcp server', 'cursor streamable http mcp server', 'cursor use local mcp server',
  'cursor disable mcp server', 'does cursor have mcp server', 'integrate mcp server with cursor',
  'install mcp server claude desktop', 'install mcp server gemini cli',
  'install mcp server github copilot', 'install mcp server in windsurf', 'install mcp server mac',
  'install mcp server on claude code', 'install mcp server on cursor',
  'install mcp server on linux', 'install mcp server on mac', 'install mcp server on ubuntu',
  'install mcp server on vscode', 'install mcp server on windows', 'install mcp server to claude',
  'install mcp server to claude code', 'install mcp server visual studio',
  'mcp add server vs code', 'mcp server add claude code', 'mcp server add to claude',
  'mcp server add to cursor', 'mcp server add vscode', 'mcp server claude',
  'mcp server claude code', 'mcp server codex',
  'mcp server configuration', 'mcp server configuration claude',
  'mcp server configuration claude code', 'mcp server configuration cursor',
  'mcp server configuration example', 'mcp server configuration file',
  'mcp server configuration format', 'mcp server configuration in claude',
  'mcp server configuration in cursor', 'mcp server configuration in intellij',
  'mcp server configuration in vscode', 'mcp server configuration json',
  'mcp server configuration json schema', 'mcp server configuration schema',
  'mcp server configuration visual studio code', 'mcp server configuration vscode',
  'mcp server connections', 'mcp server copilot', 'mcp server cursor',
  'mcp server cursor ide agent chat', 'mcp server cursor windows', 'mcp server for claude',
  'claude code mcp integration', 'cursor mcp server example',
  'cursor mcp servers must be an object',
  'mcp server gemini', 'mcp server github copilot', 'mcp server guide', 'mcp server how to',
  'mcp server how to install', 'mcp server http', 'mcp server in cursor',
  'mcp server in cursor ai', 'mcp server install claude', 'mcp server install command',
  'mcp server install linux', 'mcp server install locally', 'mcp server install ubuntu',
  'mcp server install vscode', 'mcp server install windows', 'mcp server installation',
  'mcp server installation guide', 'mcp server installation in vs code',
  'mcp server instructions', 'mcp server integration', 'mcp server json',
  'mcp server json example', 'mcp server json schema', 'mcp server local',
  'mcp server npm', 'mcp server npm install', 'mcp server npx', 'mcp server on cursor',
  'mcp server port', 'mcp server quick start', 'mcp server requirements',
  'mcp server setup', 'mcp server setup claude', 'mcp server setup claude code',
  'mcp server setup cursor', 'mcp server setup example', 'mcp server setup files',
  'mcp server setup for claude', 'mcp server setup guide', 'mcp server setup in claude code',
  'mcp server setup in cursor', 'mcp server setup in intellij', 'mcp server setup in local',
  'mcp server setup in vs code', 'mcp server setup locally', 'mcp server setup tutorial',
  'mcp server setup vscode', 'mcp server setup with claude', 'mcp server sse configuration',
  'mcp server to cursor', 'mcp server tutorial', 'mcp server tutorial for beginners',
  'mcp server url', 'mcp server url example', 'mcp server usage', 'mcp server vscode',
  'mcp server windows', 'mcp server with claude code', 'mcp server with copilot',
  'mcp server with cursor', 'mcp server with cursor ai', 'mcp server yaml',
  'mcp server yaml file', 'npm install mcp server', 'vscode mcp server configuration file',
  'mcp.server vs.cursor', 'mcp server download',
];

// What the thing IS. /mcp/ is the only page on the site that defines MCP and what an MCP server does.
const WHAT_IS = [
  'mcp server', 'mcp server ai', 'mcp server ai agent', 'mcp server anthropic',
  'mcp server basics', 'mcp server benefits', 'mcp server definition', 'mcp server eli5',
  'mcp server explained', 'mcp server explained for dummies', 'mcp server explained simply',
  'mcp server full form', 'mcp server how does it work', 'mcp server in ai', 'mcp server kya hai',
  'mcp server llm', 'mcp server meaning', 'mcp server meaning ai', 'mcp server overview',
  'mcp server purpose', 'mcp server que es', 'mcp server stands for', 'mcp server use cases',
  'mcp server uses', 'mcp server what does it do', 'mcp server what is it', 'mcp server wiki',
  'mcp server wikipedia', 'model context protocol (mcp)', 'model context protocol mcp',
  'model context protocol or mcp', 'what is mcp server', 'claude code mcp meaning',
  'claude code mcp que es', "mcp claude code o'que é", 'claude code mcp example',
  'mcp server example github', 'mcp server examples',
  'mcp server ki', // "KI" is German for AI — the same question as "mcp server ai"
];

// The tool surface. /mcp/tools/ is a reference for exactly this.
const TOOLS = [
  'mcp server tools', 'mcp server list tools', 'claude code mcp tools', 'cursor mcp server tools',
  'mcp server add tool', 'mcp server add description',
];

// Things going wrong. /mcp/security/ carries the troubleshooting list.
const TROUBLESHOOT = [
  'claude code mcp enoent', 'claude code mcp error', 'claude code mcp error log',
  'claude code mcp failed to connect', 'claude code mcp not showing',
  'claude code mcp not working', 'claude code mcp logs', 'claude code mcp debug',
  'claude code mcp timeout', 'claude code mcp timeout setting', 'claude code mcp tool timeout',
  'cursor mcp error no server info found', 'cursor mcp no server info found',
  'cursor mcp server 0 tools enabled', 'cursor mcp server client closed',
  'cursor mcp server debug', 'cursor mcp server error', 'cursor mcp server logs',
  'cursor mcp server no tools available', 'cursor mcp server no tools or prompts',
  'cursor mcp server not working', 'cursor mcp server timeout', 'cursor not using mcp server',
  'cursor new mcp server detected', 'cursor mcp server loading tools',
  'mcp server not showing in vscode', 'no mcp servers installed listening for updates',
  'mcp server logging', 'mcp server health check', 'cursor mcp server support',
  'claude code mcp json not working',
];

// The trust model itself.
const SECURITY = [
  'mcp server security', 'mcp server security best practices', 'mcp server risks',
  'mcp server vulnerability',
];

// Wiring an assistant up WITHOUT MCP, and the machine-readable doc endpoints.
const ASSISTANTS = [
  'mcp server documentation', 'mcp server add documentation',
  'cursor mcp server docs', 'cursor mcp server documentation', 'claude code mcp docs',
  'claude code mcp documentation', 'cursor mcp server for documentation',
  'mcp server add context',
];

// A client the setup page does not document. It does have an "Other clients" section giving the
// three facts any client needs, but a searcher naming one of these wants that host's own config
// path and shape, which is exactly what the page supplies for the twelve it does cover.
const UNDOCUMENTED_HOST = [
  'install mcp server antigravity', 'mcp server configuration antigravity',
  'install mcp server kiro', 'mcp server kiro', 'install mcp server lm studio',
  'mcp server lm studio', 'install mcp server opencode', 'mcp server opencode',
];

// "prompts" and "resources" are MCP primitives alongside tools. The @imqueue server exposes tools
// only — no prompts, no resources — so no page here describes either.
const OTHER_PRIMITIVES = [
  'mcp server prompts', 'cursor mcp server prompt', 'claude code mcp prompts',
  'mcp server resources', 'mcp server and resource', 'cursor mcp server resources',
  'claude code mcp resources', 'mcp server.add prompt',
];

// ---------------------------------------------------------------- NEGATIVE
//
// Each list is a verdict about CONTENT: having read all five MCP pages, nothing on this site
// answers these. Recorded per query so the judgement is auditable rather than inferred.

// Names a third party's MCP server. The site documents @imqueue/mcp and no other.
const THIRD_PARTY = [
  'ado mcp server install', 'angular mcp server install', 'apify mcp server install',
  'atlassian mcp server configuration vscode', 'atlassian mcp server install',
  'atlassian mcp server on cursor', 'atlassian mcp server with cursor',
  'atlassian rovo mcp server install', 'aws mcp server install',
  'azure devops mcp server install', 'azure mcp server install', 'blender mcp server add on',
  'brew install mcp server', 'bullmq mcp', 'claude code add xcode mcp',
  'claude code cli xcode mcp', 'claude code figma mcp', 'claude code k8s mcp',
  'claude code keynote mcp', 'claude code klaviyo mcp', 'claude code kubernetes mcp server',
  'claude code mcp atlassian', 'claude code mcp aws', 'claude code mcp azure devops',
  'claude code mcp bigquery', 'claude code mcp bitbucket', 'claude code mcp blender',
  'claude code mcp browser', 'claude code mcp browser use', 'claude code mcp chrome',
  'claude code mcp databricks', 'claude code mcp discord', 'claude code mcp excalidraw',
  'claude code mcp excel', 'claude code mcp figma', 'claude code mcp filesystem',
  'claude code mcp for browser', 'claude code mcp for codex', 'claude code mcp for jira',
  'claude code mcp for sql server', 'claude code mcp for unity', 'claude code mcp github',
  'claude code mcp gitlab', 'claude code mcp gmail', 'claude code mcp godot',
  'claude code mcp google docs', 'claude code mcp google drive',
  'claude code mcp google sheets', 'claude code mcp grafana', 'claude code mcp higgsfield',
  'claude code mcp home assistant', 'claude code mcp image',
  'claude code mcp image generation', 'claude code mcp jira', 'claude code mcp kali',
  'claude code mcp kicad', 'claude code mcp knowledge graph', 'claude code mcp kubernetes',
  'claude code mcp linear', 'claude code mcp linkedin', 'claude code mcp memory',
  'claude code mcp microsoft 365', 'claude code mcp miro', 'claude code mcp mongodb',
  'claude code mcp mysql', 'claude code mcp n8n', 'claude code mcp nano banana',
  'claude code mcp notebooklm', 'claude code mcp notion', 'claude code mcp obsidian',
  'claude code mcp ollama', 'claude code mcp oracle', 'claude code mcp outlook',
  'claude code mcp playwright', 'claude code mcp postgres', 'claude code mcp postgresql',
  'claude code mcp postman', 'claude code mcp power bi', 'claude code mcp powerpoint',
  'claude code mcp qiita', 'claude code mcp roblox', 'claude code mcp roblox studio',
  'claude code mcp telegram', 'claude code mcp to figma', 'claude code mcp tradingview',
  'claude code mcp unity', 'claude code mcp unreal engine', 'claude code mcp vercel',
  'claude code mcp video', 'claude code mcp voice', 'claude code mcp web',
  'claude code mcp web browser', 'claude code mcp web search', 'claude code mcp whatsapp',
  'claude code mcp with figma', 'claude code mcp word', 'claude code mcp wordpress',
  'claude code mcp x', 'claude code mcp xcode', 'claude code mcp youtrack',
  'claude code mcp youtube', 'claude code mcp zen', 'claude code mcp zendesk',
  'claude code mcp zenn', 'claude code mcp zeplin', 'claude code mcp zotero',
  'claude code qdrant mcp', 'claude code qgis mcp', 'claude code qmd mcp',
  'claude code quickbooks mcp', 'claude code quip mcp', 'claude code xcode mcp server',
  'claude code xcode simulator mcp', 'claude code xcodebuild mcp', 'claude code xlsx mcp',
  'claude code youtube transcript mcp', 'claude code zapier mcp', 'claude code zed mcp',
  'claude code zen mcp server', 'claude code zoho mcp', 'claude code zoom mcp',
  'claude code+kali linux mcp', 'cursor add github mcp server', 'cursor add jira mcp server',
  'cursor add mcp server figma', 'cursor ai github mcp server', 'cursor bitbucket mcp server',
  'cursor blender mcp server', 'cursor excel mcp server', 'cursor figma mcp server setup',
  'cursor grafana mcp server', 'cursor ide browser mcp server', 'cursor jenkins mcp server',
  'cursor jupyter notebook mcp server', 'cursor linear mcp server',
  'cursor mcp server atlassian', 'cursor mcp server aws', 'cursor mcp server azure devops',
  'cursor mcp server browser', 'cursor mcp server chrome', 'cursor mcp server confluence',
  'cursor mcp server context7', 'cursor mcp server database', 'cursor mcp server docker',
  'cursor mcp server fetch', 'cursor mcp server figma', 'cursor mcp server file',
  'cursor mcp server filesystem', 'cursor mcp server for github', 'cursor mcp server for jira',
  'cursor mcp server git', 'cursor mcp server github', 'cursor mcp server gitlab',
  'cursor mcp server jira', 'cursor mcp server kubernetes', 'cursor mcp server memory',
  'cursor mcp server mongodb', 'cursor mcp server mysql', 'cursor mcp server n8n',
  'cursor mcp server playwright', 'cursor mcp server postgres', 'cursor mcp server python',
  'cursor mcp server sequential thinking', 'cursor mcp server sql',
  'cursor mcp server supabase',
  'cursor mssql mcp server', 'cursor notion mcp server', 'cursor obsidian mcp server',
  'cursor oracle mcp server', 'cursor pdf mcp server', 'cursor postman mcp server',
  'cursor unity mcp server', 'cursor xcode mcp server', 'cursor 配置 mysql mcp server',
  'datadog mcp server install', 'dbt mcp server install', 'excalidraw mcp server cursor',
  'excel mcp server install', 'expo mcp server cursor', 'figma mcp claude code youtube',
  'figma mcp server cursor github', 'figma mcp server on cursor', 'figma mcp server setup guide',
  'figma mcp server setup vscode', 'figma mcp server with cursor',
  'github mcp install remote server', 'github mcp server cursor setup',
  'github mcp server install claude code', 'github mcp server on cursor',
  'github mcp server with cursor', 'gitlab mcp server install',
  'how to install duckduckgo mcp server', 'hubspot mcp server cursor',
  'install brave mcp server', 'install eks mcp server', 'install github mcp server locally',
  'install matlab mcp server',
  'install mcp server azure devops', 'install mcp server time',
  'install notebooklm mcp server', 'install playwright mcp server windows',
  'install the playwright mcp server with your client', 'jira mcp server install',
  'jira mcp server with cursor', 'jupyter mcp server cursor', 'kali mcp server install',
  'kibana mcp claude. code', 'kubernetes mcp server install',
  'kết nối notebooklm với claude code qua mcp', 'linear mcp server install',
  'markitdown mcp server cursor', 'markitdown mcp server install',
  'mcp install server py claude app not found', 'mcp server atlassian', 'mcp server aws',
  'mcp server azure', 'mcp server bitbucket', 'mcp server blender', 'mcp server browser',
  'mcp server console servicenow', 'mcp server databricks', 'mcp server datadog',
  'mcp server fetch install',
  'mcp server figma', 'mcp server figma setup', 'mcp server filesystem install',
  'mcp server for azure devops', 'mcp server for jira', 'mcp server for obsidian',
  'mcp server for servicenow', 'mcp server for sql server', 'mcp server git install',
  'mcp server github', 'mcp server github install', 'mcp server gitlab', 'mcp server gmail',
  'mcp server godot', 'mcp server google', 'mcp server hermes', 'mcp server home assistant',
  'mcp server installation blender', 'mcp server jenkins', 'mcp server jira',
  'mcp server kali', 'mcp server kali linux', 'mcp server kibana', 'mcp server kicad',
  'mcp server kite', 'mcp server kubernetes', 'mcp server linkedin',
  'mcp server matlab', 'mcp server memory', 'mcp server microsoft', 'mcp server mongodb',
  'mcp server mulesoft', 'mcp server n8n', 'mcp server neo4j', 'mcp server netsuite',
  'mcp server notion', 'mcp server obsidian', 'mcp server ollama', 'mcp server on aws',
  'mcp server on azure', 'mcp server oracle', 'mcp server playwright',
  'mcp server playwright install', 'mcp server playwright setup', 'mcp server power bi',
  'mcp server qdrant', 'mcp server qdrant docker', 'mcp server qgis', 'mcp server qlik',
  'mcp server qlik sense', 'mcp server quarkus', 'mcp server quickbooks', 'mcp server roblox',
  'mcp server roblox studio', 'mcp server salesforce', 'mcp server servicenow',
  'mcp server setup github', 'mcp server setup salesforce', 'mcp server setup servicenow',
  'mcp server snowflake', 'mcp server splunk', 'mcp server tableau', 'mcp server unity',
  'mcp server unraid', 'mcp server unreal', 'mcp server unreal engine',
  'mcp server web search', 'mcp server x', 'mcp server x twitter', 'mcp server x64dbg',
  'mcp server xcode', 'mcp server xero', 'mcp server xlsx', 'mcp server xml',
  'mcp server xray', 'mcp server xsiam', 'mcp server xwiki', 'mcp server yahoo finance',
  'mcp server yahoo mail', 'mcp server yfinance', 'mcp server youtrack', 'mcp server youtube',
  'mcp server youtube transcript', 'mcp server youtube video', 'mcp server zabbix',
  'mcp server zapier', 'mcp server zendesk', 'mcp server zerodha', 'mcp server zillow',
  'mcp server zoho', 'mcp server zomato', 'mcp server zoom', 'mcp server zotero',
  'mcp server zscaler', 'microsoft learn mcp server install', 'miro mcp server cursor',
  'mongodb mcp server install', 'mulesoft mcp server cursor', 'mysql mcp server install',
  'n8n mcp server install', 'neo4j mcp server install',
  'npm install benborla29 mcp server mysql', 'npm install mcp server mssql',
  'npm install mcp server sequential thinking', 'notion mcp server install',
  'playwright mcp server install claude code', 'playwright mcp server install in vs code',
  'playwright mcp server with cursor', 'power bi mcp server install',
  'power bi mcp server manual install', 'power bi modeling mcp server install',
  'serena mcp server install', 'slack mcp server install', 'supabase mcp server install',
  'terraform mcp server install', 'trpc mcp', 'unity mcp server install',
  'vercel mcp server cursor', 'xano mcp claude code',
  'xero model context protocol mcp server', 'zen mcp server cursor',
  'zotero mcp model context protocol', 'cursor mcp server red', 'cursor mcp server red dot',
  'mcp server for ai', 'claude code mcp lsp', 'claude code mcp ios simulator',
];

// Wants to WRITE an MCP server. The site documents consuming one.
const AUTHORING = [
  'create mcp server using cursor', 'cursor build mcp server', 'cursor own mcp server',
  'mcp server build', 'mcp server build your own', 'mcp server builder',
  'mcp server design', 'mcp server development', 'mcp server diagram',
  'mcp server architecture', 'mcp server architecture diagram', 'mcp server frameworks',
  'mcp server how to build', 'mcp server how to create', 'mcp server implementation',
  'mcp server java', 'mcp server java example', 'mcp server java sdk',
  'mcp server javascript', 'mcp server kotlin', 'mcp server golang', 'mcp server nodejs',
  'mcp server python', 'mcp server examples python', 'mcp server rust',
  'mcp server typescript', 'mcp server fastmcp install', 'mcp server fastmcp pip install',
  'mcp server setup python', 'mcp install server py', 'uv run mcp install server py',
  'uvx install mcp server', 'mcp server plugin', 'mcp server add on',
  'mcp server add authentication', 'mcp server naming convention',
  // packaging and hosting a server of your own: the site's is npx/stdio and nothing else
  'mcp server install python', 'mcp server pip install', 'mcp server uv install',
  'mcp server docker', 'mcp server setup docker', 'install mcp server docker',
  'mcp server in azure', 'mcp server hosting',
  'mcp server names', 'mcp server ideas', 'mcp server testing', 'mcp server tester',
  'mcp server testing tool', 'mcp server inspector', 'model context protocol mcp inspector',
  'claude code mcp builder', 'claude code mcp builder skill', 'mcp server repo',
  'mcp server repository', 'mcp server open source', 'mcp server api',
  'mcp server endpoints', 'mcp server types', 'mcp server options',
];

// The specification and the wider ecosystem — registries, catalogues, comparisons, media.
const PROTOCOL_META = [
  'best cursor mcp servers reddit', 'cursor best mcp server', 'cursor mcp server directory',
  'cursor mcp server library', 'cursor mcp server list', 'cursor mcp server marketplace',
  'cursor mcp server recommend', 'cursor mcp server reddit', 'cursor mcp server registry',
  'cursor ai mcp server list', 'grpc vs rest vs mcp', 'mcp model context protocol youtube',
  'mcp server books', 'mcp server catalog', 'mcp server cost', 'mcp server directory',
  'mcp server explorer', 'mcp server gateway', 'mcp server hub', 'mcp server icon',
  'mcp server image', 'mcp server jobs', 'mcp server library', 'mcp server list',
  'mcp server list github', 'mcp server logo', 'mcp server manager', 'mcp server market',
  'mcp server marketplace', 'mcp server protocol', 'mcp server providers',
  'mcp server proxy', 'mcp server questions', 'mcp server reddit', 'mcp server registry',
  'mcp server spec', 'mcp server training', 'mcp server ui', 'mcp server vs agent',
  'mcp server vs api', 'mcp server vs cli', 'mcp server vs mcp client',
  'mcp server vs mcp gateway', 'mcp server vs rag', 'mcp server vs skill',
  'mcp server vs tool', 'mcp servers github', 'model context protocol (mcp) servers',
  'model context protocol mcp github', 'model context protocol mcp tutorial',
  'claude code mcp best', 'claude code mcp best practices', 'claude code mcp directory',
  'claude code mcp hub', 'claude code mcp library', 'claude code mcp market',
  'claude code mcp marketplace', 'claude code mcp repo',
  'claude code vs mcp', 'claude code y mcp', 'claude code mcp manager',
  'mcp server best practices',
];

// A host's own adjacent feature, not "how do I add this server".
const HOST_FEATURE = [
  'claude code mcp and skills', 'claude code mcp apps', 'claude code mcp auth',
  'claude code mcp authentication', 'claude code mcp bearer token',
  'claude code mcp client', 'claude code mcp codex', 'claude code mcp connections',
  'claude code mcp connectors', 'claude code mcp defer loading',
  'claude code mcp disable tools', 'claude code mcp elicitation',
  'claude code mcp env', 'claude code mcp environment variables',
  'claude code mcp headers', 'claude code mcp hooks', 'claude code mcp host',
  'claude code mcp lazy loading', 'claude code mcp login', 'claude code mcp mode',
  'claude code mcp needs auth', 'claude code mcp needs authentication',
  'claude code mcp notifications', 'claude code mcp oauth', 'claude code mcp oauth2',
  'claude code mcp on demand', 'claude code mcp options', 'claude code mcp permissions',
  'claude code mcp plugin', 'claude code mcp redirect uri',
  'claude code mcp redirect url', 'claude code mcp skill', 'claude code mcp tool search',
  'claude code mcp tunnel', 'claude code mcp ui', 'claude code mcp vs cli',
  'claude code mcp vs plugin', 'claude code mcp vs skills', 'claude code mcp whitelist',
  'cursor mcp server allowlist', 'cursor mcp server authentication',
  'cursor mcp server blocked by admin', 'cursor mcp server is blocked by team admin',
  'cursor mcp server oauth', 'cursor background agent mcp server',
  'cursor plugin mcp server', 'mcp server oauth', 'mcp server oauth configuration',
  'mcp server authentication', 'mcp server with oauth', 'mcp server skills',
  'mcp server elicitation', 'mcp server with power bi',
  'mcp server yolo', 'plugin install mcp server dev claude plugins official',
  'claude code mcp json environment variables', 'claude code mcp with oauth',
];

export const positive: readonly PositiveJudgement[] = [
  ['/mcp/installation/', 'mcp installation', INSTALL],
  ['/mcp/', 'mcp basics', WHAT_IS],
  ['/mcp/tools/', 'mcp tools', TOOLS],
  ['/mcp/security/', 'mcp troubleshooting', TROUBLESHOOT],
  ['/mcp/security/', 'mcp security', SECURITY],
  ['/using-ai-assistants/', 'ai assistants', ASSISTANTS],
];

export const negative: readonly NegativeJudgement[] = [
  ["names a third party's MCP server; the site documents only @imqueue/mcp", THIRD_PARTY],
  ['authoring, packaging or hosting a server of your own', AUTHORING],
  ['the MCP spec, registries and ecosystem meta — not covered', PROTOCOL_META],
  ["a host's own adjacent feature, not adding this server", HOST_FEATURE],
  ['a client the setup page does not document', UNDOCUMENTED_HOST],
  ['prompts and resources — MCP primitives this server does not expose', OTHER_PRIMITIVES],
];
