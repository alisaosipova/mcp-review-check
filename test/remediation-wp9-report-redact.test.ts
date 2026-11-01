// Regression tests for the WP9 report and redaction fixes (review 2026-11-01).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runRules, sortFindings, subjectOf, unmetNeed } from '../src/rules/engine.js';
import { manualChecklist, RULES } from '../src/rules/index.js';
import { defineRule, type Finding } from '../src/rules/types.js';
import { annotations, appendStepSummary, fitSummary } from '../src/report/github.js';
import { buildReport, visibleText } from '../src/report/index.js';
import { toJson } from '../src/report/json.js';
import { renderMarkdown } from '../src/report/markdown.js';
import { toSarif } from '../src/report/sarif.js';
import { failed } from '../src/report/score.js';
import { fixSnippets, renderText } from '../src/report/text.js';
import type { Snapshot } from '../src/snapshot.js';
import { REDACTED } from '../src/protocol/trace.js';
import { buildRedactor, scrub } from '../src/redact.js';
import { loadSnapshot, snap } from './helpers.js';

const f = (ruleId: string, severity: Finding['severity'], over: Partial<Finding> = {}): Finding => ({
  ruleId, title: 't', severity, platforms: ['claude'], message: 'm', fix: 'fix', docs: ['https://x.test'], ...over,
});

function report(s: Snapshot) {
  return buildReport(s, runRules(s, RULES), manualChecklist(s), 'error', new Date('2026-10-22T10:00:00Z'), 1234);
}

/** minimal-http with a hostile serverInfo.name and first tool name. */
function hostile(): Snapshot {
  const s = loadSnapshot('minimal-http');
  s.serverInfo = { name: 'Evil\x1b[2J\x1b[31m SERVER\n::error::fake annotation\x1b]8;;https://attacker.test\x07click\x1b]8;;\x07' };
  s.tools[0] = { ...s.tools[0], name: '\x1b[32mgood_tool\x1b[0m\r\n::warning::injected\u202E' };
  delete (s.tools[0] as Record<string, unknown>).title;
  return s;
}

