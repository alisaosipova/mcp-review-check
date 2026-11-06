#!/usr/bin/env node
// Raw stdio JSON-RPC server (no SDK, so nothing validates its answers) whose tools/list returns a tool named by an
// object with a non-function toString key: String() of that name throws (review round 4 A13-01). Inert: stdio only.
import { createInterface } from 'node:readline';

const TOOLS = [
  { name: 'search_notes', description: 'Search the notes by keyword and return note ids.', inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'Words' } } } },
  { name: { toString: 'x' }, inputSchema: { type: 'object' } },
];

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);
createInterface({ input: process.stdin }).on('line', (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.id === undefined) return; // a notification
  if (m.method === 'initialize') {
    send({ id: m.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'hostile-name', version: '1.0.0' } } });
  } else if (m.method === 'tools/list') {
    send({ id: m.id, result: { tools: TOOLS } });
  } else if (m.method === 'ping') {
    send({ id: m.id, result: {} });
  } else {
    send({ id: m.id, error: { code: -32601, message: 'Method not found' } });
  }
});
