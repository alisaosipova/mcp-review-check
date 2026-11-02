// Regression tests for the W6A-cli package (wave 6, 0.4.0): the JSON Schema of the JSON report (MARKET §3.4 part).
// schema/report.schema.json (draft 2020-12) ships in the npm package, every JSON report names it in `$schema`, and the
// reports of the fixture servers (good, bad, with and without --baseline, with drift, a --max-duration stop, a failed
// connect) validate against it, with additionalProperties: false on the objects, so a new field fails here until
// the schema has it. Validator: ajv (already a runtime dependency, 8.x) with its 2020-12 build; the three formats the
// schema uses are added by hand, so ajv-formats is not needed.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import _Ajv2020 from 'ajv/dist/2020.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { JSON_SCHEMA_URL } from '../src/report/json.js';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const stdio = (name: string, ...args: string[]) => ['--no-config', '--stdio', '--', process.execPath, fixture(name), ...args];
const SCHEMA = JSON.parse(readFileSync(new URL('../schema/report.schema.json', import.meta.url), 'utf8'));
const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function validator(): any {
  const Ajv = ((_Ajv2020 as unknown as { default?: unknown }).default ?? _Ajv2020) as new (o: object) => any;
  const ajv = new Ajv({ strict: true, strictRequired: false, allErrors: true }); // strictRequired: oneOf branches name properties defined one level up
  ajv.addFormat('uri', (x: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|\\^`]*$/i.test(x));
  ajv.addFormat('date-time', (x: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(x) && !Number.isNaN(Date.parse(x)));
  return ajv.compile(SCHEMA);
}

let dir = '';
let validate: any;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-w6a-schema-')); validate = validator(); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });
const json = async (args: string[]) => {
  const r = await runCli(['--format', 'json', ...args], {}, false);
  return { code: r.code, doc: JSON.parse(r.stdout), stderr: r.stderr };
};
const valid = (doc: unknown) => [validate(doc), JSON.stringify(validate.errors)?.slice(0, 2000)] as const;

describe('schema/report.schema.json', () => {
  it('is a draft 2020-12 schema whose $id is the versioned GitHub URL that every JSON report names in $schema', () => {
    expect(SCHEMA.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(SCHEMA.$id).toBe(JSON_SCHEMA_URL);
    expect(SCHEMA.$id).toMatch(/^https:\/\/raw\.githubusercontent\.com\/alisaosipova\/mcp-review-check\/v\d+\.\d+\.\d+\/schema\/report\.schema\.json$/);
    expect(SCHEMA.additionalProperties).toBe(false);
    for (const k of ['tool', 'server', 'coverage', 'limits', 'summary', 'baseline', 'contact']) expect(SCHEMA.properties[k].additionalProperties, k).toBe(false);
    for (const k of ['finding', 'verdict', 'toolFingerprint']) expect(SCHEMA.$defs[k].additionalProperties, k).toBe(false);
  });

  it('ships in the npm package', () => {
    expect(PKG.files).toContain('schema');
  });
});

describe('fixture reports validate against the schema', () => {
  it('good and bad, without a baseline; $schema is the second key, after schemaVersion', async () => {
    for (const name of ['good-server.mjs', 'bad-server.mjs']) {
      const { doc } = await json(stdio(name));
      expect(Object.keys(doc).slice(0, 2)).toEqual(['schemaVersion', '$schema']);
      expect(doc.$schema).toBe(JSON_SCHEMA_URL);
      expect(doc.toolFingerprints.length, name).toBeGreaterThan(0);
      expect(...valid(doc)).toBe(true);
      expect(doc.server.argv[1]).toBe(fixture(name));
    }
  });

  it('with --baseline: baselined marks, summary.baselined, the drift (changes and not compared), --ignore', async () => {
    const base = join(dir, 'base.json');
    const first = await json(['--fail-on', 'never', '--save-baseline', base, ...stdio('bad-server.mjs')]);
    expect(...valid(first.doc)).toBe(true);
    const same = await json(['--baseline', base, '--ignore', 'TOOL-011', ...stdio('bad-server.mjs')]);
    expect(same.doc.summary.baselined).toBeGreaterThan(0);
    expect(same.doc.findings.some((f: any) => f.baselined === true)).toBe(true);
    expect(same.doc.ignored.length).toBeGreaterThan(0);
    expect(same.doc.baseline).toEqual({ toolChanges: { added: [], removed: [], changed: [] } });
    expect(...valid(same.doc)).toBe(true);

    const drifted = JSON.parse(readFileSync(base, 'utf8'));
    drifted.toolFingerprints[0].sha256 = 'f'.repeat(64);
    drifted.toolFingerprints[0].fields.description = 'f'.repeat(64);
    drifted.toolFingerprints.push({ name: 'gone', sha256: 'e'.repeat(64), fields: { name: 'e'.repeat(64) } });
    writeFileSync(join(dir, 'drift.json'), JSON.stringify(drifted));
    const changed = await json(['--baseline', join(dir, 'drift.json'), ...stdio('bad-server.mjs')]);
    expect(changed.doc.baseline.toolChanges.changed).toHaveLength(1);
    expect(changed.doc.baseline.toolChanges.removed).toEqual(['gone']);
    expect(...valid(changed.doc)).toBe(true);

    delete drifted.toolFingerprints;
    delete drifted.$schema;
    writeFileSync(join(dir, 'old.json'), JSON.stringify(drifted));
    const old = await json(['--baseline', join(dir, 'old.json'), ...stdio('good-server.mjs')]);
    expect(old.doc.baseline.toolChanges).toBeNull();
    expect(...valid(old.doc)).toBe(true);
  });

  it('a --max-duration stop (limits.stopped with completed and unfinished) and a failed connect', async () => {
    const stopped = await json(['--max-duration', '1500', '--timeout', '20000', ...stdio('hang-server.mjs')]);
    expect(stopped.code, stopped.stderr).toBe(4);
    expect(stopped.doc.limits.stopped).toMatchObject({ completed: expect.any(Array), unfinished: expect.any(Array) });
    expect(...valid(stopped.doc)).toBe(true);
    const failed = await json(['--no-config', '--stdio', `${JSON.stringify(process.execPath)} -e "process.exit(9)"`]);
    expect(failed.code).toBe(3);
    expect(failed.doc.toolFingerprints).toBeNull();
    expect(...valid(failed.doc)).toBe(true);
  }, 30_000);

  it('the schema rejects what a report never has: an unknown top-level key, a bad digest, an unknown finding field', async () => {
    const { doc } = await json(stdio('good-server.mjs'));
    expect(validate({ ...doc, extra: 1 })).toBe(false);
    expect(validate({ ...doc, toolFingerprints: [{ name: 'x', sha256: 'abc', fields: {} }] })).toBe(false);
    expect(validate({ ...doc, findings: [{ ruleId: 'TOOL-001', severity: 'info', platforms: ['claude'], title: 't', message: 'm', fix: 'f', docs: [], extra: 1 }] })).toBe(false);
    expect(validate({ ...doc, schemaVersion: 2 })).toBe(false);
  });
});
