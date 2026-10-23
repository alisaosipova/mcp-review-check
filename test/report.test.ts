import { readFileSync } from 'node:fs';
import _Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { runRules } from '../src/rules/engine.js';
import { manualChecklist, RULES } from '../src/rules/index.js';
import type { Finding } from '../src/rules/types.js';
import { buildReport } from '../src/report/index.js';
import { contactUrl } from '../src/report/constants.js';
import { targetLabel } from '../src/report/index.js';
import { toJson } from '../src/report/json.js';
import { renderMarkdown } from '../src/report/markdown.js';
import { toSarif } from '../src/report/sarif.js';
import { failed, score, verdict } from '../src/report/score.js';
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
  it('caps each rule at 3 penalized findings', () => {
    const many = Array.from({ length: 10 }, () => f('TOOL-012', 'error'));
    expect(score(many)).toBe(100 - 36);
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

describe('text report', () => {
  it('collapses more than 3 findings of the same rule and message', () => {
    const list = ['a', 'b', 'c', 'd', 'e'].map((t) => f('TOOL-012', 'error', { tool: t, message: 'missing openWorldHint' }));
    expect(groupFindings(list, false)).toHaveLength(1);
    expect(groupFindings(list, true)).toHaveLength(5);
    const text = renderText({ ...report(loadSnapshot('minimal-http')), findings: list }, { color: false, verbose: false });
    expect(text).toContain('TOOL-012 [claude] 5 tools: missing openWorldHint: a, b, c, +2 more');
  });

  it('renders header, groups, checklist, verdicts, disclaimer and CTA without ANSI when color is off', () => {
    const text = renderText(report(loadSnapshot('minimal-http')), { color: false, verbose: false });
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
    expect(withTool.locations[0].physicalLocation.artifactLocation.uri).toBe('https://mcp.acme.test/mcp');
    expect(run.results.some((r: any) => String(r.ruleId).startsWith('MAN-'))).toBe(false);
  });
});
