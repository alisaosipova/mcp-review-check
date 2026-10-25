// SARIF that code-scanning tools accept (black box: toSarif, buildReport and runCli exist in the baseline).
// artifactLocation.uri is a relative path (default .mcp-review-check, --sarif-location); the target URL or
// command moves to run.properties and is redacted (a report channel: every secret source is checked there).
// partialFingerprints, automationDetails.id, informationUri = repository URL, valid against SARIF 2.1.0.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import _Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { buildReport } from '../src/report/index.js';
import { toSarif } from '../src/report/sarif.js';
import { runRules } from '../src/rules/engine.js';
import { manualChecklist, RULES } from '../src/rules/index.js';
import type { Snapshot } from '../src/snapshot.js';
import { BAD } from './cli-runner.js';
import { loadSnapshot } from './helpers.js';

const SECRET = 'SARIFSECRET7f3a91';
const STDIO = `${BAD} --api-key ${SECRET}`;
const HTTP_URL = `https://user:pw-${SECRET}@mcp.acme.test/mcp?api_key=${SECRET}&x=1`;
const REDACTED = /«redacted»|%C2%ABredacted%C2%BB/;

/** The repository URL the package declares (git+https://host/owner/repo.git -> https://host/owner/repo). */
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const REPO_URL = String(pkg.repository?.url ?? pkg.repository ?? '').replace(/^git\+/, '').replace(/\.git$/, '');

function httpSarif(url = HTTP_URL): any {
  const s: Snapshot = loadSnapshot('minimal-http');
  s.target = { kind: 'http', urlAsEntered: url, url: new URL(url) };
  return toSarif(buildReport(s, runRules(s, RULES), manualChecklist(s), 'error', new Date('2026-10-22T10:00:00Z'), 1234));
}

async function stdioSarif(...extra: string[]): Promise<any> {
  const r = await runCli(['--stdio', STDIO, '--format', 'sarif', ...extra], {}, false);
  expect(r.code, r.stderr).toBe(1);
  return JSON.parse(r.stdout);
}

function uris(sarif: any): string[] {
  return sarif.runs[0].results.flatMap((x: any) => x.locations.map((l: any) => l.physicalLocation.artifactLocation.uri));
}

/** A secret and the first and last 7 characters of its distinctive part: no cut of it may be left either. */
const fragments = (secret: string) => {
  const core = secret.replace(/^(sk-live-|pw-)/, '');
  return [secret, core.slice(0, 7), core.slice(-7)];
};

function schemaValidator(): any {
  const schema = JSON.parse(readFileSync(new URL('./fixtures/sarif-schema-2.1.0.json', import.meta.url), 'utf8'));
  delete schema.$schema;
  schema.$id = schema.id;
  delete schema.id;
  const Ajv = ((_Ajv as unknown as { default?: unknown }).default ?? _Ajv) as new (o: object) => any;
  const ajv = new Ajv({ strict: false, allErrors: true });
  ajv.addFormat('uri', (x: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|\\^`]*$/i.test(x) && !/[^\x21-\x7e]/.test(x));
  ajv.addFormat('uri-reference', (x: string) => !/[^\x21-\x7e]/.test(x) && !/[<>"{}|\\^`]/.test(x));
  ajv.addFormat('date-time', (x: string) => !Number.isNaN(Date.parse(x)));
  return ajv.compile(schema);
}

