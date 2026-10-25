#!/usr/bin/env node
// 400 tools without annotations, so the report has thousands of findings and more than 64 KB of ::error/::warning lines.
import readline from 'node:readline';
const tools = Array.from({ length: 400 }, (_, i) => ({ name: `tool_${i}`, description: `Does thing number ${i}.`, inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }));
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (l) => {
  const m = JSON.parse(l);
  if (m.id === undefined) return;
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'many', version: '1.0.0' } } });
  else if (m.method === 'tools/list') send({ id: m.id, result: { tools } });
  else send({ id: m.id, error: { code: -32601, message: 'Method not found' } });
});
