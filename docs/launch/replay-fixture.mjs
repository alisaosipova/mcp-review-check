#!/usr/bin/env node
// Replay a captured listing (test/fixtures/real/<name>.json or .json.br) as a local stdio MCP server, so the real
// CLI can be run on it offline: no network, no live server. It answers initialize, tools/list, resources/list,
// resources/templates/list, prompts/list and resources/read with the captured data, nothing else.
// Usage: node dist/cli.js --stdio -- node docs/launch/replay-fixture.mjs test/fixtures/real/<name>.json
import { existsSync, readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ListPromptsRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ListToolsRequestSchema,
  ReadResourceRequestSchema, McpError, ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';

const file = process.argv[2];
if (!file) { console.error('usage: replay-fixture.mjs <fixture.json|fixture.json.br>'); process.exit(2); }
const text = file.endsWith('.br') || !existsSync(file)
  ? brotliDecompressSync(readFileSync(file.endsWith('.br') ? file : `${file}.br`)).toString('utf8')
  : readFileSync(file, 'utf8');
const raw = JSON.parse(text);

const server = new Server(raw.serverInfo, { capabilities: raw.capabilities ?? {}, ...(raw.instructions ? { instructions: raw.instructions } : {}) });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: raw.tools ?? [] }));
if (raw.capabilities?.resources) {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: raw.resources ?? [] }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates: raw.resourceTemplates ?? [] }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const r = raw.resourceReads?.[req.params.uri];
    if (r?.ok && r.raw) return r.raw;
    throw new McpError(ErrorCode.InvalidParams, `resource not captured: ${req.params.uri}`);
  });
}
if (raw.capabilities?.prompts) server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: raw.prompts ?? [] }));
await server.connect(new StdioServerTransport());
