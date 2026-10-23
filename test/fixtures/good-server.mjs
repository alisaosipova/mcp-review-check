#!/usr/bin/env node
// GOOD fixture: a well-behaved stdio MCP server (SDK McpServer). Expected: zero errors and zero
// warnings for --target all in local mode (local-mode info findings are fine).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';

export function createGoodServer() {
  const server = new McpServer(
    { name: 'acme-notes', title: 'Acme Notes', version: '1.4.2' },
    { instructions: 'Acme Notes stores short personal notes. Search before creating to avoid duplicates.' },
  );

  const notes = [
    { id: 'n1', title: 'Groceries', content: 'Milk, eggs, bread' },
    { id: 'n2', title: 'Ideas', content: 'Write the quarterly plan' },
  ];

  server.registerTool(
    'search_notes',
    {
      title: 'Search notes',
      description: 'Search the user\'s notes in the Acme Notes API by keyword and return matching note ids and titles.',
      inputSchema: {
        keywords: z.string().describe('Words to look for in note titles and bodies'),
        limit: z.number().int().min(1).max(50).optional().describe('Maximum number of results to return (default 10)'),
        fields: z.array(z.enum(['id', 'title'])).optional().describe('Fields to include in each result'),
      },
      outputSchema: {
        results: z.array(z.object({ id: z.string().describe('Note id'), title: z.string().describe('Note title') })).describe('Matching notes'),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ keywords, limit }) => {
      const results = notes
        .filter((n) => `${n.title} ${n.content}`.toLowerCase().includes(String(keywords).toLowerCase()))
        .slice(0, limit ?? 10)
        .map(({ id, title }) => ({ id, title }));
      const structuredContent = { results };
      return { structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }] };
    },
  );

  server.registerTool(
    'create_note',
    {
      title: 'Create note',
      description: 'Create a new note in the user\'s Acme Notes workspace and return the id of the saved note.',
      inputSchema: {
        title: z.string().describe('Short title of the note'),
        content: z.string().describe('Text of the note'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ title, content }) => {
      const id = `n${notes.length + 1}`;
      notes.push({ id, title, content });
      return { content: [{ type: 'text', text: `Created note ${id}` }] };
    },
  );

  server.registerTool(
    'delete_note',
    {
      title: 'Delete note',
      description: 'Permanently delete one note from the user\'s Acme Notes workspace by its id.',
      inputSchema: { note_id: z.string().describe('Id of the note to delete') },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ note_id }) => ({ content: [{ type: 'text', text: `Deleted note ${note_id}` }] }),
  );

  server.registerTool(
    'show_note_board',
    {
      title: 'Show note board',
      description: 'Show the user\'s notes as an interactive board widget, with the note titles as text.',
      inputSchema: { board: z.enum(['all', 'recent']).optional().describe('Which notes to show on the board') },
      outputSchema: { titles: z.array(z.string()).describe('Titles shown on the board') },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        ui: { resourceUri: 'ui://acme-notes/board.html' },
        'openai/toolInvocation/invoking': 'Opening your board',
        'openai/toolInvocation/invoked': 'Board ready',
      },
    },
    async () => {
      const structuredContent = { titles: notes.map((n) => n.title) };
      return { structuredContent, content: [{ type: 'text', text: `Your board shows: ${structuredContent.titles.join(', ')}` }] };
    },
  );

  const widgetMeta = {
    ui: {
      csp: { resourceDomains: ['https://cdn.acme-notes.test'], connectDomains: ['https://api.acme-notes.test'] },
      prefersBorder: true,
    },
    'openai/widgetDomain': 'https://widgets.acme-notes.test',
  };
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><script type="module" src="https://cdn.acme-notes.test/board.js"></script></head>
<body><main id="board"></main>
<script>fetch('https://api.acme-notes.test/v1/board').then((r) => r.json()).then(console.log);</script>
</body></html>`;

  server.registerResource(
    'note-board',
    'ui://acme-notes/board.html',
    { title: 'Note board', description: 'Interactive board of notes', mimeType: 'text/html;profile=mcp-app', _meta: widgetMeta },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/html;profile=mcp-app', text: html, _meta: widgetMeta }] }),
  );

  // The SDK answers unknown tools with an isError result; the spec asks for a JSON-RPC error.
  const handlers = server.server._requestHandlers;
  const callTool = handlers.get('tools/call');
  const known = new Set(['search_notes', 'create_note', 'delete_note', 'show_note_board']);
  handlers.set('tools/call', (request, extra) => {
    if (!known.has(request?.params?.name)) throw new McpError(-32602, `Unknown tool: ${request?.params?.name}`);
    return callTool(request, extra);
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createGoodServer();
  await server.connect(new StdioServerTransport());
}
