import { readFileSync } from 'node:fs';
import _Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { runRules } from '../src/rules/engine.js';
import { manualChecklist, RULES } from '../src/rules/index.js';
import type { Finding } from '../src/rules/types.js';
import { buildReport, resultLine } from '../src/report/index.js';
import { contactUrl } from '../src/report/constants.js';
import { targetLabel } from '../src/report/index.js';
import { toJson } from '../src/report/json.js';
import { renderMarkdown } from '../src/report/markdown.js';
import { toSarif } from '../src/report/sarif.js';
import { failed, gate, gatedPlatforms, score, verdict } from '../src/report/score.js';
import { groupFindings, renderText } from '../src/report/text.js';
import type { Snapshot } from '../src/snapshot.js';
import { loadSnapshot } from './helpers.js';
import { VERSION } from '../src/version.js';

const f = (ruleId: string, severity: Finding['severity'], over: Partial<Finding> = {}): Finding => ({
  ruleId, title: 't', severity, platforms: ['claude'], message: 'm', fix: 'fix', docs: ['https://x.test'], ...over,
});

function report(s: Snapshot) {
  return buildReport(s, runRules(s, RULES), manualChecklist(s), 'error', new Date('2026-10-22T10:00:00Z'), 1234);
}

describe('score and verdicts', () => {
  it('R-31: each broken rule counts once (scoreVersion 2), an error rule outranks its warnings', () => {
    const many = Array.from({ length: 10 }, () => f('TOOL-012', 'error'));
    expect(score(many)).toBe(100 - 12);
    expect(score([f('A', 'warning'), f('A', 'error'), f('A', 'warning')])).toBe(88);
    expect(score([f('A', 'error'), f('B', 'warning'), f('C', 'info')])).toBe(84);
    expect(score(Array.from({ length: 20 }, (_, i) => f(`R-${i}`, 'error')))).toBe(0);
  });
  it('verdict per platform', () => {
    const list = [f('A', 'warning', { platforms: ['chatgpt'] }), f('B', 'error', { platforms: ['claude'] })];
    expect(verdict(list, 'claude').verdict).toBe('BLOCKED');
    expect(verdict(list, 'chatgpt').verdict).toBe('NEEDS ATTENTION');
    expect(verdict([], 'chatgpt').verdict).toBe('NO AUTOMATED BLOCKERS');
    // partial checks (auth-required, connect-failed) never read as a pass
    expect(verdict([], 'chatgpt', false).verdict).toBe('INCOMPLETE');
    expect(verdict([f('W', 'warning', { platforms: ['chatgpt'] })], 'chatgpt', false).verdict).toBe('INCOMPLETE');
    expect(verdict([f('E', 'error', { platforms: ['claude'] })], 'claude', false).verdict).toBe('BLOCKED');
  });
  it('verdict counts each platform at its own severity (spec error + chatgpt warning is not a ChatGPT blocker)', () => {
    const x = f('AUTH-016', 'error', { platforms: ['spec', 'chatgpt'], severityByPlatform: { spec: 'error', chatgpt: 'warning' } });
    expect(verdict([x], 'chatgpt')).toEqual({ verdict: 'NEEDS ATTENTION', errors: 0, warnings: 1 });
  });
  it('the engine records per-platform severities', () => {
    const s = loadSnapshot('minimal-http');
    s.authProbe = { trigger: 'preflight-401', prmAttempts: [], as: [], timings: {}, invalidToken: { label: 'x', method: 'POST', url: 'https://mcp.acme.test/mcp', requestHeaders: {}, durationMs: 1, status: 200 } };
    const a16 = runRules(s, RULES).findings.find((x) => x.ruleId === 'AUTH-016')!;
    expect(a16.severityByPlatform).toEqual({ chatgpt: 'warning', spec: 'error' });
    expect(a16.severity).toBe('error');
    expect(renderText({ ...report(s), findings: [a16] }, { color: false, verbose: false })).toContain('AUTH-016 [spec, chatgpt: warning]');
  });
  it('fail-on thresholds', () => {
    expect(failed([f('A', 'warning')], 'error')).toBe(false);
    expect(failed([f('A', 'warning')], 'warning')).toBe(true);
    expect(failed([f('A', 'error')], 'never')).toBe(false);
  });
});

