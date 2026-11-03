#!/usr/bin/env node
// Reproduce the pre-registered sample of public remote MCP servers from the official MCP registry.
// Usage: node scripts/registry-sample.mjs [--out <SAMPLE.md>]
// Pages GET /v0/servers?version=latest once (read-only, no auth) and prints aggregate counts only.
// With --out it also writes the private candidate list (names + URLs); keep that file out of git.
// Selection: node scripts/registry-sample.mjs --pick <n> --seed <s> [--from <SAMPLE.md>]
//   Offline. Counts the candidate rows in SAMPLE.md (N), shuffles row numbers 1..N with a Fisher-Yates shuffle
//   driven by mulberry32 seeded with the 32-bit FNV-1a hash of the seed string (UTF-8 bytes), and prints the
//   first n row numbers in shuffled order, one per line. Same seed + same list => same rows.
import { readFileSync, writeFileSync } from 'node:fs';
import { BlockList, isIP } from 'node:net';
import { pathToFileURL } from 'node:url';

const BASE = 'https://registry.modelcontextprotocol.io/v0/servers';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };

/** 32-bit FNV-1a over the UTF-8 bytes of s (offset basis 2166136261, prime 16777619). */
export function fnv1a32(s) {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(s, 'utf8')) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
/** mulberry32 PRNG: returns floats in [0, 1). */
export function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Fisher-Yates over 1..total (from the end down), first n of the result. */
export function pick(total, n, seed) {
  const rand = mulberry32(fnv1a32(seed));
  const rows = Array.from({ length: total }, (_, i) => i + 1);
  for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
  return rows.slice(0, n);
}

async function getJson(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (attempt >= 1) throw err; // retry at most once
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// Addresses that are not public internet: loopback, private, link-local, CGNAT, multicast, reserved, unspecified,
// documentation ranges, and the IPv6 equivalents (incl. unique-local and IPv4-mapped forms).
const NON_PUBLIC = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) NON_PUBLIC.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['64:ff9b:1::', 48]]) NON_PUBLIC.addSubnet(net, bits, 'ipv6');

/** True when `ip` (a literal IPv4 or IPv6 address) is routable on the public internet. */
export function isPublicAddress(ip) {
  const bare = ip.replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare);
  if (mapped) return isPublicAddress(mapped[1]);
  const family = isIP(bare);
  if (!family) return false;
  return !NON_PUBLIC.check(bare, family === 4 ? 'ipv4' : 'ipv6');
}

// Not a reachable public endpoint: loopback, private ranges, reserved example domains, unresolved templates.
// This looks at the URL text only; capture-to.mjs also checks the addresses the name resolves to.
export function excluded(u) {
  const h = u.hostname.toLowerCase();
  if (/[{}]/.test(decodeURI(u.href))) return 'template';
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa')) return 'local';
  if (isIP(h.replace(/^\[|\]$/g, '')) && !isPublicAddress(h)) return 'local';
  if (/(^|\.)example\.(com|org|net)$/.test(h) || h.endsWith('.example') || h.endsWith('.test') || h.endsWith('.invalid')) return 'example';
  return undefined;
}

