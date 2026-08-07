// "model context protocol" spelled out — 242 queries the /mcp/ substring filter missed.
// Same content, same five pages, same single governing fact: this site documents ONE MCP server.
//
// /mcp/ is the only page here that says what the Model Context Protocol IS. It does not name its
// author, give a release date, cite the spec, or discuss versions — so those go negative even though
// they are "on topic", because no page answers them.

'use strict';

// What it is. /mcp/: "MCP is the open standard that lets AI coding agents call external tools."
const WHAT_IS = [
  'model context protocol', 'model context protocol agentic ai', 'model context protocol ai',
  'model context protocol anthropic', 'model context protocol basics',
  'model context protocol benefits', 'model context protocol by anthropic',
  'model context protocol definition', 'model context protocol eli5',
  'model context protocol explained', 'model context protocol explained simply',
  'model context protocol for beginners', 'model context protocol for dummies',
  'model context protocol for llms', 'model context protocol guide',
  'model context protocol how it works', 'model context protocol how to use',
  'model context protocol in ai', 'model context protocol in simple terms',
  'model context protocol introduction', 'model context protocol ki',
  'model context protocol là gì', 'model context protocol llm',
  'model context protocol meaning', 'model context protocol ne işe yarar',
  'model context protocol nedir', 'model context protocol overview',
  'model context protocol que es', 'model context protocol usage',
  'model context protocol use cases', 'model context protocol uses',
  'model context protocol what is it', 'model context protocol wikipedia',
];

// Getting it into a client. The installation page covers each of these hosts by name.
const INSTALL = [
  'model context protocol claude', 'model context protocol claude code',
  'model context protocol clients', 'model context protocol copilot',
  'model context protocol for claude', 'model context protocol gemini',
  'model context protocol github copilot', 'model context protocol http',
  'model context protocol quickstart', 'model context protocol vscode',
  'model context protocol windows', 'model context protocol with http transport',
];

const TOOLS = ['model context protocol tools'];

const SECURITY = ['model context protocol security', 'model context protocol security risks'];

// /using-ai-assistants/ is the page that documents /llms.txt and the markdown mirrors.
const ASSISTANTS = ['model context protocol llms txt'];

// ---------------------------------------------------------------- NEGATIVE

const THIRD_PARTY = [
  'model context protocol blender', 'model context protocol browser',
  'model context protocol copilot studio', 'model context protocol databricks',
  'model context protocol discord', 'model context protocol esri',
  'model context protocol excel', 'model context protocol figma',
  'model context protocol filesystem', 'model context protocol google',
  'model context protocol home assistant', 'model context protocol huggingface',
  'model context protocol in copilot studio', 'model context protocol in forge-x',
  'model context protocol jira', 'model context protocol kafka',
  'model context protocol keycloak', 'model context protocol kiro',
  'model context protocol knowledge graph', 'model context protocol kubernetes',
  'model context protocol langchain', 'model context protocol matlab',
  'model context protocol meta', 'model context protocol microsoft',
  'model context protocol n8n', 'model context protocol obsidian',
  'model context protocol ollama', 'model context protocol openai',
  'model context protocol oracle', 'model context protocol perplexity',
  'model context protocol playwright', 'model context protocol postgres',
  'model context protocol power bi', 'model context protocol qgis',
  'model context protocol qwen', 'model context protocol roblox',
  'model context protocol salesforce', 'model context protocol server home assistant',
  'model context protocol unity', 'model context protocol unreal engine',
  'model context protocol web automation', 'model context protocol with ollama',
  'model context protocol x', 'model context protocol xcode',
  'model context protocol zapier', 'model context protocol zed',
  'model context protocol zerodha', 'model context protocol zod',
  'purpose of model context protocol in forge x', 'qlik model context protocol',
  'xero model context protocol', 'zendesk model context protocol',
  'zoho model context protocol', 'zomato model context protocol',
  'zoom model context protocol', 'zscaler model context protocol',
  'model context protocol healthcare',
];

