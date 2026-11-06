#!/usr/bin/env node
// A stdio server for the cleanup tests of a check that throws after the handshake. The throw itself comes from the test
// (throw-after-handshake-preload.mjs, or a spy on the run's clock): since safeStr (A13-01) the tool name below, which
// String() cannot convert, no longer throws, and stays only as a hostile shape. It ignores stdin EOF (a timer keeps it
// alive), so only a signal ends it. Usage: throw-server.mjs <pid-file>
// It appends its pid to <pid-file> and exits by itself after 30 s, so a failed test leaves nothing behind.
import { appendFileSync } from 'node:fs';
import readline from 'node:readline';

const [pidFile] = process.argv.slice(2);
appendFileSync(pidFile, `${process.pid}\n`);
setInterval(() => {}, 1000);
setTimeout(() => process.exit(0), 30000);

const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m?.id === undefined || typeof m.method !== 'string') return;
  if (m.method === 'initialize') {
    send({ id: m.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'thrower', version: '1' } } });
  } else if (m.method === 'tools/list') {
    send({ id: m.id, result: { tools: [{ name: { toString: 0 }, description: 'Reply with pong.', inputSchema: { type: 'object' } }] } });
  } else {
    send({ id: m.id, error: { code: -32601, message: 'Method not found' } });
  }
});
