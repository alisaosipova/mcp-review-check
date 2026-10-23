// Release lifecycle: single-source version and catalog date, JSON schema version.
// Imports only modules that exist on the baseline, so R-61 and R-63 fail on an assertion there, not on import.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { initializeBody } from '../src/probe/network.js';
import { CLIENT_INFO } from '../src/protocol/modern.js';
import { DISCLAIMER } from '../src/report/constants.js';
import { buildReport } from '../src/report/index.js';
import { toJson } from '../src/report/json.js';
import { CATALOG_DATE, manualChecklist, RULES, runRules } from '../src/rules/index.js';
import { VERSION } from '../src/version.js';
import { loadSnapshot } from './helpers.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** Every .ts file under src/, relative to src/. */
function sourceFiles(dir = SRC, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name), `${prefix}${e.name}/`) : e.name.endsWith('.ts') ? [`${prefix}${e.name}`] : []);
}

describe('version', () => {
  it('comes from package.json everywhere it is sent', () => {
    expect(VERSION).toBe(pkg.version);
    expect(CLIENT_INFO.version).toBe(VERSION);
    expect(initializeBody().params.clientInfo.version).toBe(VERSION);
  });

  it('R-2: no version literal in src/', () => {
    const literal = new RegExp(`(['"\`])${pkg.version.replace(/\./g, '\\.')}\\1`);
    const files = sourceFiles();
    expect(files).toContain('version.ts');
    expect(files.filter((f) => literal.test(readFileSync(join(SRC, f), 'utf8')))).toEqual([]);
  });
});

describe('catalog date', () => {
  it('R-61: CATALOG_DATE is one value shared by the rules index, DISCLAIMER and README', () => {
    expect(CATALOG_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The date is written once in src/; everything else (rules index, DISCLAIMER, header, JSON) reads it.
    const hits = sourceFiles().flatMap((f) => (readFileSync(join(SRC, f), 'utf8').match(new RegExp(CATALOG_DATE, 'g')) ?? []).map(() => f));
    expect(hits, `files spelling out ${CATALOG_DATE}`).toHaveLength(1);
    expect(DISCLAIMER).toContain(`as of ${CATALOG_DATE}.`);
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    const marked = [...readme.matchAll(/<!-- CATALOG_DATE -->([^<]*)<!-- \/CATALOG_DATE -->/g)].map((m) => m[1]);
    expect(marked.length, 'README has CATALOG_DATE markers (npm run readme:rules fills them)').toBeGreaterThan(0);
    for (const d of marked) expect(d).toBe(CATALOG_DATE);
  });

  it('R-63: the JSON report carries schemaVersion first and tool.catalogAgeDays', () => {
    const s = loadSnapshot('minimal-http');
    const at = new Date(Date.parse(`${CATALOG_DATE}T12:00:00Z`) + 45 * 86_400_000);
    const j = toJson(buildReport(s, runRules(s, RULES), manualChecklist(s), 'error', at, 1)) as Record<string, any>;
    expect(Object.keys(j)[0]).toBe('schemaVersion');
    expect(j.schemaVersion).toBe(1);
    expect(j.tool).toEqual({ name: 'mcp-review-check', version: VERSION, catalogDate: CATALOG_DATE, catalogAgeDays: 45 });
    // A run dated before the catalog (clock skew) is age 0, never negative.
    const early = toJson(buildReport(s, runRules(s, RULES), [], 'error', new Date(`${CATALOG_DATE.slice(0, 4)}-01-01T00:00:00Z`), 1)) as Record<string, any>;
    expect(early.tool.catalogAgeDays).toBe(0);
  });
});
