#!/usr/bin/env node
// Aggregate the content-rule results on the listings frozen from public servers (test/fixtures/real, written by
// scripts/capture-real.mjs). Offline: no network, the captures are linted the way test/real-servers.test.ts does it.
// Prints counts only; no server name, URL, tool or resource name reaches the output.
// Usage: npm run build && node scripts/aggregate-captures.mjs [--json]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';

export const DIRECTORIES = ['claude', 'chatgpt'];
export const VERDICTS = ['BLOCKED', 'NEEDS ATTENTION', 'NO AUTOMATED BLOCKERS', 'INCOMPLETE'];
const SEVERITIES = ['error', 'warning', 'info'];

const inc = (obj, key, n = 1) => { obj[key] = (obj[key] ?? 0) + n; };
const category = (ruleId) => ruleId.split('-')[0];
const sevOn = (f, p) => f.severityByPlatform?.[p] ?? f.severity;

/**
 * Aggregate per-server results into counts. Each result is { capturedAt, findings, verdicts: { claude, chatgpt } }
 * where a finding has ruleId, severity, platforms and optionally severityByPlatform. Only counts leave this function.
 * A server has "no automated blockers" in a directory when that directory has no error finding at its own severity.
 */
export function aggregate(results) {
  const out = {
    servers: results.length,
    capturedAt: {},
    findings: 0,
    bySeverity: Object.fromEntries(SEVERITIES.map((s) => [s, 0])),
    byCategory: {},
    errorsByRule: {},
    warningsByRule: {},
    noBlockers: { claude: 0, chatgpt: 0, both: 0 },
    verdicts: Object.fromEntries(DIRECTORIES.map((d) => [d, Object.fromEntries(VERDICTS.map((v) => [v, 0]))])),
  };
  for (const r of results) {
    inc(out.capturedAt, r.capturedAt ?? 'unknown');
    out.findings += r.findings.length;
    const errorRules = new Set();
    const warningRules = new Set();
    for (const f of r.findings) {
      inc(out.bySeverity, f.severity);
      const c = (out.byCategory[category(f.ruleId)] ??= Object.fromEntries(SEVERITIES.map((s) => [s, 0])));
      inc(c, f.severity);
      if (f.severity === 'error') errorRules.add(f.ruleId);
      if (f.severity === 'warning') warningRules.add(f.ruleId);
      const tally = f.severity === 'error' ? out.errorsByRule : f.severity === 'warning' ? out.warningsByRule : null;
      if (tally) (tally[f.ruleId] ??= { findings: 0, servers: 0 }).findings++;
    }
    for (const id of errorRules) out.errorsByRule[id].servers++;
    for (const id of warningRules) out.warningsByRule[id].servers++;
    const clear = DIRECTORIES.map((d) => !r.findings.some((f) => f.platforms.includes(d) && sevOn(f, d) === 'error'));
    DIRECTORIES.forEach((d, i) => { if (clear[i]) out.noBlockers[d]++; });
    if (clear.every(Boolean)) out.noBlockers.both++;
    for (const d of DIRECTORIES) inc(out.verdicts[d], r.verdicts?.[d] ?? 'INCOMPLETE');
  }
  return out;
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');
const ranked = (tally) => Object.entries(tally).sort(([a, x], [b, y]) => y.servers - x.servers || y.findings - x.findings || a.localeCompare(b));

/** Markdown tables of an aggregate() result. Pure ASCII. */
export function renderMarkdown(a) {
  const L = [];
  L.push(`Servers: ${a.servers}. Capture dates: ${Object.entries(a.capturedAt).map(([d, n]) => `${d} (${n})`).join(', ')}. Findings: ${a.findings}.`, '');
  L.push('| Directory | Servers with no error finding | Share |', '|---|---|---|');
  for (const d of DIRECTORIES) L.push(`| ${d} | ${a.noBlockers[d]} of ${a.servers} | ${pct(a.noBlockers[d], a.servers)} |`);
  L.push(`| both | ${a.noBlockers.both} of ${a.servers} | ${pct(a.noBlockers.both, a.servers)} |`, '');
  L.push('| Directory | ' + VERDICTS.join(' | ') + ' |', '|---|' + VERDICTS.map(() => '---').join('|') + '|');
  for (const d of DIRECTORIES) L.push(`| ${d} | ${VERDICTS.map((v) => a.verdicts[d][v]).join(' | ')} |`);
  L.push('');
  L.push('| Category | error | warning | info |', '|---|---|---|---|');
  for (const [c, s] of Object.entries(a.byCategory).sort(([x], [y]) => x.localeCompare(y))) L.push(`| ${c} | ${s.error} | ${s.warning} | ${s.info} |`);
  L.push(`| total | ${a.bySeverity.error} | ${a.bySeverity.warning} | ${a.bySeverity.info} |`, '');
  for (const [title, tally] of [['Error findings by rule', a.errorsByRule], ['Warning findings by rule', a.warningsByRule]]) {
    L.push(`${title}:`, '', '| Rule | Servers | Findings |', '|---|---|---|');
    const rows = ranked(tally);
    if (!rows.length) L.push('| (none) | 0 | 0 |');
    for (const [id, t] of rows) L.push(`| ${id} | ${t.servers} | ${t.findings} |`);
    L.push('');
  }
  return L.join('\n');
}

/** Load every capture in `dir` (baseline-findings.json is not a capture) and lint it offline with the built rules. */
export async function lintCaptures(dir) {
  const dist = new URL('../dist/', import.meta.url);
  const { runRules } = await import(new URL('rules/engine.js', dist).href);
  const { RULES } = await import(new URL('rules/index.js', dist).href);
  const { emptySnapshot } = await import(new URL('snapshot.js', dist).href);
  const { verdict } = await import(new URL('report/score.js', dist).href);
  const files = readdirSync(dir).filter((f) => /\.json(\.br)?$/.test(f) && f !== 'baseline-findings.json').sort();
  const results = [];
  let rulesRun = 0;
  for (const f of files) {
    const buf = readFileSync(new URL(f, dir));
    const raw = JSON.parse(f.endsWith('.br') ? brotliDecompressSync(buf).toString('utf8') : buf.toString('utf8'));
    if (!raw.capturedAt || !Array.isArray(raw.tools)) throw new Error(`not a capture: ${f}`);
    const snap = emptySnapshot({ kind: 'http', urlAsEntered: raw.source, url: new URL(raw.source) }, { target: 'all', active: false, activeAuth: false });
    const { capturedAt, source: _s, ...rest } = raw;
    Object.assign(snap, rest);
    const res = runRules(snap, RULES);
    rulesRun = Math.max(rulesRun, res.rulesRun);
    const complete = snap.coverage.toolLevel === 'ok';
    const verdicts = Object.fromEntries(DIRECTORIES.map((d) => [d, verdict(res.findings, d, complete).verdict]));
    results.push({ capturedAt, findings: res.findings, verdicts, skipped: res.skipped.length, rulesRun: res.rulesRun });
  }
  return { results, rules: RULES.length, rulesRunMax: rulesRun, rulesRunMin: Math.min(...results.map((r) => r.rulesRun)) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = new URL('../test/fixtures/real/', import.meta.url);
  if (!existsSync(new URL('../dist/rules/engine.js', import.meta.url))) { console.error('run npm run build first'); process.exit(2); }
  const { results, rules, rulesRunMin, rulesRunMax } = await lintCaptures(dir);
  const agg = aggregate(results);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ...agg, rules, rulesRunMin, rulesRunMax }, null, 1));
  else console.log(`Rules in catalog: ${rules}; rules run per capture: ${rulesRunMin}-${rulesRunMax} (the rest need probes or inputs a capture does not hold).\n\n${renderMarkdown(agg)}`);
}
