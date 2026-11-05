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

describe('Q3 note 5:the CI pack smoke checks where npm-shrinkwrap.json is', () => {
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