describe('exit gating (B5)', () => {
  // Hugging Face with --target claude: one spec-only error (SPEC-004) and Claude warnings.
  const specErr = f('SPEC-004', 'error', { platforms: ['spec'], severityByPlatform: { spec: 'error' } });
  const claudeWarn = f('INJ-006', 'warning', { platforms: ['claude'], severityByPlatform: { claude: 'warning' } });
  const mixed = f('AUTH-016', 'error', { platforms: ['spec', 'chatgpt'], severityByPlatform: { spec: 'error', chatgpt: 'warning' } });

  it('gated platforms follow --target; spec only with --fail-on-spec', () => {
    expect(gatedPlatforms('claude')).toEqual(['claude']);
    expect(gatedPlatforms('chatgpt')).toEqual(['chatgpt']);
    expect(gatedPlatforms('all')).toEqual(['claude', 'chatgpt']);
    expect(gatedPlatforms('all', true)).toEqual(['claude', 'chatgpt', 'spec']);
  });

  it('a spec-only error does not fail a Claude check, and the pass names it as not gated', () => {
    const g = gate([specErr, claudeWarn], 'error', ['claude']);
    expect(g).toEqual({ failed: false, platforms: ['claude'], reason: null, notGated: 'spec: 1 error (SPEC-004) not gated; add --fail-on-spec to fail on spec findings' });
    expect(gate([specErr, claudeWarn], 'error', ['claude', 'spec'])).toMatchObject({ failed: true, reason: 'spec: 1 error (SPEC-004)', notGated: null });
  });

  it('each platform counts at its own severity, and the reason lists counts and rule IDs', () => {
    // AUTH-016 is a spec error but only a ChatGPT warning
    expect(gate([mixed], 'error', ['chatgpt']).failed).toBe(false);
    expect(gate([mixed], 'warning', ['chatgpt'])).toMatchObject({ failed: true, reason: 'chatgpt: 1 warning (AUTH-016)' });
    const many = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => f(`R-${id}`, 'error', { platforms: ['claude', 'chatgpt'] }));
    expect(gate([...many, claudeWarn], 'warning', ['claude', 'chatgpt']).reason).toBe('claude: 6 errors, 1 warning (R-A, R-B, R-C, R-D, R-E, +2 more); chatgpt: 6 errors (R-A, R-B, R-C, R-D, R-E, +1 more)');
    expect(gate(many, 'never', ['claude'])).toMatchObject({ failed: false, reason: null, notGated: null });
  });

  it('the report and every format carry the gate: text, markdown and JSON', () => {
    const s = loadSnapshot('minimal-http');
    s.options.target = 'claude';
    const base = report(s);
    const r = { ...base, findings: [specErr, claudeWarn] };
    r.summary = { ...base.summary, failed: false, gate: { platforms: ['claude'], reason: null, notGated: gate(r.findings, 'error', ['claude']).notGated } };
    expect(resultLine(r)).toBe('PASS (--fail-on error) · spec: 1 error (SPEC-004) not gated; add --fail-on-spec to fail on spec findings');
    expect(renderText(r, { color: false, verbose: false })).toContain('Result: PASS (--fail-on error) · spec: 1 error (SPEC-004) not gated');
    expect(renderMarkdown(r)).toContain('| Result | PASS (--fail-on error) · spec: 1 error (SPEC-004) not gated; add --fail-on-spec to fail on spec findings |');
    // buildReport: minimal-http has a Claude error (TOOL-011 on delete_invoice), named in the reason
    const built = report(s);
    expect(built.summary.failed).toBe(true);
    expect(built.summary.gate.platforms).toEqual(['claude']);
    expect(built.summary.gate.reason).toMatch(/^claude: \d+ errors? \(.*TOOL-011/);
    expect(toJson(built).summary).toMatchObject({ failed: true, gate: { platforms: ['claude'], reason: expect.stringMatching(/TOOL-011/) } });
    const withSpec = buildReport(s, runRules(s, RULES), [], 'error', new Date('2026-10-22T10:00:00Z'), 1, true);
    expect(withSpec.summary.gate.platforms).toEqual(['claude', 'spec']);
    expect(resultLine(withSpec)).toMatch(/^FAIL \(--fail-on error, --fail-on-spec\) · claude: /);
  });

  it('R-12: a failed connect (exit 3) reads FAIL (could not connect) in text and markdown, never PASS', () => {
    // A connect failure is a spec-only SRV-003 error: the gate alone would call it a pass.
    const s = loadSnapshot('minimal-http');
    s.fatal = 'connect ECONNREFUSED 127.0.0.1:1';
    const srv003 = f('SRV-003', 'error', { platforms: ['spec'], severityByPlatform: { spec: 'error' } });
    const r = buildReport(s, { ...runRules(s, RULES), findings: [srv003] }, [], 'error', new Date('2026-10-22T10:00:00Z'), 1);
    expect(r.summary.failed).toBe(true); // exit 3 is failed in JSON (R-2, MRC-2)
    expect(resultLine(r)).toBe('FAIL (could not connect)');
    expect(renderText(r, { color: false, verbose: false })).toMatch(/Result: FAIL \(could not connect\)\n/);
    expect(renderMarkdown(r)).toContain('| Result | FAIL (could not connect) |');
  });
});

