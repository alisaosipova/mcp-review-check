#!/usr/bin/env node
// A stdio server that does not quit when its stdin closes (a timer keeps it alive), for the --max-duration
// cleanup test. Usage: stubborn-server.mjs <pid-file> [--mute] [--hang-fresh] [--mute-fresh] [--ignore-term] [--slow-active]
//   default        answers initialize only: every later request hangs
//   --mute         answers nothing (no handshake)
//   --hang-fresh   the first process answers the listing; every later process (a fresh connection) hangs after initialize
//   --mute-fresh   the first process answers the listing and quits on stdin EOF; every later process (a fresh
//                  connection) answers nothing
//   --ignore-term  ignores SIGTERM, so only SIGKILL ends it
//   --slow-active  answers everything: 30 read-only tools, each tools/call after 300 ms; exits 800 ms after SIGTERM
// Each process appends its pid to <pid-file> and exits by itself after 30 s, so a failed test leaves nothing behind.
import { appendFileSync, existsSync } from 'node:fs';
import readline from 'node:readline';

const [pidFile, ...flags] = process.argv.slice(2);
const first = !existsSync(pidFile);
appendFileSync(pidFile, `${process.pid}\n`);
if (flags.includes('--ignore-term')) process.on('SIGTERM', () => {});
const slow = flags.includes('--slow-active');
if (slow) process.on('SIGTERM', () => setTimeout(() => process.exit(0), 800));
setInterval(() => {}, 1000);
setTimeout(() => process.exit(0), 30000);

const answerAll = ((flags.includes('--hang-fresh') || flags.includes('--mute-fresh')) && first) || slow;
const mute = flags.includes('--mute') || (flags.includes('--mute-fresh') && !first);
if (flags.includes('--mute-fresh') && first) process.stdin.on('end', () => process.exit(0));
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
const results = {
  'tools/list': { tools: slow
    ? Array.from({ length: 30 }, (_, i) => ({ name: `get_item_${i}`, title: `Get item ${i}`, description: 'Returns an item by number.', inputSchema: { type: 'object', properties: {} }, annotations: readOnly }))
    : [{ name: 'ping', description: 'Reply with pong.', inputSchema: { type: 'object' } }] },
  'resources/list': { resources: [] },
  'resources/templates/list': { resourceTemplates: [] },
  'prompts/list': { prompts: [] },
};
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (mute) return;
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m?.id === undefined || typeof m.method !== 'string') return;
  if (m.method === 'initialize') {
    send({ id: m.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: 'stubborn', version: '1' } } });
  } else if (slow && m.method === 'tools/call') {
    setTimeout(() => send({ id: m.id, result: { content: [{ type: 'text', text: 'ok' }] } }), 300);
  } else if (answerAll) {
    send(m.method in results ? { id: m.id, result: results[m.method] } : { id: m.id, error: { code: -32601, message: 'Method not found' } });
  }
});
