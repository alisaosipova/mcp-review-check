#!/usr/bin/env node
// A stdio server that does not quit when its stdin closes (a timer keeps it alive), for the --max-duration
// cleanup test (R-60). Usage: stubborn-server.mjs <pid-file> [--mute] [--hang-fresh] [--ignore-term]
//   default        answers initialize only: every later request hangs
//   --mute         answers nothing (no handshake)
//   --hang-fresh   the first process answers the listing; every later process (a fresh connection) hangs after initialize
//   --ignore-term  ignores SIGTERM, so only SIGKILL ends it
// Each process appends its pid to <pid-file> and exits by itself after 30 s, so a failed test leaves nothing behind.
import { appendFileSync, existsSync } from 'node:fs';
import readline from 'node:readline';

const [pidFile, ...flags] = process.argv.slice(2);
const first = !existsSync(pidFile);
appendFileSync(pidFile, `${process.pid}\n`);
if (flags.includes('--ignore-term')) process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
setTimeout(() => process.exit(0), 30000);

const answerAll = flags.includes('--hang-fresh') && first;
const results = {
  'tools/list': { tools: [{ name: 'ping', description: 'Reply with pong.', inputSchema: { type: 'object' } }] },
  'resources/list': { resources: [] },
  'resources/templates/list': { resourceTemplates: [] },
  'prompts/list': { prompts: [] },
};
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (flags.includes('--mute')) return;
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m?.id === undefined || typeof m.method !== 'string') return;
  if (m.method === 'initialize') {
    send({ id: m.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: 'stubborn', version: '1' } } });
  } else if (answerAll) {
    send(m.method in results ? { id: m.id, result: results[m.method] } : { id: m.id, error: { code: -32601, message: 'Method not found' } });
  }
});