describe('review round 1 (R-11, R-17, D-4)', () => {
  it('D-4: buildReport scores every platform whatever --target (deepwiki-like: one score); ignored rules do not count', () => {
    const scoreFor = (target: 'all' | 'claude' | 'chatgpt', ignore: string[] = []) => {
      const s = loadSnapshot('deepwiki-like');
      s.options.target = target;
      return buildReport(s, runRules(s, RULES, { ignore }), [], 'error', new Date('2026-10-22T10:00:00Z'), 1).summary.score;
    };
    expect([scoreFor('claude'), scoreFor('chatgpt')]).toEqual([scoreFor('all'), scoreFor('all')]);
    expect(scoreFor('claude', ['TOOL-012'])).toBe(scoreFor('all', ['TOOL-012']));
    expect(scoreFor('all', ['TOOL-012'])).toBeGreaterThan(scoreFor('all')!);
  });

  it('R-11: on FAIL the Result line also names the not-gated spec findings; one a gated platform counted is not among them', () => {
    const specErr = f('SPEC-004', 'error', { platforms: ['spec'], severityByPlatform: { spec: 'error' } });
    const both = f('APPS-003', 'error', { platforms: ['claude', 'spec'], severityByPlatform: { claude: 'error', spec: 'error' } });
    const g = gate([specErr, both], 'error', ['claude']);
    expect(g).toMatchObject({ failed: true, reason: 'claude: 1 error (APPS-003)', notGated: 'spec: 1 error (SPEC-004) not gated; add --fail-on-spec to fail on spec findings' });
    const base = report(loadSnapshot('minimal-http'));
    const r = { ...base, findings: [specErr, both], summary: { ...base.summary, failed: true, gate: { platforms: g.platforms, reason: g.reason, notGated: g.notGated } } };
    expect(resultLine(r)).toBe('FAIL (--fail-on error) · claude: 1 error (APPS-003) · spec: 1 error (SPEC-004) not gated; add --fail-on-spec to fail on spec findings');
  });

  it('R-17: after a failed connect every verdict is INCOMPLETE, even with a directory error (SRV-001 http)', () => {
    const srv001 = f('SRV-001', 'error', { platforms: ['claude', 'chatgpt'], severityByPlatform: { claude: 'error', chatgpt: 'error' } });
    expect(verdict([srv001], 'claude', false, true).verdict).toBe('INCOMPLETE');
    expect(verdict([srv001], 'claude', false).verdict).toBe('BLOCKED');
    const s = loadSnapshot('minimal-http');
    s.fatal = 'getaddrinfo ENOTFOUND mcp.acme.test';
    s.coverage = { ...s.coverage, toolLevel: 'connect-failed', reason: 'hostname mcp.acme.test does not resolve (ENOTFOUND)' };
    const r = buildReport(s, { ...runRules(s, RULES), findings: [srv001] }, [], 'error', new Date('2026-10-22T10:00:00Z'), 1);
    expect(r.summary.verdicts).toMatchObject({ claude: { verdict: 'INCOMPLETE', errors: 1 }, chatgpt: { verdict: 'INCOMPLETE', errors: 1 } });
    expect(resultLine(r)).toBe('FAIL (could not connect)');
    expect(renderText(r, { color: false, verbose: false, quiet: true })).toContain('Result: FAIL (could not connect: hostname mcp.acme.test does not resolve (ENOTFOUND))');
  });
});

