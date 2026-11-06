// Review round 3, package P7 (1.0.1): every report shape validates against schema/report.schema.json, including the
// listing-only run (A07-02 = A10-03) and a snapshot budget stop (A07-03); the schema $id and the report $schema follow
// the package version (A10-04). Round 4 (1.2.0, I-A07-3): a table over every report shape.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import _Ajv2020 from 'ajv/dist/2020.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const hold = vi.hoisted(() => ({ budget: undefined as number | undefined }));
vi.mock('../src/connect.js', async (orig) => {
  const actual = await orig<typeof import('../src/connect.js')>();
  return { ...actual, buildSnapshot: (o: Parameters<typeof actual.buildSnapshot>[0]) => actual.buildSnapshot(hold.budget ? { ...o, snapshotBudget: hold.budget } : o) };
});

import { runCli } from '../src/cli.js';
import { buildReport } from '../src/report/index.js';
import { JSON_SCHEMA_URL, toJson } from '../src/report/json.js';
import { runRules } from '../src/rules/engine.js';
import { defineRule, type Rule, type RuleMeta } from '../src/rules/types.js';
import type { Snapshot } from '../src/snapshot.js';
import { snap } from './helpers.js';
import { VERSION } from '../src/version.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const SCHEMA = JSON.parse(readFileSync(new URL('../schema/report.schema.json', import.meta.url), 'utf8'));
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

let validate: any;
beforeAll(() => {
  const Ajv = ((_Ajv2020 as unknown as { default?: unknown }).default ?? _Ajv2020) as new (o: object) => any;
  const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: true });
  ajv.addFormat('uri', (x: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|\\^`]*$/i.test(x));
  ajv.addFormat('date-time', (x: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(x) && !Number.isNaN(Date.parse(x)));
  validate = ajv.compile(SCHEMA);
});
beforeEach(() => { hold.budget = undefined; });

const json = async (args: string[]) => {
  const r = await runCli(['--no-config', '--format', 'json', ...args], {}, false);
  return { code: r.code, doc: JSON.parse(r.stdout), stderr: r.stderr };
};
const valid = (doc: unknown) => [validate(doc), JSON.stringify(validate.errors)?.slice(0, 2000)] as const;

describe('A07-02 / A10-03: a listing-only report validates against the schema', () => {
  it('--plugin-dir without a server', async () => {
    const { doc } = await json(['--plugin-dir', fixture('listing/plugin-valid')]);
    expect(doc.server.listingOnly).toBe(true);
    expect(doc.server.url ?? doc.server.command).toBeUndefined();
    expect(...valid(doc)).toBe(true);
  });

  it('--openai-manifest without a server', async () => {
    const { doc } = await json(['--openai-manifest', fixture('listing/openai-valid/plugin.json')]);
    expect(doc.server.listingOnly).toBe(true);
    expect(...valid(doc)).toBe(true);
  });

  it('the schema still rejects a server with listingOnly and a url or a command, or with none of the three', async () => {
    const { doc } = await json(['--plugin-dir', fixture('listing/plugin-valid')]);
    expect(validate({ ...doc, server: { ...doc.server, url: 'https://example.test/mcp' } })).toBe(false);
    expect(validate({ ...doc, server: { ...doc.server, command: 'node x', argv: ['node', 'x'] } })).toBe(false);
    const { listingOnly: _drop, ...none } = doc.server;
    expect(validate({ ...doc, server: none })).toBe(false);
  });
});

describe('A07-03: a report with an exhausted snapshot budget validates against the schema', () => {
  it('limits.budgetExhausted and a truncated entry in bytes', async () => {
    hold.budget = 20000;
    const { doc } = await json(['--fail-on', 'never', '--stdio', '--', process.execPath, fixture('many-tools-server.mjs')]);
    expect(doc.limits.budgetExhausted).toMatchObject({ bytes: 20000, phase: expect.any(String), completed: expect.any(Array), unfinished: expect.any(Array) });
    expect(doc.limits.truncated.some((t: any) => t.unit === 'bytes')).toBe(true);
    expect(...valid(doc)).toBe(true);
    // The new object is closed like the others.
    expect(validate({ ...doc, limits: { ...doc.limits, budgetExhausted: { ...doc.limits.budgetExhausted, extra: 1 } } })).toBe(false);
    expect(validate({ ...doc, limits: { ...doc.limits, truncated: [{ where: 'x', length: 1, cap: 1, unit: 'lines' }] } })).toBe(false);
  }, 30_000);
});

describe('A10-04: $schema and the schema $id follow the package version', () => {
  it('JSON_SCHEMA_URL names the tag of this version, and the schema file says the same', () => {
    expect(VERSION).toBe(PKG.version);
    expect(JSON_SCHEMA_URL).toBe(`https://raw.githubusercontent.com/alisaosipova/mcp-review-check/v${PKG.version}/schema/report.schema.json`);
    // Fails at a version bump until schema/report.schema.json $id is updated with it (the release step).
    expect(SCHEMA.$id).toBe(JSON_SCHEMA_URL);
  });

  it('a report names that URL in $schema', async () => {
    const { doc } = await json(['--stdio', '--', process.execPath, fixture('good-server.mjs')]);
    expect(doc.$schema).toBe(JSON_SCHEMA_URL);
    expect(doc.$schema).toContain(`/v${VERSION}/`);
  });
});

