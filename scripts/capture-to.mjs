#!/usr/bin/env node
// Like capture-real.mjs, but writes to a chosen directory (used for the registry sample, which stays out of git).
// Usage: npm run build && node scripts/capture-to.mjs <outdir> <slug> <url>
// Same buildSnapshot call and output format as capture-real.mjs: read-only listing and UI resource reads only,
// no transport probes, headers or tokens. Public no-auth servers only.
// Exit 0 = captured (prints a one-line count). Exit 1 = not captured: prints only "<toolLevel>: <coverage reason>".
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';
import { lookup } from 'node:dns/promises';
import { isPublicAddress } from './registry-sample.mjs';
import { buildSnapshot } from '../dist/connect.js';

const [outdir, slug, url] = process.argv.slice(2);
if (!outdir || !slug || !url || !/^[A-Za-z0-9._-]+$/.test(slug)) { console.error('usage: node scripts/capture-to.mjs <outdir> <slug> <url>'); process.exit(2); }
// The URL comes from a public registry that anyone can write to: a name that resolves to loopback or an internal
// network would turn this capture into a request into the machine's own network (SSRF). Refuse it unless every
// address the name resolves to is public. A rebinding DNS server could still answer differently on the next
// lookup; run captures from a machine with no sensitive internal services (a CI runner, a throwaway VM).
let target;
try { target = new URL(url); } catch { console.error('error: not a URL'); process.exit(2); }
if (target.protocol !== 'https:') { console.error('connect-failed: only https URLs are captured'); process.exit(1); }
try {
  const host = target.hostname.replace(/^\[|\]$/g, '');
  const addrs = await lookup(host, { all: true, verbatim: true });
  if (!addrs.length || addrs.some((a) => !isPublicAddress(a.address))) { console.error('connect-failed: the host resolves to a non-public address'); process.exit(1); }
} catch { console.error('connect-failed: the host name does not resolve'); process.exit(1); }
const { snap } = await buildSnapshot({ target: { kind: 'http', url }, timeoutMs: 30000, platforms: 'all' });
if (snap.coverage.toolLevel !== 'ok') { console.error(`${snap.coverage.toolLevel}: ${snap.coverage.reason ?? ''}`); process.exit(1); }
const listMeta = Object.fromEntries(Object.entries(snap.listMeta).map(([k, v]) => [k, { pages: v.pages, rawPages: [], ...(v.error ? { error: v.error } : {}) }]));
const resourceReads = Object.fromEntries(Object.entries(snap.resourceReads).map(([k, v]) => [k, { ok: v.ok, raw: v.raw, error: v.error, durationMs: 0 }]));
const out = {
  capturedAt: new Date().toISOString().slice(0, 10), source: url, era: snap.era, protocolVersion: snap.protocolVersion,
  serverInfo: snap.serverInfo, capabilities: snap.capabilities, instructions: snap.instructions, initializeRaw: snap.initializeRaw, discoverRaw: snap.discoverRaw,
  tools: snap.tools, resources: snap.resources, resourceTemplates: snap.resourceTemplates, prompts: snap.prompts, listMeta, resourceReads,
};
const json = Buffer.from(JSON.stringify(out, null, 1) + '\n');
mkdirSync(resolve(outdir), { recursive: true });
const base = join(resolve(outdir), `${slug}.json`);
if (json.length > 1_000_000) {
  writeFileSync(`${base}.br`, brotliCompressSync(json, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24, [constants.BROTLI_PARAM_SIZE_HINT]: json.length } }));
} else writeFileSync(base, json);
console.log(`${slug}: ${snap.tools.length} tools, ${snap.resources.length} resources, ${snap.prompts.length} prompts, ${Object.keys(resourceReads).length} UI reads`);
process.exit(0);