describe('review round 2 (R-60)', () => {
  it('S-26: a --max-duration stop after the handshake reads INCOMPLETE even with errors found before it', () => {
    const srv001 = f('SRV-001', 'error', { platforms: ['claude', 'chatgpt'], severityByPlatform: { claude: 'error', chatgpt: 'error' } });
    const s = loadSnapshot('minimal-http');
    s.coverage = { toolLevel: 'stopped', reason: 'stopped by --max-duration (4000 ms) during listing' };
    s.limits = { truncated: [], stopped: { maxDurationMs: 4000, phase: 'listing' } };
    const r = buildReport(s, { ...runRules(s, RULES), findings: [srv001] }, [], 'error', new Date('2026-10-22T10:00:00Z'), 1);
    expect(r.summary.verdicts).toMatchObject({ claude: { verdict: 'INCOMPLETE', errors: 1 }, chatgpt: { verdict: 'INCOMPLETE', errors: 1 } });
    // without the stop the same error blocks
    const done = loadSnapshot('minimal-http');
    expect(buildReport(done, { ...runRules(done, RULES), findings: [srv001] }, [], 'error', new Date('2026-10-22T10:00:00Z'), 1).summary.verdicts.claude?.verdict).toBe('BLOCKED');
  });
});

describe('text report', () => {
  it('collapses 2 or more findings of the same rule and message (R-28)', () => {
    const list = ['a', 'b', 'c', 'd', 'e'].map((t) => f('TOOL-012', 'error', { tool: t, message: 'missing openWorldHint' }));
    expect(groupFindings(list, false)).toHaveLength(1);
    expect(groupFindings(list, true)).toHaveLength(5);
    const text = renderText({ ...report(loadSnapshot('minimal-http')), findings: list }, { color: false, verbose: false });
    expect(text).toContain('TOOL-012 [claude] 5 tools: missing openWorldHint: a, b, c, +2 more');
    expect(groupFindings(list.slice(0, 2), false)).toHaveLength(1);
    expect(groupFindings([list[0]], false)).toHaveLength(1);
  });

  it('renders header, groups, checklist, verdicts, disclaimer and CTA without ANSI when color is off', () => {
    // The full checklist needs checklist: true (--checklist); by default it is one line (R-32, D-11 (b)).
    const text = renderText(report(loadSnapshot('minimal-http')), { color: false, verbose: false, checklist: true });
    expect(text.startsWith(`mcp-review-check ${VERSION} · rules 2026-10-22 · target: all`)).toBe(true);
    expect(text).toContain('Server  Acme Notes 1.4.2 · https://mcp.acme.test/mcp');
    expect(text).toMatch(/ERRORS \(\d+\)/);
    expect(text).toContain('  x TOOL-011 [claude] delete_invoice: neither readOnlyHint nor destructiveHint is set');
    expect(text).toContain('MANUAL CHECKLIST (not verified automatically)');
    expect(text).toMatch(/Claude: BLOCKED .* · ChatGPT: BLOCKED .* · Result: FAIL \(--fail-on error\)/);
    expect(text).toContain('not affiliated with Anthropic or OpenAI');
    expect(text).not.toContain('<CONTACT_URL>'); // no placeholder CTA while CONTACT_URL is unset
    expect(text).not.toMatch(/\x1b\[/);
  });

  it('prints the OAuth notice when coverage is auth-required', () => {
    const text = renderText(report(loadSnapshot('auth-required')), { color: false, verbose: false });
    expect(text).toContain('Server requires OAuth. Auth checks ran; tool, resource and UI checks need `--bearer <token>`');
  });
});

describe('other formats', () => {
  it('json has the documented shape and uncollapsed findings', () => {
    const j = toJson(report(loadSnapshot('minimal-http'))) as Record<string, any>;
    for (const k of ['schemaVersion', 'tool', 'target', 'startedAt', 'durationMs', 'server', 'coverage', 'summary', 'findings', 'skipped', 'ignored', 'manual', 'disclaimer', 'contact']) expect(j).toHaveProperty(k);
    expect(j.schemaVersion).toBe(1);
    expect(j.tool).toEqual({ name: 'mcp-review-check', version: VERSION, catalogDate: '2026-10-22', catalogAgeDays: 0 });
    expect(j.summary).toHaveProperty('verdicts.claude');
    expect(j.findings[0]).toHaveProperty('docs');
    expect(j.contact).toBeNull();
  });

  it('contactUrl accepts only absolute http(s) URLs', () => {
    expect(contactUrl('<CONTACT_URL>')).toBeUndefined();
    expect(contactUrl('')).toBeUndefined();
    expect(contactUrl('https://example.test/help')).toBe('https://example.test/help');
  });

  it('secrets in the entered URL are redacted in every format', () => {
    const s = loadSnapshot('minimal-http');
    const raw = 'https://user:pw@mcp.acme.test/mcp?api_key=SUPERSECRET123&x=1';
    s.target = { kind: 'http', urlAsEntered: raw, url: new URL(raw) };
    const r = report(s);
    expect(targetLabel(s)).toBe('https://mcp.acme.test/mcp?api_key=«redacted»&x=1');
    for (const out of [renderText(r, { color: false, verbose: false }), JSON.stringify(toJson(r)), JSON.stringify(toSarif(r)), renderMarkdown(r)]) {
      expect(out).not.toContain('SUPERSECRET123');
      expect(out).not.toContain('user:pw');
    }
  });

  it('sarif validates against the official SARIF 2.1.0 schema (http and stdio targets)', () => {
    const schema = JSON.parse(readFileSync(new URL('./fixtures/sarif-schema-2.1.0.json', import.meta.url), 'utf8'));
    delete schema.$schema;
    schema.$id = schema.id;
    delete schema.id;
    const Ajv = ((_Ajv as unknown as { default?: unknown }).default ?? _Ajv) as new (o: object) => any;
    const ajv = new Ajv({ strict: false, allErrors: true });
    ajv.addFormat('uri', (x: string) => /^[a-z][a-z0-9+.-]*:[^\s<>"{}|\\^`]*$/i.test(x) && !/[^\x21-\x7e]/.test(x));
    ajv.addFormat('uri-reference', (x: string) => !/[^\x21-\x7e]/.test(x) && !/[<>"{}|\\^`]/.test(x));
    ajv.addFormat('date-time', (x: string) => !Number.isNaN(Date.parse(x)));
    const validate = ajv.compile(schema);
    const stdio = loadSnapshot('minimal-http');
    stdio.target = { kind: 'stdio', command: 'node', args: ['/path with space/server.mjs'] };
    for (const s of [loadSnapshot('minimal-http'), stdio]) {
      const ok = validate(toSarif(report(s)));
      expect(validate.errors ?? [], JSON.stringify(validate.errors?.slice(0, 3))).toEqual([]);
      expect(ok).toBe(true);
    }
  });

  it('markdown escapes pipes and lists the checklist', () => {
    const r = report(loadSnapshot('minimal-http'));
    const md = renderMarkdown({ ...r, findings: [f('X-001', 'error', { message: 'a | b' })] });
    expect(md).toMatch(/^# Acme Notes 1\.4\.2/);
    expect(md).toContain('a \\| b');
    expect(md).toContain('| Rule | Platforms | Subject | Message | Fix | Docs |');
    expect(md).toMatch(/- \[ \] \*\*MAN-001\*\*/);
  });

  it('sarif is 2.1.0 with rules, levels and logical locations; no manual items', () => {
    const s = toSarif(report(loadSnapshot('minimal-http'))) as Record<string, any>;
    expect(s.version).toBe('2.1.0');
    const run = s.runs[0];
    expect(run.tool.driver.name).toBe('mcp-review-check');
    expect(run.tool.driver.rules.length).toBe(RULES.length);
    expect(run.tool.driver.rules[0]).toHaveProperty('helpUri');
    const levels = new Set(run.results.map((r: any) => r.level));
    for (const l of levels) expect(['error', 'warning', 'note']).toContain(l);
    const withTool = run.results.find((r: any) => r.ruleId === 'TOOL-011');
    expect(withTool.locations[0].logicalLocations).toEqual([{ name: 'delete_invoice', kind: 'function' }]);
    expect(withTool.locations[0].physicalLocation.artifactLocation.uri).toBe('.mcp-review-check');
    expect(run.results.some((r: any) => String(r.ruleId).startsWith('MAN-'))).toBe(false);
  });
});

describe('R-11: server text is not markdown', () => {
  it('R-11: server text in the heading, Subject, Message, coverage reason and limits renders no link, image, HTML or @mention', () => {
    const s = loadSnapshot('minimal-http');
    s.serverInfo = { name: 'Acme [x](https://e.test/home)', version: '1.0' };
    s.coverage = { toolLevel: 'list-failed', reason: 'tools/list failed: <b>boom</b> & [y](https://e.test/r)' };
    s.limits = { truncated: [{ where: 'tools[<i>wide</i>].description', length: 20000, cap: 16384 }] };
    const r = report(s);
    const md = renderMarkdown({ ...r, findings: [f('X-001', 'error', { tool: 'a <img src="https://e.test/p.png">', message: 'see [x](https://e.test/phish) @octocat' })] });
    expect(md).not.toContain('<img src=');
    expect(md).not.toMatch(/(?<!\\)\]\(https:\/\/e\.test/); // an escaped \] is text, not the end of a link
    expect(md).not.toContain('@octocat');
    expect(md).not.toContain('<b>');
    expect(md).not.toContain('<i>');
    // the text is still there, shown literally
    expect(md).toMatch(/^# Acme \\\[x\\\]\(https:\/\/e\.test\/home\) 1\.0$/m);
    expect(md).toContain('a &lt;img src="https://e.test/p.png"&gt;');
    expect(md).toContain('see \\[x\\](https://e.test/phish) @&#8203;octocat');
    expect(md).toContain('&lt;b&gt;boom&lt;/b&gt; &amp; \\[y\\]');
  });

  it('R-11: evidence and the rerun line stay one code span whatever backticks they hold, with the text as is inside', () => {
    const md = renderMarkdown({ ...report(loadSnapshot('minimal-http')), findings: [f('X-001', 'error', { evidence: 'Invalid Host `` <b>x</b> ``' }), f('X-002', 'error', { evidence: 'plain @x | y' })] }, { rerun: 'npx mcp-review-check --stdio "npx -y @scope/pkg ``x``"' });
    const cellOf = (id: string) => md.split('\n').find((l) => l.startsWith(`| ${id} `))!.split(' | ').at(-1)!.replace(/ \|$/, '');
    const ev = cellOf('X-001');
    const fence = /^`+/.exec(ev)![0];
    expect(fence.length).toBeGreaterThan(2);
    expect(ev).toBe(`${fence} Invalid Host \`\` <b>x</b> \`\` ${fence}`);
    expect(cellOf('X-002')).toBe('`` plain @x \\| y ``');
    const rerun = md.split('\n').find((l) => l.includes('rerun:'))!;
    expect(rerun).toBe('``` rerun: npx mcp-review-check --stdio "npx -y @scope/pkg ``x``" ```');
  });

  it('R-11: the connect failure, Target, Revision and the Transport line show server text as written', () => {
    const s = loadSnapshot('minimal-http');
    s.target = { kind: 'stdio', command: 'node', args: ['[t](https://e.test/target)', '<u>arg</u>'] };
    s.coverage = { toolLevel: 'connect-failed', reason: 'stderr: <b>down</b> [c](https://e.test/cause)' };
    s.protocolVersion = '<b>1</b> [v](https://e.test/version)';
    const srv020 = f('SRV-020', 'info', { message: 'era: legacy. <img src="https://e.test/rev.png"> [r](https://e.test/rev)' });
    const md = renderMarkdown({ ...report(s), findings: [srv020] });
    for (const raw of ['<b>', '<u>', '<img src=']) expect(md, raw).not.toContain(raw);
    expect(md).not.toMatch(/(?<!\\)\]\(https:\/\/e\.test/);
    expect(md).toContain('> Could not connect: stderr: &lt;b&gt;down&lt;/b&gt; \\[c\\](https://e.test/cause)');
    expect(md).toContain('| Target | stdio:node \\[t\\](https://e.test/target) &lt;u&gt;arg&lt;/u&gt; |');
    expect(md).toContain('| Revision | &lt;img src="https://e.test/rev.png"&gt; \\[r\\](https://e.test/rev) |');
    expect(md).toContain('era legacy (&lt;b&gt;1&lt;/b&gt; \\[v\\](https://e.test/version)) · auth');
  });
});