// Review round 4, P7 (1.2.0, I-A07-3): one table over every report shape; each validates against the schema. These
// would have caught A07-04 (a plain --env value equal to a platform broke `target`) and A07-05 (INTERNAL ruleId).
describe('I-A07-3: every report shape validates against the schema', () => {
  const REPO = fileURLToPath(new URL('../', import.meta.url));
  const T0 = new Date('2026-11-05T00:00:00Z');
  const meta: RuleMeta = { id: 'TEST-301', title: 't', severity: { claude: 'warning', chatgpt: 'warning', spec: 'info' }, needs: [], rationale: 'r', fix: 'f', sources: ['https://x.test'] };
  const unit = (s: Snapshot, opts: { failOnIncomplete?: boolean; rules?: Rule[] } = {}) => toJson(buildReport(s, runRules(s, opts.rules ?? []), [], 'error', T0, 1, false, !!opts.failOnIncomplete));
  const stdio = (name: string) => ['--stdio', '--', process.execPath, fixture(name)];
  let scratch = '';
  beforeAll(() => {
    // Scratch under the repo's ignored .captures/, not the system temp folder.
    mkdirSync(join(REPO, '.captures'), { recursive: true });
    scratch = mkdtempSync(join(REPO, '.captures', 'r111-p7-schema-'));
  });
  afterAll(() => { rmSync(scratch, { recursive: true, force: true }); });

  const shapes: Array<[string, () => Promise<Record<string, any>>, (doc: Record<string, any>) => void]> = [
    ['an INTERNAL finding (a rule that threw)', async () => unit(snap(), { rules: [defineRule(meta, () => { throw new Error('boom'); })] }), (doc) => {
      expect(doc.findings.some((f: { ruleId: string }) => f.ruleId === 'INTERNAL')).toBe(true);
      expect(doc.summary).toMatchObject({ internalErrors: 1, score: null, failed: false });
    }],
    ['--baseline with drift and --fail-on-drift', async () => {
      const base = join(scratch, 'base.json');
      await json(['--save-baseline', base, ...stdio('good-server.mjs')]);
      const b = JSON.parse(readFileSync(base, 'utf8'));
      b.toolFingerprints[0].sha256 = '0'.repeat(64);
      b.toolFingerprints[0].fields.description = '0'.repeat(64);
      writeFileSync(base, JSON.stringify(b));
      const { doc, code } = await json(['--baseline', base, '--fail-on-drift', ...stdio('good-server.mjs')]);
      expect(code).toBe(1);
      return doc;
    }, (doc) => expect(doc.summary.gate.reason).toBe('tool definitions changed since baseline (--fail-on-drift)')],
    ['a plain-name --env value equal to a platform (--env MODE=claude --target claude)', async () => (await json(['--target', 'claude', '--env', 'MODE=claude', ...stdio('good-server.mjs')])).doc, (doc) => {
      expect(doc.target).toBe('claude');
      expect(JSON.stringify(doc)).not.toContain('\u00abredacted\u00bb');
    }],
    ['--fail-on-incomplete on a partial check', async () => {
      const s = snap();
      s.coverage = { toolLevel: 'auth-required' };
      return unit(s, { failOnIncomplete: true });
    }, (doc) => expect(doc.summary).toMatchObject({ failed: true, score: null })],
    ['a --max-duration stop', async () => {
      const s = snap();
      s.coverage = { toolLevel: 'stopped' };
      s.limits = { truncated: [], stopped: { maxDurationMs: 1000, phase: 'listing', completed: ['connect'], unfinished: ['listing'] } };
      return unit(s);
    }, (doc) => expect(doc.summary.verdicts.claude.verdict).toBe('INCOMPLETE')],
    ['an exhausted snapshot budget', async () => {
      hold.budget = 20000;
      return (await json(['--fail-on', 'never', ...stdio('many-tools-server.mjs')])).doc;
    }, (doc) => expect(doc.limits.budgetExhausted).toBeTruthy()],
    ['a listing-only run with one platform unchecked', async () => (await json(['--plugin-dir', fixture('listing/plugin-valid')])).doc, (doc) => {
      expect(doc.summary.verdicts.chatgpt.verdict).toBe('INCOMPLETE');
    }],
    ['a server with C1, bidi and link text', async () => (await json(stdio('r111-p7-evil-server.mjs'))).doc, (doc) => {
      expect(doc.server.serverInfo.name).toBe('srv\u009B31mRED\u0085x');
    }],
  ];
  for (const [name, make, check] of shapes) {
    it(name, async () => {
      const doc = await make();
      expect(...valid(doc)).toBe(true);
      check(doc);
    }, 60_000);
  }

  it('the schema keeps ruleId and internalErrors strict', async () => {
    const doc = unit(snap(), { rules: [defineRule(meta, () => { throw new Error('boom'); })] }) as Record<string, any>;
    expect(validate({ ...doc, findings: [{ ...doc.findings[0], ruleId: 'INTERNALX' }] })).toBe(false);
    expect(validate({ ...doc, findings: [{ ...doc.findings[0], ruleId: 'tool-006' }] })).toBe(false);
    expect(validate({ ...doc, summary: { ...doc.summary, internalErrors: 0 } })).toBe(false);
  });
});
