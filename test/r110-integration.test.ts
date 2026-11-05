// 1.1.0 integration: the integrator notes and open low findings of the Q3, Q4 and Q5 packages that only docs,
// workflows or the wiring between modules can show.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const flat = (p: string) => read(p).replace(/\s+/g, ' ');

describe('Q3 note 4: the pinning advice mentions the shrinkwrap', () => {
  it.each(['README.md', 'docs/guide/ci.md'])('%s says the package fixes its tree but the version input still floats', (file) => {
    const text = flat(file);
    expect(text).toMatch(/pin a full (release )?tag.{0,30}? or a commit SHA\. .{0,40}?npm-shrinkwrap\.json/i);
    expect(text).toMatch(/npm-shrinkwrap\.json.{0,120}?`version` input.{0,60}?patch/i);
  });
});

describe('Q4 lows: CONTRIBUTING release steps and the guard comment', () => {
  const steps = flat('CONTRIBUTING.md');
  it('the release steps say to tag the head of a green push to main, enforced by the guard', () => {
    expect(steps).toMatch(/tag only (a|the) commit that is the head of a green push to `?main`?/i);
    expect(steps).toMatch(/release guard.{0,80}?fails the release/i);
  });
  it('the release steps name the provenance content check', () => {
    expect(steps).toContain('scripts/verify-provenance.mjs');
    expect(steps).toMatch(/provenance[^.]*names? this repository, `release\.yml`, the tag(ged)? commit, the run and the tarball/i);
  });
  it('the release steps say docker.yml runs after a successful Release run', () => {
    expect(steps).toMatch(/docker\.yml[^.]*after a successful Release run/i);
  });
  it("the guard comment says the tag's own release.yml runs, so the guard stops mistakes, not a hostile tag", () => {
    const yml = read('.github/workflows/release.yml');
    const comment = yml.slice(0, yml.indexOf('\n  guard:')).split('\n').filter((l) => /^\s*#/.test(l)).join(' ');
    expect(comment).not.toMatch(/Nothing is built or published from a commit that skipped review/);
    expect(comment).toMatch(/release\.yml and scripts\/release-guard\.mjs of the tagged commit/);
  });
});

describe('Q5 notes and lows: docs of authProbe.active.clientId and of the stall retry', () => {
  it('the --active-auth row names authProbe.active.clientId', () => {
    const row = read('docs/guide/options-and-config.md').split('\n').find((l) => l.startsWith('| `--active-auth` |'));
    expect(row).toContain('authProbe.active.clientId');
  });
  it('SECURITY.md says the JSON report holds the registered client_id', () => {
    expect(flat('SECURITY.md')).toMatch(/JSON report[^.]*`authProbe\.active\.clientId`/);
  });
  it('privacy-and-requests.md says a timed-out probe is not retried after a stall', () => {
    expect(flat('docs/guide/privacy-and-requests.md')).toMatch(/stopped answering[^.]*timed-out (Origin or challenge )?probe is not retried/i);
  });
});

describe('Q3 note 5: the CI pack smoke checks where npm-shrinkwrap.json is', () => {
  const ci = read('.github/workflows/ci.yml');
  const step = ci.slice(ci.indexOf('- name: Pack, install the tarball and run it'));
  const run = step.slice(0, step.indexOf('\n\n'));
  it('the tarball holds package/npm-shrinkwrap.json and the checkout has none after the pack', () => {
    const pack = run.indexOf('npm pack');
    expect(pack).toBeGreaterThan(0);
    // No grep -q: under pipefail, grep leaving early could fail tar with SIGPIPE.
    const listed = run.search(/tar -tzf "\$RUNNER_TEMP"\/mcp-review-check-\*\.tgz \| grep -x package\/npm-shrinkwrap\.json > \/dev\/null/);
    const absent = run.search(/test ! -e "?\$GITHUB_WORKSPACE\/npm-shrinkwrap\.json"?/);
    expect(listed).toBeGreaterThan(pack);
    expect(absent).toBeGreaterThan(pack);
  });
});

describe('CHANGELOG: the 1.1.0 section', () => {
  const log = read('CHANGELOG.md');
  it('[Unreleased] stays on top with "Nothing yet.", followed by [1.1.0] - 2026-11-04', () => {
    expect(log).toMatch(/## \[Unreleased\]\n\nNothing yet\.\n\n## \[1\.1\.0\] - 2026-11-04\n/);
  });
  it('the section has the rule catalog date, the rule count and the headings in order', () => {
    const section = log.slice(log.indexOf('## [1.1.0]'), log.indexOf('## [1.0.1]'));
    expect(section).toMatch(/^## \[1\.1\.0\] - 2026-11-04\n\nRule catalog dated 2026-11-02\. 180 rules/);
    const order = ['Rules added', 'Severity raised', 'Added', 'Changed', 'Fixed', 'Security', 'Docs'].map((h) => section.indexOf(`\n### ${h}\n`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const id of ['TOOL-036', 'INJ-001', 'INJ-002', 'APPS-006', 'APPS-007', 'LST-008', 'LST-009', 'authProbe.active.clientId']) expect(section, id).toContain(id);
  });
  it('the compare links name v1.1.0', () => {
    const repo = 'https://github.com/alisaosipova/mcp-review-check/compare';
    expect(log).toContain(`[Unreleased]: ${repo}/v1.1.0...HEAD\n[1.1.0]: ${repo}/v1.0.1...v1.1.0\n[1.0.1]:`);
  });
  it('the package version is the released 1.1.0', () => {
    expect(JSON.parse(read('package.json')).version).toBe('1.1.0');
  });
});

describe('docs/design/spec.md: the 1.1.0 paragraphs of the Q reports', () => {
  const spec = read('docs/design/spec.md');
  it.each([
    ['§1.5 corpus scope and scanForm', /Regex scans run on `scanForm\(text\)` \(1\.1\.0\)/],
    ['§1.5 extractOrigins', /`navigator\.sendBeacon\(`/],
    ['§1.5 enumValues open', /With `\{open: true\}` \(1\.1\.0\)/],
    ['§2.1 SRV-015 tasks extension', /`io\.modelcontextprotocol\/tasks` in `capabilities\.extensions`/],
    ['§2.2 SPEC-013 integer ttlMs', /`ttlMs` is a number ≥ 0 but not an integer → warning/],
    ['§2.3 TOOL-036', /\*\*TOOL-036 Every \$ref resolves inside the schema\.\*\* Severity: spec=warning/],
    ['§2.4 INJ-001 variation selectors', /A run of two or more variation selectors/],
    ['§2.4 INJ-002 fullwidth', /fullwidth Latin \(U\+FF21–FF5A\)/],
    ['§2.7 APPS-006 port', /a port or path does not narrow it/],
    ['§2.13 LST-008 forms', /`npm exec`\/`npm x`, `pnpx`, `bun x` and `uv tool run`/],
    ['§2.13 LST-009 pyproject', /`pyproject\.toml` \(`\[\[tool\.uv\.index\]\]`/],
    ['§2.13 SVG root element', /an SVG is recognised only by its root element/],
    ['§3.1 --max-duration rules', /`RULES_GRACE_MS` \(1000 ms\)/],
    ['§3.2 --fail-on-incomplete in buildReport', /since 1\.1\.0 `buildReport` applies it/],
    ['§3.7 config precedence', /`OPPOSITES` in cli\.ts/],
    ['§4.3 session end on a stop', /Session end on a stop \(1\.1\.0\)/],
    ['§4.3 no timeout retry after a stall', /a timed-out HTTP wire probe \(the Origin probes and the domain challenge\) is not retried/],
    ['§4.4 shrinkwrap', /the tarball carries `npm-shrinkwrap\.json`/],
    ['§4.4 lazy startup', /`loadCheckModules`/],
    ['§5.3 authProbe.active.clientId', /`authProbe\.active\.clientId` is the `client_id`/],
  ])('%s', (_name, re) => { expect(spec).toMatch(re); });
});
