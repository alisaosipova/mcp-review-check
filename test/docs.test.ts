// README and docs/RULES.md (W1-5): purpose and npx at the top, the rule table generated into docs/RULES.md, the token
// recipe that AUTH_NOTICE points to, the other user-facing sections, --help and README options in sync.
// Static imports exist on the baseline, so each check fails there on an assertion, not on import.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { AUTH_NOTICE } from '../src/report/constants.js';
import { CATALOG_DATE } from '../src/rules/index.js';

const path = (p: string) => new URL(`../${p}`, import.meta.url);
const README = readFileSync(path('README.md'), 'utf8');

/** The body of the README section whose `##`/`###` heading starts with `title` (case-insensitive), up to the next heading. */
function section(title: string): string | undefined {
  const parts = README.split(/^(?=#{2,3} )/m);
  return parts.find((p) => p.replace(/^#+ /, '').toLowerCase().startsWith(title.toLowerCase()));
}

/** `--option` names in a text. */
const optionNames = (s: string) => [...s.matchAll(/--[a-z][a-z-]*/g)].map((m) => m[0]);

describe('README and docs (W1-5)', () => {
  it('R-42: purpose and npx in README lines 1-5; docs/RULES.md equals the generator output', async () => {
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

  it('R-61: the example report header in README shows CATALOG_DATE', () => {
    const header = README.match(/^mcp-review-check \S+ · rules (\S+) · target: /m);
    expect(header, 'README has an example report header').not.toBeNull();
    expect(header![1]).toBe(CATALOG_DATE);
  });

  it('R-43: AUTH_NOTICE points to the README token recipe; README has token recipe, Privacy, FAQ, CI recipes (stdio and preview URL), docker-compose', () => {
    expect(AUTH_NOTICE).toMatch(/^Server requires OAuth\. Auth checks ran; tool, resource and UI checks need `--bearer <token>`/);
    expect(AUTH_NOTICE).toMatch(/"Token recipe" in the mcp-review-check README/);
    const recipe = section('Token recipe');
    expect(recipe, 'README section "Token recipe"').toBeDefined();
    expect(recipe).toContain('MCP_REVIEW_CHECK_TOKEN');
    expect(recipe).toMatch(/`resource`/);
    expect(section('Privacy'), 'README section "Privacy"').toMatch(/telemetry/i);
    expect(section('FAQ'), 'README section "FAQ"').toMatch(/\*\*.+\?\*\*/);
    const ci = section('CI recipes');
    expect(ci, 'README section "CI recipes"').toBeDefined();
    expect(ci).toMatch(/--stdio -- /);
    expect(ci).toMatch(/deployment_status[\s\S]*environment_url/);
    const compose = section('Docker Compose');
    expect(compose, 'README section "Docker Compose"').toBeDefined();
    expect(compose).toMatch(/^services:$/m);
    expect(compose).toContain('docker compose run');
  });

  it('R-44: a dated comparison with linked tools; no promise of a code scanning upload', () => {
    const cmp = section('Compared with other tools');
    expect(cmp, 'README section "Compared with other tools"').toBeDefined();
    expect(cmp).toMatch(/As of \d{4}-\d{2}-\d{2}/);
    const rows = cmp!.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Tool ') && !l.startsWith('| mcp-review-check '));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const row of rows) expect(row, row.slice(0, 40)).toMatch(/\]\(https:\/\/[^)]+\)/);
    expect(README).not.toMatch(/upload-sarif|codeql-action/);
  });

  it('R-45: every --help option is in README and vice versa', async () => {
    const help = (await runCli(['--help'], {}, false)).stdout;
    const block = (name: string) => help.match(new RegExp(`^${name}:\\n([\\s\\S]*?)\\n\\n`, 'm'))?.[1] ?? '';
    // Options: the first option on each line (`-h, --help` → --help); Usage: --stdio and anything else spelled there.
    const fromHelp = new Set([...block('Options').split('\n').flatMap((l) => optionNames(l.match(/^\s+(?:-\w, )?(--[a-z][a-z-]*)/)?.[1] ?? '')),
      ...optionNames(block('Usage'))]);
    const table = section('Options')?.split('\n').filter((l) => l.startsWith('| `')) ?? [];
    const fromReadme = new Set(table.flatMap((l) => optionNames(l.split('|')[1])));
    expect(fromHelp.size).toBeGreaterThan(10);
    expect([...fromReadme].sort()).toEqual([...fromHelp].sort());
  });
});

describe('README: the stdio server environment (R-15)', () => {
  it('X-mac-7: README names the variables a stdio server inherits and says to pass the rest with --env', () => {
    expect(README).toMatch(/HOME, LOGNAME, PATH, SHELL, TERM, USER/);
    expect(README).toMatch(/APPDATA, .*USERPROFILE/);
    expect(README).toMatch(/TMPDIR[^\n]*--env|--env[^\n]*TMPDIR/);
  });
});
