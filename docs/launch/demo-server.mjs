#!/usr/bin/env node
// Demo stdio MCP server for the README screenshot (docs/assets/sample-output.svg). Small on purpose, with two
// mistakes real servers often make: a tool without a title (the Claude directory requires one) and a tool that
// takes a free-form URL while claiming openWorldHint: false (ChatGPT flags it).
// Usage: node dist/cli.js --quiet --stdio -- node docs/launch/demo-server.mjs
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';

const str = (description) => ({ type: 'string', description });
const tools = [
  {
    name: 'list_tasks',
    title: 'List tasks',
    description: 'List open tasks in the user\'s Acme Tasks workspace, newest first, with id, title and due date.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Maximum number of tasks to return (default 20)' },
        fields: { type: 'array', items: { type: 'string', enum: ['id', 'title', 'due'] }, description: 'Fields to include in each task' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'create_task',
    description: 'Create a task in the user\'s Acme Tasks workspace and return the id of the new task.',
    inputSchema: { type: 'object', properties: { title: str('Short title of the task'), due: str('Due date, YYYY-MM-DD') }, required: ['title'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'delete_task',
    title: 'Delete task',
    description: 'Permanently delete a task from the user\'s Acme Tasks workspace by its id.',
    inputSchema: { type: 'object', properties: { id: str('Task id') }, required: ['id'] },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  {
    name: 'import_tasks',
    title: 'Import tasks',
    description: 'Download a CSV file of tasks from a URL and add every row to the user\'s Acme Tasks workspace, creating new tasks.',
    inputSchema: { type: 'object', properties: { url: str('Address of the CSV file') }, required: ['url'] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
];

const server = new Server({ name: 'acme-tasks', title: 'Acme Tasks', version: '2.3.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (!tools.some((t) => t.name === req.params.name)) throw new McpError(ErrorCode.InvalidParams, `unknown tool: ${req.params.name}`);
  return { content: [{ type: 'text', text: 'ok' }] };
});
await server.connect(new StdioServerTransport());
