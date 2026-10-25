#!/usr/bin/env node
// UI fixture built on the ext-apps pattern: UI tools and ui:// resources are listed only when the client declares
// the io.modelcontextprotocol/ui extension (getUiCapability). The UI resource has a wrong MIME type (APPS-003).
// Without --fallback a text-only client sees no get_weather at all (APPS-019); with --fallback it gets the
// same tool without _meta.ui, which is the documented graceful degradation.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { isMain } from './is-main.mjs';
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export function createUiCapServer({ fallback = false } = {}) {
  const s = new Server({ name: 'weather', version: '1.0.0' }, { capabilities: { tools: {}, resources: {} } });
  const ui = () => !!s.getClientCapabilities()?.extensions?.['io.modelcontextprotocol/ui']?.mimeTypes?.includes('text/html;profile=mcp-app');
  const weather = {
    name: 'get_weather', title: 'Get weather', description: 'Get the current weather for a city name.',
    inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  };
  s.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ui() ? [{ ...weather, _meta: { ui: { resourceUri: 'ui://weather/dash' } } }] : fallback ? [weather] : [],
  }));
  s.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: ui() ? [{ uri: 'ui://weather/dash', name: 'dash', mimeType: 'text/plain' }] : [] }));
  s.setRequestHandler(ReadResourceRequestSchema, async (r) => ({ contents: [{ uri: r.params.uri, mimeType: 'text/plain', text: 'not html' }] }));
  s.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'sunny' }] }));
  return s;
}

if (isMain(import.meta.url)) {
  await createUiCapServer({ fallback: process.argv.includes('--fallback') }).connect(new StdioServerTransport());
}
