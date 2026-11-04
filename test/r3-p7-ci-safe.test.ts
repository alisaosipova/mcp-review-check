// Review round 3, package P7 (1.0.1): server text in the GitHub annotations shows ESC and bidi characters as \u{..}
// (A07-05), and no line of the text report carries the legacy `##[command]` runner syntax (A07-07). One helper set
// (ciSafeText, ciSafeLine, neutralizeCommands) serves every stdout and stderr line built from server text.
import { describe, expect, it } from 'vitest';
import { runRules } from '../src/rules/engine.js';
import { manualChecklist, RULES } from '../src/rules/index.js';
import type { Finding } from '../src/rules/types.js';
import { annotations, ciSafeLine, ciSafeText, neutralizeCommands } from '../src/report/github.js';
import { buildReport } from '../src/report/index.js';
import { renderText } from '../src/report/text.js';
import { snap, tool } from './helpers.js';

const HIDDEN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/u;
const at = new Date('2026-11-04T10:00:00Z');
const finding = (over: Partial<Finding>): Finding => ({
  ruleId: 'TOOL-006', title: 't', severity: 'error', platforms: ['claude'], message: 'no title', fix: 'Add a title.', docs: ['https://x.test'], ...over,
});
const reportWith = (findings: Finding[], set?: Parameters<typeof snap>[0]['set']) =>
  buildReport(snap({ set }), { findings, ignored: [], skipped: [], rulesRun: 1 }, [], 'error', at, 1);

describe('A07-05: annotations carry no raw ESC or bidi character from the server', () => {
  it('a tool name with ESC[2K, ESC[8m and U+202E reaches the title and the message as \\u{..}', () => {
    const name = 'ok\u001b[2K\u001b[8mhidden\u202Ex';
    const lines = annotations(reportWith([finding({ tool: name, message: `tool ${name} has no title\u001b]8;;https://attacker.test\u0007` })]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(HIDDEN);
    expect(lines[0]).toContain('ok\\u{1B}[2K\\u{1B}[8mhidden\\u{202E}x');
    expect(lines[0]).toMatch(/^::error title=TOOL-006 ok\\u\{1B\}/);
  });

  it('the line breaks of message and fix stay %0A, and server line separators are shown', () => {
    const [line] = annotations(reportWith([finding({ tool: 'a', message: 'one\u2028two', fix: 'Line 1\nLine 2' })]));
    expect(line).toContain('one\\u{2028}two');
    expect(line).toContain('%0AFix: Line 1%0ALine 2');
  });

  it('a hostile tools/list through the real rules gives annotations without hidden characters', () => {
    const s = snap({ tools: [tool({ name: 'grab\u001b[8m\u202E', title: undefined, description: 'x\u001b[2K' })] });
    const r = buildReport(s, runRules(s, RULES), manualChecklist(s), 'error', at, 1);
    const lines = annotations(r);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).not.toMatch(HIDDEN);
  });

  it('a connect failure whose reason quotes the server is shown too', () => {
    const r = reportWith([], (x) => { x.fatal = 'boom'; x.coverage = { toolLevel: 'connect-failed', reason: 'server said \u001b[31mred\u202E' }; });
    const [line] = annotations(r);
    expect(line).toMatch(/^::error title=mcp-review-check::Could not connect: server said \\u\{1B\}\[31mred\\u\{202E\}$/);
  });
});

describe('A07-07: the legacy ##[command] syntax is neutralised in the text report', () => {
  it('a server name and a tool name with ##[ print as #\\u{23}[ on every line', () => {
    const r = reportWith(
      [finding({ tool: 'grab##[set-output name=verdict;]PASS', message: 'x##[add-mask]FAIL' })],
      (x) => { x.serverInfo = { name: 'Evil ##[stop-commands]tok1', version: '1.0.0' }; },
    );
    const out = renderText(r, { color: false, verbose: true });
    expect(out).not.toContain('##[');
    expect(out).toContain('grab#\\u{23}[set-output name=verdict;]PASS');
    expect(out).toContain('Evil #\\u{23}[stop-commands]tok1');
    expect(out.split('\n').some((l) => /^\s*::/.test(l))).toBe(false);
  });

  it('with colour on, too', () => {
    const r = reportWith([finding({ tool: 't##[x]' })]);
    expect(renderText(r, { color: true, verbose: false })).not.toContain('##[');
  });
});

describe('the CI-safe helpers', () => {
  it('neutralizeCommands: a leading :: (after spaces) and every ##[; other text unchanged', () => {
    expect(neutralizeCommands('::error::x')).toBe('\\u{3A}:error::x');
    expect(neutralizeCommands('  ::warning::x')).toBe('  \\u{3A}:warning::x');
    expect(neutralizeCommands('a ##[group]b ###[c')).toBe('a #\\u{23}[group]b ##\\u{23}[c');
    expect(neutralizeCommands('a :: b # [c] ## d')).toBe('a :: b # [c] ## d');
  });

  it('ciSafeText shows hidden characters and the legacy syntax; ciSafeLine also guards a leading ::', () => {
    expect(ciSafeText('a\u001b[2K##[x]\nb')).toBe('a\\u{1B}[2K#\\u{23}[x]\\u{A}b');
    expect(ciSafeLine('::set-output name=a::b\u202E')).toBe('\\u{3A}:set-output name=a::b\\u{202E}');
    expect(ciSafeLine('ok\n::error::injected')).not.toMatch(/\n/);
  });
});
