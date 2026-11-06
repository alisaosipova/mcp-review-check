// README and docs/RULES.md: purpose and npx at the top, the rule table generated into docs/RULES.md, the token
// recipe that AUTH_NOTICE points to, the other user-facing sections, --help and README options in sync.
// Static imports exist on the baseline, so each check fails there on an assertion, not on import.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { AUTH_NOTICE } from '../src/report/constants.js';
import { CATALOG_DATE } from '../src/rules/index.js';

const path = (p: string) => new URL(`../${p}`, import.meta.url);
const README = readFileSync(path('README.md'), 'utf8');
// The detailed reference moved to docs/guide/ (0.5.0); the README keeps the overview, quick start and links.
const guide = (name: string) => readFileSync(path(`docs/guide/${name}.md`), 'utf8');
const GUIDE = { options: guide('options-and-config'), ci: guide('ci'), privacy: guide('privacy-and-requests'), auth: guide('auth') };

/** The body of the README section whose `##`/`###` heading starts with `title` (case-insensitive), up to the next heading. */
function section(title: string, text = README): string | undefined {
  const parts = text.split(/^(?=#{2,3} )/m);
  return parts.find((p) => p.replace(/^#+ /, '').toLowerCase().startsWith(title.toLowerCase()));
}

/** `--option` names in a text. */
const optionNames = (s: string) => [...s.matchAll(/--[a-z][a-z-]*/g)].map((m) => m[0]);

describe('README and docs', () => {
  it('purpose and npx in README lines 1-5; docs/RULES.md equals the generator output', async () => {
    const top = README.split('\n').slice(0, 5).join('\n');
    expect(top).toMatch(/Lint an MCP server against the public review criteria/);
    expect(top).toMatch(/`npx mcp-review-check https?:\/\/\S+`/);
    expect(existsSync(path('docs/RULES.md')), 'docs/RULES.md exists').toBe(true);
    const block = readFileSync(path('docs/RULES.md'), 'utf8').match(/<!-- RULES:START -->\n([\s\S]*)\n<!-- RULES:END -->/);
    expect(block, 'docs/RULES.md has the RULES markers').not.toBeNull();
    const { rulesMarkdown } = await import('../src/explain.js'); // the generator behind npm run readme:rules
    expect(block![1]).toBe(rulesMarkdown());
    // The table lives in docs/RULES.md only; the README links to it.
    expect(README).not.toContain('<!-- RULES:START -->');
    expect(section('Rules')).toContain('(docs/RULES.md)');
  });

  it('the example report header in README shows CATALOG_DATE', () => {
    const header = README.match(/^mcp-review-check \S+ · rules (\S+) · target: /m);
    expect(header, 'README has an example report header').not.toBeNull();
    expect(header![1]).toBe(CATALOG_DATE);
  });

  it('AUTH_NOTICE points to the README token recipe; README has token recipe, Privacy, FAQ, CI recipes (stdio and preview URL), docker-compose', () => {
    expect(AUTH_NOTICE).toMatch(/^Server requires OAuth\. Auth checks ran; tool, resource and UI checks need `--bearer <token>`/);
    expect(AUTH_NOTICE).toMatch(/"Token recipe" in the mcp-review-check README/);
    const recipe = section('Token recipe');
    expect(recipe, 'README section "Token recipe"').toBeDefined();
    expect(recipe).toContain('MCP_REVIEW_CHECK_TOKEN');
    expect(recipe).toMatch(/`resource`/);
    expect(section('Privacy', GUIDE.privacy), 'guide section "Privacy"').toMatch(/telemetry/i);
    expect(section('FAQ'), 'README section "FAQ"').toMatch(/\*\*.+\?\*\*/);
    const ci = section('CI recipes', GUIDE.ci);
    expect(ci, 'README section "CI recipes"').toBeDefined();
    expect(ci).toMatch(/--stdio -- /);
    expect(ci).toMatch(/deployment_status[\s\S]*environment_url/);
    const compose = section('Docker Compose', GUIDE.ci);
    expect(compose, 'README section "Docker Compose"').toBeDefined();
    expect(compose).toMatch(/^services:$/m);
    expect(compose).toContain('docker compose run');
  });

  it('a dated comparison with linked tools; no promise of a code scanning upload', () => {
    const cmp = section('Compared with other tools');
    expect(cmp, 'README section "Compared with other tools"').toBeDefined();
    expect(cmp).toMatch(/As of \d{4}-\d{2}-\d{2}/);
    const rows = cmp!.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Tool ') && !l.startsWith('| mcp-review-check '));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) expect(row, row.slice(0, 40)).toMatch(/\]\(https:\/\/[^)]+\)/);
    // The CLI never uploads SARIF; only the GitHub Action documented under "CI recipes" (action.yml, 0.2.0) does.
    expect(README.replace(section('CI recipes', GUIDE.ci) ?? '', '')).not.toMatch(/upload-sarif|codeql-action/);
  });

  it('every --help option is in README and vice versa', async () => {
    const help = (await runCli(['--help'], {}, false)).stdout;
    const block = (name: string) => help.match(new RegExp(`^${name}:\\n([\\s\\S]*?)\\n\\n`, 'm'))?.[1] ?? '';
    // Options: the first option on each line (`-h, --help` → --help); Usage: --stdio and anything else spelled there.
    const fromHelp = new Set([...block('Options').split('\n').flatMap((l) => optionNames(l.match(/^\s+(?:-\w, )?(--[a-z][a-z-]*)/)?.[1] ?? '')),
      ...optionNames(block('Usage'))]);
    const table = section('Options', GUIDE.options)?.split('\n').filter((l) => l.startsWith('| `')) ?? [];
    const fromReadme = new Set(table.flatMap((l) => optionNames(l.split('|')[1])));
    expect(fromHelp.size).toBeGreaterThan(10);
    expect([...fromReadme].sort()).toEqual([...fromHelp].sort());
  });
});

describe('README: the stdio server environment', () => {
  it('README names the variables a stdio server inherits and says to pass the rest with --env', () => {
    expect(GUIDE.options).toMatch(/HOME, LOGNAME, PATH, SHELL, TERM, USER/);
    expect(GUIDE.options).toMatch(/APPDATA, .*USERPROFILE/);
    expect(GUIDE.options).toMatch(/TMPDIR[^\n]*--env|--env[^\n]*TMPDIR/);
  });
});

// Review round 4, P9: docs that contradicted action.yml or the CLI, and release wording left from 0.x.
describe('docs match action.yml and the CLI (review round 4, P9)', () => {
  const SPEC = readFileSync(path('docs/design/spec.md'), 'utf8');
  const SECURITY = readFileSync(path('SECURITY.md'), 'utf8');

  it('A12-06: the Action input table in docs/guide/ci.md is the one generated from action.yml', async () => {
    const { actionInputs, actionInputsTable, START, END } = await import('../scripts/action-inputs.mjs');
    const block = GUIDE.ci.split(START)[1]?.split(END)[0];
    expect(block, 'docs/guide/ci.md has the ACTION-INPUTS markers').toBeDefined();
    expect(block!.trim()).toBe(actionInputsTable());
    // Every input, and the version default of action.yml (the guide said 1.0 while action.yml said 1.1).
    const inputs = actionInputs();
    expect(inputs.map((i) => i.name)).toEqual(expect.arrayContaining(['target', 'stdio', 'version', 'extra-args', 'cli-path']));
    const version = inputs.find((i) => i.name === 'version')!.default;
    expect(block).toContain(`| \`version\` | \`${version}\` |`);
  });

  it('A08-05, I-A08-6: no 0.x or v0 release wording outside the CHANGELOG; the no-moving-ref and 1.x support policy are stated', () => {
    const files: Record<string, string> = { 'README.md': README, 'SECURITY.md': SECURITY };
    for (const [name, text] of Object.entries(GUIDE)) files[`docs/guide/${name}.md`] = text;
    const stale = Object.entries(files).flatMap(([name, text]) => text.split('\n').map((l, i) => [name, i + 1, l] as const)
      .filter(([, , l]) => /\b0\.x\b|`v0`|@v0\b|\bv0 ref/.test(l)).map(([n, i, l]) => `${n}:${i}: ${l.slice(0, 80)}`));
    expect(stale).toEqual([]);
    expect(README).toMatch(/There is no moving `v1` ref[^\n]*pin a full release tag[^\n]*or a commit SHA/i);
    expect(SECURITY).toMatch(/Only the latest published 1\.x minor receives security fixes, and a fix ships as a patch of that minor/);
  });

  it('A12-07: the GitLab recipe fails on drift only in merge requests and has a manual refresh job', () => {
    const gitlab = section('GitLab CI', GUIDE.ci)!;
    expect(gitlab).toMatch(/drift=""; \[ "\$CI_PIPELINE_SOURCE" = merge_request_event \] && drift="--fail-on-drift"/);
    // --fail-on-drift appears only through that variable.
    expect(gitlab.match(/--fail-on-drift/g)).toHaveLength(1);
    expect(gitlab).toMatch(/^mcp-review-check-refresh:$/m);
    const refresh = gitlab.slice(gitlab.indexOf('mcp-review-check-refresh:'));
    expect(refresh).toMatch(/--fail-on never --save-baseline \.mcp-review-check\/baseline\.json/);
    expect(refresh).toMatch(/when: manual/);
    expect(refresh).toMatch(/policy: push/);
    // A12-04: the CLI creates the folder, so the recipe has no mkdir before --save-baseline any more.
    expect(gitlab).not.toMatch(/^\s+mkdir -p \.mcp-review-check$/m);
  });

  it('A12-06, A01-02, A01-04 handoffs: listing-only, both drift advices, junit banner, preflight and baseline wording', () => {
    for (const opt of ['--plugin-dir', '--openai-manifest']) {
      const row = GUIDE.options.split('\n').find((l) => l.startsWith(`| \`${opt} `))!;
      expect(row, opt).toMatch(/alone it runs listing-only/);
      expect(row, opt).not.toMatch(/needs a `<url>` or `--stdio` target/);
    }
    expect(SPEC).not.toContain('listing-only run is not implemented');
    const drift = GUIDE.options.split('\n').find((l) => l.startsWith('| `--fail-on-drift` '))!;
    expect(drift).toContain('re-save the baseline with --save-baseline');
    expect(drift).toContain('fix this run (see the coverage line) before saving a baseline from it');
    expect(GUIDE.options).toContain('(on stderr for `json`, `sarif` and `junit`)');
    expect(GUIDE.options).toMatch(/in the preflight except after a timeout/);
    expect(GUIDE.options).not.toMatch(/retried \(at most 3 attempts, a timeout only once\) in the preflight,/);
    expect(GUIDE.ci).toMatch(/`--save-baseline` is not written[^\n]*the earlier baseline is kept/);
    expect(GUIDE.ci).toMatch(/A missing `\.mcp-review-check\/` folder is created \(since 1\.2\.0[^\n]*no longer needed\)/);
  });

  it('A08-01: the pre-commit section describes the npx hook, not a packed build', () => {
    const pc = section('pre-commit', GUIDE.ci)!;
    expect(pc).not.toMatch(/by packing the cloned repository/);
    expect(pc).toMatch(/npx --yes mcp-review-check@<MAJOR\.MINOR>/);
    expect(pc).toMatch(/rev: v1\.2\.0/);
  });
});