// Run only when executed directly, so registry-run.mjs can import pick() without touching the network.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (arg('--pick')) {
    const n = Number(arg('--pick')), seed = arg('--seed');
    const from = arg('--from') ?? new URL('../.captures/registry-2026-11-04/SAMPLE.md', import.meta.url);
    if (!Number.isInteger(n) || n < 1 || !seed) { console.error('usage: --pick <n> --seed <s> [--from <SAMPLE.md>]'); process.exit(2); }
    const total = readFileSync(from, 'utf8').split('\n').filter((l) => /^\| \d+ \|/.test(l)).length;
    if (n > total) { console.error(`only ${total} candidates`); process.exit(2); }
    console.log(pick(total, n, seed).join('\n'));
    process.exit(0);
  }
  const TRANSPORTS = new Set(['streamable-http', 'sse']);
  const outPath = arg('--out');

  const snapshotAt = new Date().toISOString();
  const servers = [];
  let cursor, pages = 0;
  do {
    const q = new URLSearchParams({ version: 'latest', limit: '100' });
    if (cursor) q.set('cursor', cursor);
    const page = await getJson(`${BASE}?${q}`);
    pages++;
    servers.push(...(page.servers ?? []));
    cursor = page.metadata?.nextCursor;
  } while (cursor);

  const latest = servers.filter((s) => s._meta?.['io.modelcontextprotocol.registry/official']?.isLatest !== false);
  const withRemotes = latest.filter((s) => (s.server?.remotes ?? []).length > 0);
  const seen = new Map();
  const counts = { remoteEntries: 0, wrongTransport: 0, notHttps: 0, badUrl: 0, template: 0, local: 0, example: 0, duplicateUrl: 0 };
  let serversWithCandidate = 0;
  for (const s of withRemotes) {
    let any = false;
    for (const r of s.server.remotes) {
      counts.remoteEntries++;
      if (!TRANSPORTS.has(r.type)) { counts.wrongTransport++; continue; }
      let u;
      try { u = new URL(String(r.url).trim()); } catch { counts.badUrl++; continue; }
      if (u.protocol !== 'https:') { counts.notHttps++; continue; }
      const why = excluded(u);
      if (why) { counts[why]++; continue; }
      if (seen.has(u.href)) { counts.duplicateUrl++; continue; }
      seen.set(u.href, { name: s.server.name, type: r.type });
      any = true;
    }
    if (any) serversWithCandidate++;
  }

  const summary = {
    snapshotAt, pages, serversListed: servers.length, latestVersions: latest.length, serversWithRemotes: withRemotes.length,
    serversWithCandidate, candidates: seen.size, ...counts,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (outPath) {
    const ascii = (s) => String(s).replace(/[^\x20-\x7e]/g, '?');
    const lines = [
      '# Registry sample 2026-11-04 (PRIVATE, gitignored, do not publish)', '',
      `- Registry snapshot time (UTC): ${snapshotAt}`,
      `- Source: ${BASE}?version=latest&limit=100 (${pages} pages, followed metadata.nextCursor to the end)`,
      `- Total servers listed (latest version of each, non-deleted): ${servers.length}`,
      `- Servers whose latest version has at least one remote: ${withRemotes.length}`,
      `- Remote entries examined: ${counts.remoteEntries}`,
      `- Excluded remotes: transport not streamable-http/sse ${counts.wrongTransport}, not https ${counts.notHttps}, unparsable ${counts.badUrl}, URL template ${counts.template}, local/private ${counts.local}, example/reserved domain ${counts.example}, duplicate URL ${counts.duplicateUrl}`,
      `- Servers contributing at least one candidate: ${serversWithCandidate}`,
      `- Candidate URLs (de-duplicated): ${seen.size}`,
      `- Reproduce counts: node scripts/registry-sample.mjs (the live registry may have changed since the snapshot)`, '',
      '## Pre-registered rule', '',
      'Every candidate is attempted once in this order; a capture counts when the script exits 0; 401/403/auth/timeout are recorded as not captured; the aggregate uses every captured server and nothing else.', '',
      'Capture method: node scripts/capture-real.mjs (read-only listing: initialize, tools/list, resources/list, prompts/list, UI resource reads; no auth, no tokens, no transport probes), one server at a time, 2 s pause between servers, 30 s timeout, at most one retry, output to .captures/registry-2026-11-04/<slug>.json.', '',
      'This list was fixed before any capture was attempted.', '',
      '## Candidates (registry order: server name ascending, then remote order)', '',
      '| # | Registry name | Transport | URL | Outcome |', '|---|---|---|---|---|',
      ...[...seen].map(([url, v], i) => `| ${i + 1} | ${ascii(v.name)} | ${v.type} | ${ascii(url)} | pending |`), '',
    ];
    writeFileSync(outPath, lines.join('\n'));
    console.error(`wrote ${outPath}`);
  }
}
