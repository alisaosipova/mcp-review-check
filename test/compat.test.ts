// Compatibility sensors against the baseline (main d6100a9, mcp-review-check 0.1.0). They guard every later
// commit: rule IDs, the BAD fixture findings, JSON keys, runtime dependencies and
// CLI options with their defaults. Baseline data lives in test/fixtures/baseline/.
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { MANUAL_ITEMS, RULES } from '../src/rules/index.js';
import { BAD, cli, GOOD, ROOT, type CliRun } from './cli-runner.js';

const baseline = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/baseline/${name}`, import.meta.url), 'utf8'));

type Triple = [ruleId: string, severity: string, tool: string | null];
const BASE_TRIPLES: Triple[] = baseline('bad.json').triples;
const BASE_KEYS: { bad: string[]; good: string[] } = baseline('json-keys.json');
const BASE_OPTIONS: { flag: string; short: string | null; value: boolean; default: string | null }[] = baseline('options.json').options;

/**
 * Rules whose (rule, severity, tool) set on the BAD fixture may differ from the baseline: only changes accepted
 * on purpose, one line per rule, added by the commit that makes the change.
 */
const ACCEPTED_CHANGES: Record<string, string> = {};

const range = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-${String(i + 1).padStart(3, '0')}`);
/** The 143 rule IDs and 31 manual items of the baseline. */
const BASE_RULE_IDS = [
  ...range('SRV', 20), ...range('SPEC', 20), ...range('TOOL', 32), ...range('INJ', 10), ...range('DATA', 5),
  ...range('POL', 5), ...range('APPS', 18), ...range('AUTH', 21), ...range('RT', 12),
];
const BASE_MAN_IDS = range('MAN', 31);

function keyPaths(o: unknown, prefix = '', acc = new Set<string>()): Set<string> {
  if (Array.isArray(o)) for (const v of o) keyPaths(v, `${prefix}[]`, acc);
  else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) {
      const p = prefix ? `${prefix}.${k}` : k;
      acc.add(p);
      keyPaths(v, p, acc);
    }
  }
  return acc;
}

const triples = (json: any): string[] =>
  [...new Set<string>(json.findings.filter((f: any) => !(f.ruleId in ACCEPTED_CHANGES)).map((f: any) => JSON.stringify([f.ruleId, f.severity, f.tool ?? null])))].sort();

describe('compatibility with the baseline', () => {
  let bad: CliRun;
  let good: CliRun;
  beforeAll(async () => {
    [bad, good] = await Promise.all([cli(['--stdio', BAD, '--format', 'json']), cli(['--stdio', GOOD, '--format', 'json'])]);
  });

  it('every rule ID and manual item of the baseline is still in the catalog', () => {
    expect(BASE_RULE_IDS).toHaveLength(143);
    const rules = new Set(RULES.map((r) => r.id));
    const manual = new Set(MANUAL_ITEMS.map((m) => m.id));
    expect(BASE_RULE_IDS.filter((id) => !rules.has(id))).toEqual([]);
    expect(BASE_MAN_IDS.filter((id) => !manual.has(id))).toEqual([]);
  });

  it('the (rule, severity, tool) set on the BAD fixture matches the baseline, except accepted changes', () => {
    expect(bad.code, bad.stderr).toBe(1);
    const expected = BASE_TRIPLES.filter(([id]) => !(id in ACCEPTED_CHANGES)).map((t) => JSON.stringify(t)).sort();
    expect(triples(bad.json)).toEqual(expected);
  });

  it('JSON keys are a superset of the baseline keys (BAD and GOOD fixtures)', () => {
    const missing = (have: Set<string>, base: string[]) => base.filter((k) => !have.has(k));
    expect(missing(keyPaths(bad.json), BASE_KEYS.bad)).toEqual([]);
    expect(missing(keyPaths(good.json), BASE_KEYS.good)).toEqual([]);
  });

  it('runtime dependencies are only @modelcontextprotocol/sdk, zod and ajv', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['@modelcontextprotocol/sdk', 'ajv', 'zod']);
  });

  it('every baseline option is still documented in --help with the same default', async () => {
    const help = (await cli(['--help'])).stdout;
    const lines = help.split('\n');
    for (const o of BASE_OPTIONS) {
      expect(help, o.flag).toMatch(new RegExp(`(^|[\\s,"'(])${o.flag}(?![\\w-])`));
      if (o.flag === '--stdio') continue; // documented on the Usage line, not under Options
      const own = lines.find((l) => new RegExp(`^\\s+(-\\w, )?${o.flag}(?![\\w-])`).test(l));
      expect(own, o.flag).toBeDefined();
      if (o.short) expect(own, o.short).toMatch(new RegExp(`^\\s+${o.short}, ${o.flag}`));
      if (o.default) expect(own, o.flag).toContain(`default: ${o.default}`);
    }
  });

  it('every baseline option is still accepted, and the defaults still apply', async () => {
    const values: Record<string, string> = {
      '--stdio': 'node x.mjs', '--header': 'X-Test: 1', '--bearer': 'tok', '--target': 'all', '--format': 'text',
      '--output': join(tmpdir(), 'mrc-compat-unused.txt'), '--timeout': '30000', '--fail-on': 'error', '--tool-args': 'args.json',
      '--env': 'K=V', '--cwd': '.', '--ignore': 'TOOL-011',
    };
    const args = ['--list-rules'];
    for (const o of BASE_OPTIONS) {
      if (o.flag === '--list-rules' || o.flag === '--help' || o.flag === '--version') continue;
      args.push(o.flag, ...(o.value ? [values[o.flag]] : []));
    }
    expect(BASE_OPTIONS.filter((o) => o.value && !(o.flag in values)).map((o) => o.flag)).toEqual([]);
    const all = await cli(args);
    expect(all.code, all.stderr).toBe(0);
    expect(all.stdout).toContain('TOOL-011');
    for (const short of BASE_OPTIONS.filter((o) => o.short).map((o) => o.short!)) expect((await cli([short])).code, short).toBe(0);
    // defaults: --target all, --format text, --fail-on error (exit 1 on the BAD fixture)
    expect(bad.json.target).toBe('all');
    expect(Object.keys(bad.json.summary.verdicts).sort()).toEqual(['chatgpt', 'claude']);
    const text = await cli(['--stdio', GOOD]);
    expect(text.code, text.stderr).toBe(0);
    expect(() => JSON.parse(text.stdout)).toThrow();
    expect(text.stdout).toMatch(/^mcp-review-check /);
  });
});