describe('server text cannot drive the terminal or the CI log (F115, F135)', () => {
  it('visibleText shows control and format characters as \\u{..} and keeps tabs', () => {
    expect(visibleText('a\x1b[2K\rb\nc\td\u202Ee\x9b\u2028')).toBe('a\\u{1B}[2K\\u{D}b\\u{A}c\td\\u{202E}e\\u{9B}\\u{2028}');
  });

  it('the text report holds no ESC, CR, BEL or server line break, and no line starts with "::"', () => {
    const r = report(hostile());
    for (const opts of [{ color: false, verbose: false }, { color: false, verbose: true }, { color: false, verbose: false, quiet: true }]) {
      const out = renderText(r, opts);
      expect(out).not.toMatch(/[\x1b\r\x07\u202E]/);
      for (const l of out.split('\n')) expect(l).not.toMatch(/^\s*::/);
    }
    const out = renderText(r, { color: false, verbose: false });
    expect(out).toContain('Server  Evil\\u{1B}[2J\\u{1B}[31m SERVER\\u{A}::error::fake annotation');
    expect(out).toMatch(/\\u{1B}\[32mgood_tool\\u{1B}\[0m\\u{D}\\u{A}::warning::injected\\u{202E}/);
  });

  it('colour codes stay the report\'s own: only its ANSI sequences reach the terminal', () => {
    const out = renderText(report(hostile()), { color: true, verbose: false });
    const seqs = out.match(/\x1b\[[0-9;]*m/g) ?? [];
    expect(seqs.length).toBeGreaterThan(0);
    for (const x of seqs) expect(['\x1b[31m', '\x1b[33m', '\x1b[36m', '\x1b[1m', '\x1b[2m', '\x1b[0m']).toContain(x);
    expect(out).toMatch(/Result: \x1b\[31mFAIL\x1b\[0m \(--fail-on error\)/);
  });

  it('a failed connect cause from the server is made visible in the result line and FAIL is still coloured', () => {
    const s = loadSnapshot('minimal-http');
    s.fatal = 'boom\x1b[2K\rPASS';
    s.coverage = { toolLevel: 'connect-failed', reason: 'boom\x1b[2K\rPASS' };
    const out = renderText(report(s), { color: true, verbose: false, quiet: true });
    expect(out).toContain('Result: \x1b[31mFAIL\x1b[0m (could not connect: boom\\u{1B}[2K\\u{D}PASS)');
  });

  it('a fix snippet line for a tool named "::warning::x" does not start with a workflow command', () => {
    const s = loadSnapshot('minimal-http');
    s.tools[0] = { ...s.tools[0], name: '::warning::x' };
    delete (s.tools[0] as Record<string, unknown>).title;
    const out = renderText(report(s), { color: false, verbose: false });
    expect(out).toContain('  \\u{3A}:warning::x: {');
  });
});

describe('markdown shows hidden characters and no server emphasis (F147, F127)', () => {
  it('ESC, bidi and zero-width characters from the server are shown as \\u{..} in text, cells and code spans', () => {
    const s = hostile();
    const r = report(s);
    const md = renderMarkdown({ ...r, findings: [f('X-1', 'error', { tool: '\x1b[31mt\u200B', message: 'm\u202Eq', evidence: 'ev\x1b[0m' })] });
    expect(md).not.toMatch(/[\x1b\x07\u202E]/);
    expect(md).toContain('\\\\u{1B}\\[31mt\\\\u{200B}'); // in text(): the backslash itself is escaped for markdown
    expect(md).toContain('`` ev\\u{1B}[0m ``');
  });

  it('emphasis, strikethrough and math markers in server text are escaped', () => {
    const s = loadSnapshot('minimal-http');
    s.serverInfo = { name: 'Srv *bold* _it_ $x$ ~~s~~', version: '1' };
    expect(renderMarkdown(report(s)).split('\n')[0]).toBe('# Srv \\*bold\\* \\_it\\_ \\$x\\$ \\~\\~s\\~\\~ 1');
  });

  it('the zero-width spaces markdown adds itself (://, www., @) are kept as characters', () => {
    const s = loadSnapshot('minimal-http');
    s.serverInfo = { name: 'see https://evil.test and a@b.test', version: '1' };
    expect(renderMarkdown(report(s)).split('\n')[0]).toBe('# see https:\u200B//evil.test and a@&#8203;b.test 1');
  });
});

describe('common --env settings under a plain name are not masked in the report (F118)', () => {
  it('production, debug and a version stay; the same values under a secret name and other plain values are masked', () => {
    const r = buildRedactor({ env: { NODE_ENV: 'production', LOG_LEVEL: 'debug', APP_VERSION: '1.2.3', TAG: 'v2.0.1-rc.1', NOTE: 'plain-WEAK05', API_TOKEN: 'production' } });
    expect(scrub('Tool deploy_production: deploys to production; debug_logs; server 1.2.3 v2.0.1-rc.1', buildRedactor({ env: { NODE_ENV: 'production', LOG_LEVEL: 'debug', APP_VERSION: '1.2.3', TAG: 'v2.0.1-rc.1' } })))
      .toBe('Tool deploy_production: deploys to production; debug_logs; server 1.2.3 v2.0.1-rc.1');
    expect(r.values.has('plain-WEAK05')).toBe(true);
    expect(r.values.has('production'), 'under a secret name it is masked').toBe(true);
  });
});

describe('Cookie and Basic credentials are redacted in their parts (F116, F117)', () => {
  it('a session cookie value echoed alone or as one pair is redacted; a plain cookie value is not', () => {
    for (const r of [buildRedactor({ headers: { Cookie: 'theme=dark; session=S3cr3tSess10nValue' } }), buildRedactor({ argv: ['npx', 'mcp-remote', '--header', 'Cookie: theme=dark; session=S3cr3tSess10nValue'] })]) {
      expect(scrub('echo session=S3cr3tSess10nValue / S3cr3tSess10nValue', r)).toBe(`echo ${REDACTED} / ${REDACTED}`);
      expect(scrub('theme=dark mode is dark', r)).toBe(`${REDACTED} mode is dark`);
    }
    expect(scrub('invalid sid abcd1234efgh5678ijkl', buildRedactor({ headers: { Cookie: 'sid=abcd1234efgh5678ijkl' } }))).toBe(`invalid sid ${REDACTED}`);
    expect(scrub('sess xyzw', buildRedactor({ headers: { Cookie: 'session_token="xyzw"' } }))).toBe(`sess ${REDACTED}`);
  });

  it('the decoded user:pass and password of a Basic credential are redacted (header, argv, env)', () => {
    const basic = `Basic ${Buffer.from('admin:SuperSecret99').toString('base64')}`;
    for (const r of [
      buildRedactor({ headers: { Authorization: basic } }),
      buildRedactor({ argv: ['npx', 'mcp-remote', '--header', `Authorization: ${basic}`] }),
      buildRedactor({ env: { AUTH_HEADER: basic } }),
    ]) {
      expect(scrub('error: bad password SuperSecret99 for admin', r)).toBe(`error: bad password ${REDACTED} for admin`);
      expect(scrub('creds admin:SuperSecret99', r)).toBe(`creds ${REDACTED}`);
    }
  });

  it('a Basic token that is not base64 of "user:pass" text adds nothing decoded', () => {
    const binary = Buffer.from([0x01, 0x3a, 0xff, 0xfe, 0x41, 0x42, 0x43, 0x44]).toString('base64');
    for (const token of [binary, 'not-base64!!']) {
      const values = [...buildRedactor({ headers: { Authorization: `Basic ${token}` } }).values];
      expect(values.every((v) => v.includes(token) || v.includes(encodeURIComponent(token)))).toBe(true);
    }
  });
});

describe('a rule that throws is never lost (F124, F123)', () => {
  const chatgptOnly = defineRule(
    { id: 'XX-002', title: 't', severity: { chatgpt: 'error' }, needs: [], rationale: 'r', fix: 'f', sources: ['https://x.test'] },
    () => { throw new Error('boom'); },
  );

  it('an INTERNAL finding is reported even when the rule is outside --target', () => {
    const r = runRules(snap({ target: 'claude' }), [chatgptOnly]);
    expect(r.findings).toEqual([expect.objectContaining({ ruleId: 'INTERNAL', severity: 'info', platforms: ['spec'], message: 'XX-002 threw: boom' })]);
    expect(r.skipped).toEqual([{ ruleId: 'XX-002', reason: 'not applicable to --target claude' }]);
  });

  it('SARIF has a rule entry for INTERNAL results, and none when there are none', () => {
    const s = loadSnapshot('minimal-http');
    const r = report(s);
    const rulesOf = (x: Record<string, any>) => x.runs[0].tool.driver.rules.map((y: { id: string }) => y.id);
    expect(rulesOf(toSarif(r))).not.toContain('INTERNAL');
    const sarif = toSarif({ ...r, findings: [...r.findings, ...runRules(s, [chatgptOnly]).findings] }) as Record<string, any>;
    expect(rulesOf(sarif).filter((x: string) => x === 'INTERNAL')).toHaveLength(1);
    expect(sarif.runs[0].tool.driver.rules.at(-1)).toMatchObject({ id: 'INTERNAL', shortDescription: { text: 'Internal rule error' }, help: { text: 'Please report this bug.' } });
  });
});

describe('fix snippets do not depend on the wording of TOOL-006 (F134)', () => {
  it('a TOOL-006 finding gives a snippet when the snapshot has no title, whatever its message; a long title gives none', () => {
    const s = loadSnapshot('minimal-http');
    const r = report(s);
    const t0 = s.tools[0] as Record<string, unknown>;
    const name = String(t0.name);
    const titled = { ...r, findings: [f('TOOL-006', 'error', { tool: name, message: 'reworded: the title is missing' })], snap: { ...s, tools: [{ ...t0, title: undefined, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }] } };
    const out = fixSnippets(titled);
    expect(out).toHaveLength(1);
    expect(out[0].startsWith(`${name}: {"title":"`)).toBe(true);
    expect(out[0]).not.toContain('annotations'); // every hint is set
    const long = { ...titled, snap: { ...s, tools: [{ ...t0, title: 'A very long title', annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }] } };
    expect(fixSnippets(long)).toEqual([]);
  });
});

describe('JSON explains the score and keeps argv whole (F129, F128)', () => {
  it('summary.rootCauses is the basis of summary.score', () => {
    const r = report(loadSnapshot('minimal-http'));
    const j = toJson(r) as Record<string, any>;
    expect(j.summary.rootCauses).toEqual(r.rootCauses);
    expect(j.summary.score).toBe(Math.max(0, 100 - 12 * r.rootCauses.errors - 4 * r.rootCauses.warnings));
  });

  it('server.argv keeps an argument with spaces as one item; server.command stays for display', () => {
    const s = snap({ set: (x) => { x.target = { kind: 'stdio', command: 'node', args: ['srv.js', 'a b', '--flag=x y'] }; } });
    const j = toJson(report(s)) as Record<string, any>;
    expect(j.server.argv).toEqual(['node', 'srv.js', 'a b', '--flag=x y']);
    expect(j.server.command).toBe('node srv.js a b --flag=x y');
    expect(toJson(report(loadSnapshot('minimal-http'))).server).not.toHaveProperty('argv');
  });
});

describe('engine order and needs (F125, F133)', () => {
  it('findings sort by code unit, not by locale', () => {
    const list = ['b', 'B', 'a', '_x', 'ä'].map((t) => f('TOOL-001', 'error', { tool: t }));
    expect(sortFindings(list).map((x) => x.tool)).toEqual(['B', '_x', 'a', 'b', 'ä']);
  });

  it('the legacy need is met by the era alone, for stdio too', () => {
    const s = snap();
    expect(unmetNeed(s, 'legacy')).toBeUndefined();
    s.era = 'modern';
    expect(unmetNeed(s, 'legacy')).toBe('era modern');
  });
});

describe('failed() gates like the CLI by default (R022)', () => {
  it('a spec-only error does not fail by default, but does with spec passed', () => {
    const spec = f('SPEC-004', 'error', { platforms: ['spec'], severityByPlatform: { spec: 'error' } });
    expect(failed([spec], 'error')).toBe(false);
    expect(failed([spec], 'error', ['claude', 'chatgpt', 'spec'])).toBe(true);
    expect(failed([f('A', 'error')], 'error')).toBe(true);
  });
});

describe('the job summary stays within the 1 MiB step limit (F131)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mrc-wp9-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('a small report is appended whole', () => {
    expect(fitSummary('# a\n| x |', 100)).toBe('# a\n| x |\n');
  });

  it('a large report is cut at a line end with a note, counting what the file already holds', () => {
    const file = join(dir, 'summary.md');
    writeFileSync(file, 'x'.repeat(300));
    const md = Array.from({ length: 100 }, (_, i) => `| row ${i} | ${'e'.repeat(20)} |`).join('\n');
    expect(appendStepSummary(file, md, 2000)).toBe('');
    const out = readFileSync(file, 'utf8');
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(2000);
    expect(out).toContain('| row 0 |');
    expect(out).not.toContain('| row 99 |');
    expect(out).toMatch(/\|\n\n> The report was cut to fit the 1 MiB job summary limit of GitHub; `--output` writes it in full\.\n$/);
  });

  it('a full summary file gets nothing and a stderr warning', () => {
    const file = join(dir, 'full.md');
    writeFileSync(file, 'x'.repeat(2000));
    expect(appendStepSummary(file, '# report', 2000)).toMatch(/^warning: \$GITHUB_STEP_SUMMARY is full/);
    expect(readFileSync(file, 'utf8')).toBe('x'.repeat(2000));
  });
});

describe('a tool named "" is shown as "(empty name)" (R023)', () => {
  it('in the annotation title, the text and markdown subject, and the SARIF message', () => {
    const r = report(loadSnapshot('minimal-http'));
    const x = f('TOOL-003', 'error', { tool: '', message: 'description missing' });
    const rr = { ...r, findings: [x], summary: { ...r.summary, gate: { ...r.summary.gate, platforms: ['claude' as const] } } };
    expect(annotations(rr)).toContain('::error title=TOOL-003 (empty name)::[claude] description missing%0AFix: fix');
    expect(renderText(rr, { color: false, verbose: false })).toContain('TOOL-003 [claude] (empty name): description missing');
    expect(renderMarkdown(rr)).toContain('| TOOL-003 | claude | (empty name) | description missing |');
    expect((toSarif(rr) as Record<string, any>).runs[0].results[0].message.text).toBe('(empty name): description missing');
    expect(subjectOf({})).toBe('server');
    expect(subjectOf({ resource: '' })).toBe('(empty name)');
  });
});
