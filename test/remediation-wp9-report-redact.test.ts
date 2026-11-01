// Regression tests for the WP9 report and redaction fixes (review 2026-11-01).
import { describe, expect, it } from 'vitest';
import { runRules } from '../src/rules/engine.js';
import { manualChecklist, RULES } from '../src/rules/index.js';
import type { Finding } from '../src/rules/types.js';
import { buildReport, visibleText } from '../src/report/index.js';
import { renderMarkdown } from '../src/report/markdown.js';
import { renderText } from '../src/report/text.js';
import type { Snapshot } from '../src/snapshot.js';
import { REDACTED } from '../src/protocol/trace.js';
import { buildRedactor, scrub } from '../src/redact.js';
import { loadSnapshot } from './helpers.js';

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
