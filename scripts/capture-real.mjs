#!/usr/bin/env node
// Freeze a live server's listing as a regression fixture for test/real-servers.test.ts.
// Usage: npm run build && node scripts/capture-real.mjs <name> <url>
// Writes test/fixtures/real/<name>.json (or <name>.json.br above 1 MB). Only the read-only listing and UI resource
// reads are kept: no transport probes, headers or tokens. Use it only for public no-auth servers.
import { writeFileSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { buildSnapshot } from '../dist/connect.js';

const [name, url] = process.argv.slice(2);
if (!name || !url) { console.error('usage: node scripts/capture-real.mjs <name> <url>'); process.exit(2); }
const { snap } = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 30000, platforms: 'all' });
if (snap.coverage.toolLevel !== 'ok') { console.error(`not captured: ${snap.coverage.toolLevel} ${snap.coverage.reason ?? ''}`); process.exit(1); }
const listMeta = Object.fromEntries(Object.entries(snap.listMeta).map(([k, v]) => [k, { pages: v.pages, rawPages: [], ...(v.error ? { error: v.error } : {}) }]));
const resourceReads = Object.fromEntries(Object.entries(snap.resourceReads).map(([k, v]) => [k, { ok: v.ok, raw: v.raw, error: v.error, durationMs: 0 }]));
const out = {
  capturedAt: new Date().toISOString().slice(0, 10), source: url, era: snap.era, protocolVersion: snap.protocolVersion,
  serverInfo: snap.serverInfo, capabilities: snap.capabilities, instructions: snap.instructions, initializeRaw: snap.initializeRaw, discoverRaw: snap.discoverRaw,
  tools: snap.tools, resources: snap.resources, resourceTemplates: snap.resourceTemplates, prompts: snap.prompts, listMeta, resourceReads,
};
const json = Buffer.from(JSON.stringify(out, null, 1) + '\n');
const base = new URL(`../test/fixtures/real/${name}.json`, import.meta.url);
if (json.length > 1_000_000) {
  writeFileSync(new URL(`${base.href}.br`), brotliCompressSync(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: json.length } }));
} else writeFileSync(base, json);
console.log(`${name}: ${snap.tools.length} tools, ${snap.resources.length} resources, ${snap.prompts.length} prompts, ${Object.keys(resourceReads).length} UI reads`);
