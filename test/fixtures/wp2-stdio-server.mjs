#!/usr/bin/env node
// Raw JSON-RPC stdio fixture for the WP2-connect remediation tests. Modes (first argument):
//   pino          a JSON log line ({"level":30,...}) on stdout before every response (SRV-018 must see it)
//   spam N        N non-JSON lines on stdout before the initialize response (bounded memory, counted)
//   banner        a banner on stdout and a cause on stderr, then no answer at all (failed handshake keeps both)
//   die           initialize with capabilities {}, then exit on notifications/initialized (a transport failure, not a missing capability)
//   bigui MB      one tool linking ui://big, whose resources/read answer is MB megabytes (over the SDK's 10 MB default)
//   keep          answers normally, but stays alive after stdin EOF (until SIGTERM): closing takes the full 2 s wait
//   callhang      answers everything but tools/call, which it never answers
import readline from 'node:readline';

const [mode, arg] = process.argv.slice(2);
const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const log = (msg) => process.stdout.write(`${JSON.stringify({ level: 30, time: Date.now(), pid: process.pid, msg })}\n`);

if (mode === 'banner') {
  process.stdout.write('MCP server listening on http://localhost:3000/mcp\n');
  process.stderr.write('srv: waiting for DATABASE_URL\n');
  setInterval(() => {}, 1000);
} else {
  if (mode === 'keep') { setInterval(() => {}, 1000); setTimeout(() => process.exit(0), 30000); }
  if (mode === 'spam') {
    const line = `${'x'.repeat(98)}\n`;
    process.stdout.write(line.repeat(Number(arg)));
  }
  const tool = {
    name: 'search_notes', title: 'Search notes',
    description: 'Search the user notes in the Acme Notes API by keyword and return matching note ids and titles.',
    inputSchema: { type: 'object', properties: { keywords: { type: 'string', description: 'Words to search for' } }, required: ['keywords'] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    ...(mode === 'bigui' ? { _meta: { ui: { resourceUri: 'ui://big' } } } : {}),
  };
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    const m = JSON.parse(line);
    if (mode === 'pino') log(`request ${m.method}`);
    if (mode === 'die' && m.method === 'notifications/initialized') process.exit(0);
    if (m.id === undefined) return;
    if (m.method === 'initialize') {
      const capabilities = mode === 'die' ? {} : { tools: {}, ...(mode === 'bigui' ? { resources: {} } : {}) };
      send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-11-25', capabilities, serverInfo: { name: 'wp2', title: 'WP2', version: '1.0.0' } } });
    } else if (m.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: m.id, result: { tools: [tool] } });
    } else if (m.method === 'resources/list') {
      send({ jsonrpc: '2.0', id: m.id, result: { resources: [] } });
    } else if (m.method === 'tools/call' && mode === 'callhang') {
      // never answered: the unknown-tool wire probe waits for its timeout
    } else if (m.method === 'resources/read' && mode === 'bigui') {
      const text = `<html><body>${'x'.repeat(Number(arg) * 1024 * 1024)}</body></html>`;
      send({ jsonrpc: '2.0', id: m.id, result: { contents: [{ uri: m.params.uri, mimeType: 'text/html;profile=mcp-app', text }] } });
    } else {
      send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
    }
  });
}
