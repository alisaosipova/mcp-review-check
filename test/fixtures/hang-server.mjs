#!/usr/bin/env node
// Answers initialize and nothing else: every later request hangs until its timeout (--max-duration test).
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (l) => {
  const m = JSON.parse(l);
  if (m.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-11-25', capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: 'hang', version: '1' } } }) + '\n');
  }
});
