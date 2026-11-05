// mcp-review-check 1.1.0, package Q5 (reports): --fail-on-incomplete is native to buildReport, so JUnit and the GitHub
// annotations say the run failed without CLI post-processing (A10-01 native); the JSON report names the DCR client
// --active-auth registered (authProbe.active.clientId, since 1.1); finding text in annotations goes through visibleText.
import { readFileSync } from 'node:fs';
import _Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { REDACTED } from '../src/protocol/trace.js';
import { buildRedactor, redactDeep } from '../src/redact.js';
import { annotations } from '../src/report/github.js';
import { buildReport } from '../src/report/index.js';
import { renderJson, toJson } from '../src/report/json.js';
import { renderJunit } from '../src/report/junit.js';
import { RULES } from '../src/rules/index.js';
import { runRules } from '../src/rules/engine.js';
import type { Finding } from '../src/rules/types.js';
import type { Snapshot } from '../src/snapshot.js';
import { loadSnapshot } from './helpers.js';

const AT = new Date('2026-11-04T10:00:00Z');
const partial = (): Snapshot => {
  const s = loadSnapshot('minimal-http');
  s.coverage = { toolLevel: 'list-failed', reason: 'tools/list failed' };
  return s;
};
const report = (s: Snapshot, failOnIncomplete: boolean, findings?: Finding[]) => {
  const r = runRules(s, RULES);
  return buildReport(s, findings ? { ...r, findings } : r, [], 'never', AT, 1, false, failOnIncomplete);
};

describe('A10-01 native: buildReport takes --fail-on-incomplete', () => {
  it('marks the report failed with the cause in gate.reason; not without the flag, a complete check or a failed connect', () => {
    const r = report(partial(), true);
    expect(r.incompleteFails).toBe(true);
    expect(r.summary.failed).toBe(true);
    expect(r.summary.gate.reason).toBe('partial check: list-failed (--fail-on-incomplete)');
    const off = report(partial(), false);
    expect(off.incompleteFails).toBe(false);
    expect(off.summary.failed).toBe(false);
    expect(report(loadSnapshot('minimal-http'), true).incompleteFails).toBe(false);
    const fatal = partial();
    fatal.fatal = 'ECONNREFUSED';
    fatal.coverage = { toolLevel: 'connect-failed', reason: 'connection refused' };
    expect(report(fatal, true).incompleteFails).toBe(false);
  });

  it('renders one <error type="incomplete"> run case per JUnit suite, with the counts', () => {
    const xml = renderJunit(report(partial(), true));
    const cases = xml.match(/<error message="partial check: list-failed \(tools\/list failed\); --fail-on-incomplete fails the run" type="incomplete"\/>/g) ?? [];
    const suites = xml.match(/<testsuite /g) ?? [];
    expect(suites.length).toBeGreaterThan(0);
    expect(cases).toHaveLength(suites.length);
    for (const m of xml.matchAll(/<testsuite [^>]*errors="(\d+)"/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(1);
    expect(renderJunit(report(partial(), false))).not.toContain('type="incomplete"');
  });

  it('turns the partial-check annotation into an ::error without the advice to add the flag', () => {
    const [on] = annotations(report(partial(), true)).filter((a) => a.includes('Partial check'));
    expect(on.startsWith('::error title=mcp-review-check::Partial check: list-failed')).toBe(true);
    expect(on.endsWith(' --fail-on-incomplete fails the run.')).toBe(true);
    const [off] = annotations(report(partial(), false)).filter((a) => a.includes('Partial check'));
    expect(off.startsWith('::warning title=mcp-review-check::Partial check: list-failed')).toBe(true);
    expect(off.endsWith(' --fail-on-incomplete fails the run on a partial check.')).toBe(true);
  });
});

describe('authProbe.active.clientId: the DCR client --active-auth registered (since 1.1)', () => {
  const SCHEMA = JSON.parse(readFileSync(new URL('../schema/report.schema.json', import.meta.url), 'utf8'));
  const Ajv = ((_Ajv2020 as unknown as { default?: unknown }).default ?? _Ajv2020) as new (o: object) => any;
  const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: true });
  ajv.addFormat('uri', (x: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|\\^`]*$/i.test(x));
  ajv.addFormat('date-time', (x: string) => !Number.isNaN(Date.parse(x)));
  const validate = ajv.compile(SCHEMA);
  const withActive = (active: NonNullable<Snapshot['authProbe']>['active']): Snapshot => {
    const s = loadSnapshot('minimal-http');
    s.authProbe = { as: [], active } as unknown as Snapshot['authProbe'];
    return s;
  };

  it('is in the JSON report, valid against the schema, null when no client_id came back, absent without --active-auth', () => {
    const doc = toJson(report(withActive({ clientId: 'mrc-client-42' }), false, [])) as { authProbe?: unknown };
    expect(doc.authProbe).toEqual({ active: { clientId: 'mrc-client-42' } });
    expect(validate(JSON.parse(JSON.stringify(doc))), JSON.stringify(validate.errors)).toBe(true);
    const none = toJson(report(withActive({}), false, [])) as { authProbe?: unknown };
    expect(none.authProbe).toEqual({ active: { clientId: null } });
    expect(validate(JSON.parse(JSON.stringify(none))), JSON.stringify(validate.errors)).toBe(true);
    expect('authProbe' in toJson(report(loadSnapshot('minimal-http'), false))).toBe(false);
  });

  it('documents the field as since 1.1 and never carries a client_secret', () => {
    expect(SCHEMA.properties.authProbe.description).toMatch(/^Since 1\.1/);
    expect(SCHEMA.properties.authProbe.properties.active.properties.clientId.description).toMatch(/^Since 1\.1/);
    const secret = ['sk', 'live', 'SYNTH0client0secret0value'].join('_');
    const s = withActive({ clientId: 'c-1', clientSecret: secret } as never);
    expect(renderJson(report(s, false))).not.toContain(secret);
  });

  it('is redacted like every report string', () => {
    const bearer = ['sk', 'live', 'SYNTH0bearer0in0client0id'].join('_');
    const built = report(withActive({ clientId: `id-${bearer}` }), false);
    const out = renderJson(redactDeep(built, buildRedactor({ bearer })));
    expect(out).not.toContain(bearer);
    expect((JSON.parse(out) as { authProbe: { active: { clientId: string } } }).authProbe.active.clientId).toBe(`id-${REDACTED}`);
  });
});

describe('annotations(): finding text through visibleText as well as escapeCommand', () => {
  it('shows ESC, bidi overrides, line separators and a legacy ##[ in the message, fix and title', () => {
    const f: Finding = {
      ruleId: 'DESC-001', title: 't', severity: 'error', platforms: ['claude'], tool: 'x\u202Ey',
      message: 'm \u001b[31mred\u001b[0m \u2028::error::own ##[group]', fix: 'fix \u200B', docs: ['https://x.test'],
    };
    const r = report(loadSnapshot('minimal-http'), false, [f]);
    const lines = annotations({ ...r, summary: { ...r.summary, gate: { ...r.summary.gate, platforms: ['claude'] } } });
    const line = lines.find((l) => l.includes('DESC-001'))!;
    expect(line).toBeDefined();
    expect(line).not.toMatch(/[\u001b\u202E\u2028\u200B]/);
    expect(line).toContain('\\u{1B}[31mred');
    expect(line).toContain('\\u{2028}::error::own #\\u{23}[group]');
    expect(line).toContain('fix \\u{200B}');
    expect(line).toContain('x\\u{202E}y');
    expect(line.split('\n')).toHaveLength(1);
  });
});
