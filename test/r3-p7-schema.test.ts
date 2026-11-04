// Review round 3, package P7 (1.0.1): every report shape validates against schema/report.schema.json, including the
// listing-only run (A07-02 = A10-03) and a snapshot budget stop (A07-03); the schema $id and the report $schema follow
// the package version (A10-04).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import _Ajv2020 from 'ajv/dist/2020.js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const hold = vi.hoisted(() => ({ budget: undefined as number | undefined }));
vi.mock('../src/connect.js', async (orig) => {
  const actual = await orig<typeof import('../src/connect.js')>();
  return { ...actual, buildSnapshot: (o: Parameters<typeof actual.buildSnapshot>[0]) => actual.buildSnapshot(hold.budget ? { ...o, snapshotBudget: hold.budget } : o) };
});

import { runCli } from '../src/cli.js';
import { JSON_SCHEMA_URL } from '../src/report/json.js';
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
