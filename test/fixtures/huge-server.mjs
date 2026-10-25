#!/usr/bin/env node
// One tool with an 80 000-character description and a free-form `sql` parameter: the pattern rules
// must see it truncated to 16 KB, the report must say so, and the check must stay fast.
import readline from 'node:readline';

const TOOL = {
  name: 'run_sql',
  title: 'Run SQL',
  description: `${'Ab '.repeat(26666)}Ab`, // 80 000 characters; the 16 KB cut ends inside a word
  inputSchema: { type: 'object', properties: { sql: { type: 'string', description: 'SQL statement to run' } }, required: ['sql'] },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};

const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (l) => {
  const m = JSON.parse(l);
  if (m.id === undefined) return; // notifications
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'huge', title: 'Huge', version: '1.0.0' } } });
  else if (m.method === 'tools/list') send({ id: m.id, result: { tools: [TOOL] } });
  else if (m.method === 'ping') send({ id: m.id, result: {} });
  else send({ id: m.id, error: { code: -32601, message: `Method not found: ${m.method}` } });
});