describe('SARIF for code scanning', () => {
  it('artifactLocation.uri is relative (default .mcp-review-check, --sarif-location); target URL and command are in run.properties, redacted', async () => {
    // HTTP: the URL is not the artifact; it is a run property with its credentials redacted.
    const http = httpSarif();
    expect(http.runs[0].results.length).toBeGreaterThan(0);
    expect(new Set(uris(http))).toEqual(new Set(['.mcp-review-check']));
    const httpProps = JSON.stringify(http.runs[0].properties ?? {});
    expect(httpProps).toContain('mcp.acme.test/mcp');
    expect(httpProps).not.toContain(SECRET);
    expect(JSON.stringify(http)).not.toContain(SECRET);

    // stdio: the command line is not the artifact; it is a run property with the --api-key value redacted.
    const stdio = await stdioSarif();
    expect(stdio.runs[0].results.length).toBeGreaterThan(0);
    expect(new Set(uris(stdio))).toEqual(new Set(['.mcp-review-check']));
    const stdioProps = JSON.stringify(stdio.runs[0].properties ?? {});
    expect(stdioProps).toContain('bad-server.mjs');
    expect(stdioProps).toContain('--api-key');
    expect(stdioProps).toContain('redacted');
    expect(JSON.stringify(stdio)).not.toContain(SECRET);

    // --sarif-location sets the path the results point at.
    const placed = await stdioSarif('--sarif-location', 'services/notes/mcp');
    expect(new Set(uris(placed))).toEqual(new Set(['services/notes/mcp']));

    // Only a relative path without a scheme and without "..": anything else is a usage error that does not echo it.
    for (const bad of ['/etc/mcp', 'https://mcp.acme.test/mcp', '../outside', 'a/../../b', 'C:\\repo\\mcp', '\\\\host\\share', 'file:notes', '']) {
      const r = await runCli(['--stdio', STDIO, '--format', 'sarif', '--sarif-location', bad], {}, false);
      expect(r.code, bad).toBe(2);
      expect(r.stdout, bad).toBe('');
      expect(r.stderr, bad).toMatch(/--sarif-location/);
      if (bad) expect(r.stderr, bad).not.toContain(bad);
    }
  });

  it('run.properties carries the target with every secret source redacted: --bearer, --header, --env, ?token=, ?client_secret=, user:pass@, --api-key X, --authtoken X, --token=X', async () => {
    const BEARER = 'sk-live-PROPBEARER41';
    const HEADER = 'sk-live-PROPHEADER42';
    const TOKEN = 'sk-live-PROPQTOKEN43';
    const CLIENT = 'sk-live-PROPCLIENT44';
    const PASS = 'pw-PROPPASSWD45';
    // The --bearer and --header values also sit in the path, so the target label carries every HTTP source;
    // nothing listens on port 1 (exit 3), and the report, its SARIF run properties included, is still written.
    const url = `http://user:${PASS}@127.0.0.1:1/mcp/${BEARER}/${HEADER}?token=${TOKEN}&client_secret=${CLIENT}&x=1`;
    const http = await runCli([url, '--bearer', BEARER, '--header', `X-Api-Key: ${HEADER}`, '--format', 'sarif', '--timeout', '5000'], {}, false);
    expect(http.code, http.stderr).toBe(3);
    const httpSarifDoc = JSON.parse(http.stdout);
    const httpProps = JSON.stringify(httpSarifDoc.runs[0].properties ?? {});
    expect(httpProps).toContain('127.0.0.1:1/mcp');
    expect(httpProps).toMatch(REDACTED);
    for (const s of [BEARER, HEADER, TOKEN, CLIENT, PASS].flatMap(fragments)) {
      expect(httpProps, `run.properties leaks ${s}`).not.toContain(s);
      expect(http.stdout + http.stderr, `SARIF leaks ${s}`).not.toContain(s);
    }

    const ENV = 'sk-live-PROPENVVAL46';
    const APIKEY = 'sk-live-PROPAPIKEY47';
    const AUTHTOKEN = 'sk-live-PROPAUTHTK48';
    const EQ = 'sk-live-PROPEQTOKN49';
    // The --env value is also an argument, so the command line carries it.
    const stdio = await runCli(['--env', `API_TOKEN=${ENV}`, '--format', 'sarif', '--stdio', '--', 'node', fileURLToPath(new URL('./fixtures/bad-server.mjs', import.meta.url)),
      '--api-key', APIKEY, '--authtoken', AUTHTOKEN, `--token=${EQ}`, ENV], {}, false);
    expect(stdio.code, stdio.stderr).toBe(1);
    const stdioProps = JSON.stringify(JSON.parse(stdio.stdout).runs[0].properties ?? {});
    expect(stdioProps).toContain('bad-server.mjs');
    for (const flag of ['--api-key', '--authtoken', '--token=']) expect(stdioProps).toContain(flag);
    expect(stdioProps).toMatch(REDACTED);
    for (const s of [ENV, APIKEY, AUTHTOKEN, EQ].flatMap(fragments)) {
      expect(stdioProps, `run.properties leaks ${s}`).not.toContain(s);
      expect(stdio.stdout + stdio.stderr, `SARIF leaks ${s}`).not.toContain(s);
    }
  });

  it('partialFingerprints on every result, automationDetails.id, informationUri = repository URL; valid against sarif-schema-2.1.0.json (ajv)', async () => {
    const validate = schemaValidator();
    const runs: [string, any, any][] = [['http', httpSarif(), httpSarif()], ['stdio', await stdioSarif(), await stdioSarif()]];
    for (const [kind, sarif, again] of runs) {
      const run = sarif.runs[0];
      expect(run.results.length, kind).toBeGreaterThan(0);
      const prints: string[] = [];
      for (const res of run.results) {
        const fp = res.partialFingerprints ?? {};
        const values = Object.values(fp) as string[];
        expect(values.length, `${kind} ${res.ruleId}`).toBeGreaterThan(0);
        for (const v of values) expect(v, `${kind} ${res.ruleId}`).toMatch(/^[0-9a-f]{64}$/);
        prints.push(JSON.stringify(fp));
      }
      // The same server gives the same fingerprints on the next run (alerts are matched, not duplicated) ...
      expect(again.runs[0].results.map((x: any) => JSON.stringify(x.partialFingerprints)), kind).toEqual(prints);
      // ... and one fingerprint never stands for two findings of a run.
      expect(new Set(prints).size, kind).toBe(prints.length);
      expect(run.automationDetails?.id, kind).toMatch(/^mcp-review-check\/.+/);
      expect(run.tool.driver.informationUri, kind).toMatch(/^https:\/\/\S+$/);
      expect(run.tool.driver.informationUri, kind).toBe(REPO_URL);
      const ok = validate(sarif);
      expect(validate.errors ?? [], `${kind} ${JSON.stringify(validate.errors?.slice(0, 3))}`).toEqual([]);
      expect(ok, kind).toBe(true);
    }
    // The fingerprint follows the finding (rule, subject, path), not the target the run was pointed at.
    const prints = (s: any) => s.runs[0].results.map((x: any) => x.partialFingerprints);
    expect(prints(httpSarif('https://other.acme.test/mcp'))).toEqual(prints(httpSarif('https://mcp.acme.test/mcp')));
  });
});