const AUTHORING = [
  'build your own model context protocol', 'model context protocol .net',
  'model context protocol .net sdk', 'model context protocol api',
  'model context protocol c#', 'model context protocol docker',
  'model context protocol dotnet', 'model context protocol elicitation',
  'model context protocol example python', 'model context protocol format',
  'model context protocol framework', 'model context protocol gateway',
  'model context protocol go sdk', 'model context protocol golang',
  'model context protocol host', 'model context protocol hub',
  'model context protocol inspector', 'model context protocol io',
  'model context protocol io quickstart', 'model context protocol io quickstart server',
  'model context protocol java', 'model context protocol java example',
  'model context protocol java sdk', 'model context protocol javascript',
  'model context protocol javascript sdk', 'model context protocol json',
  'model context protocol json rpc', 'model context protocol json schema',
  'model context protocol kotlin', 'model context protocol kotlin sdk',
  'model context protocol node', 'model context protocol nodejs',
  'model context protocol npm', 'model context protocol nuget',
  'model context protocol nuget package', 'model context protocol prompts',
  'model context protocol python', 'model context protocol python sdk',
  'model context protocol resources', 'model context protocol rust',
  'model context protocol sdk', 'model context protocol sdk typescript',
  'model context protocol test', 'model context protocol transport',
  'model context protocol tutorial python', 'model context protocol typescript',
  'model context protocol typescript sdk', 'model context protocol ui',
  'model context protocol ui sdk', 'model context protocol with python',
  'model context protocol oauth', 'model context protocol enterprise authorization',
];

const PROTOCOL_META = [
  'model context protocol advanced topics',
  'model context protocol advanced topics from anthropic',
  'model context protocol alternatives', 'model context protocol architecture',
  'model context protocol aws', 'model context protocol best practices',
  'model context protocol citation', 'model context protocol diagram',
  'model context protocol documentation', 'model context protocol history',
  'model context protocol library', 'model context protocol linux foundation',
  'model context protocol list', 'model context protocol marketplace',
  'model context protocol official', 'model context protocol official documentation',
  'model context protocol open source', 'model context protocol paper',
  'model context protocol registry', 'model context protocol release date',
  'model context protocol repository', 'model context protocol research paper',
  'model context protocol rfc', 'model context protocol servers',
  'model context protocol servers github', 'model context protocol github',
  'model context protocol github servers', 'model context protocol specification',
  'model context protocol standard', 'model context protocol version',
  'model context protocol vs', 'model context protocol vs a2a',
  'model context protocol vs agentic ai', 'model context protocol vs api',
  'model context protocol vs langchain', 'model context protocol vs rag',
  'model context protocol vs rest api', 'model context protocol vs skills',
  'model context protocol white paper', 'model context protocol who created',
  'model context protocol ux design implications', 'model context protocol workflow',
  'model context protocol research discovery', 'model context protocol quickstart resources',
];

// Books, courses, certifications, conference talks, logos — material about MCP, not an answer here.
const MEDIA = [
  'model context protocol blog', 'model context protocol book',
  'model context protocol book pdf', 'model context protocol bundle',
  'model context protocol certification', 'model context protocol certification anthropic',
  'model context protocol anthropic certification', 'model context protocol course',
  'model context protocol demo', 'model context protocol documentation pdf',
  'model context protocol download', 'model context protocol ebook',
  'model context protocol examples', 'model context protocol for llms packt',
  'model context protocol for llms pdf', 'model context protocol geeksforgeeks',
  'model context protocol icon', 'model context protocol image',
  'model context protocol in chinese', 'model context protocol interview questions',
  'model context protocol jobs', 'model context protocol kodekloud',
  'model context protocol krish naik', 'model context protocol logo',
  'model context protocol logo png', 'model context protocol logo svg',
  'model context protocol medium', 'model context protocol news',
  'model context protocol pdf', 'model context protocol ppt',
  'model context protocol qiita', 'model context protocol reddit',
  'model context protocol top blogs', 'model context protocol training',
  'model context protocol tutorial', 'model context protocol tutorial pdf',
  'model context protocol udemy', 'model context protocol upsc',
  'model context protocol website', 'model context protocol youtube',
];

module.exports = {
  positive: [
    ['/mcp/', 'mcp basics', WHAT_IS],
    ['/mcp/installation/', 'mcp installation', INSTALL],
    ['/mcp/tools/', 'mcp tools', TOOLS],
    ['/mcp/security/', 'mcp security', SECURITY],
    ['/using-ai-assistants/', 'ai assistants', ASSISTANTS],
  ],
  negative: [
    ["names a third party's MCP server; the site documents only @imqueue/mcp", THIRD_PARTY],
    ['authoring, packaging or hosting a server of your own', AUTHORING],
    ['the MCP spec, registries and ecosystem meta — not covered', PROTOCOL_META],
    ['books, courses, certifications and other material about MCP', MEDIA],
  ],
};
