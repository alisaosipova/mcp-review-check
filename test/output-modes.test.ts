// Output modes of the text report (W1-2): the manual checklist as one line (R-32), --quiet (R-33, U-6), the protocol
// revision in the header instead of an SRV-020 line, TOOL-013 info only with --verbose, the MAN-024 text (R-34).
// Black-box: the built CLI against the GOOD and BAD stdio fixtures and in-process HTTP servers.
import { afterEach, describe, expect, it } from 'vitest';
import { startBridge, type Started } from './fixtures/http-bridge.js';
import { startModernServer } from './fixtures/modern-server.js';
// @ts-expect-error untyped .mjs fixture
import { createGoodServer } from './fixtures/good-server.mjs';
import { BAD, cli, GOOD, nonInfo } from './cli-runner.js';

let servers: Started[] = [];
afterEach(async () => { await Promise.all(servers.map((s) => s.close())); servers = []; });
const track = (s: Started) => (servers.push(s), s);

/** GOOD plus a read-only tool that sets idempotentHint: TOOL-013 reports it as spec info. */
function goodWithIdempotentReadOnly() {
  const server = createGoodServer();
  server.registerTool(
    'list_tags',
    {
      title: 'List tags',
      description: 'List the tags used in the user\'s Acme Notes workspace and return their names.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => ({ content: [{ type: 'text', text: '["home","work"]' }] }),
  );
  return server;
}

/** The text report's header: everything before the first blank line. */
const header = (text: string) => text.split('\n\n')[0];
/** Markdown before the first findings section. */
const mdHeader = (md: string) => md.split('\n## ')[0];

describe('R-32: manual checklist in text', () => {
  it('R-32: text prints one line "N manual items: --checklist to show"; --checklist, markdown and JSON list every item', async () => {
    const [json, text, full, md] = await Promise.all([
      cli(['--stdio', GOOD, '--format', 'json']),
      cli(['--stdio', GOOD]),
      cli(['--stdio', GOOD, '--checklist']),
      cli(['--stdio', GOOD, '--format', 'markdown']),
    ]);
    const ids: string[] = json.json.manual.map((m: any) => m.id);
    expect(ids.length).toBeGreaterThan(1);

    expect(text.code, text.stderr).toBe(0);
    expect(text.stdout).toMatch(new RegExp(`^${ids.length} manual items: --checklist to show$`, 'm'));
    expect(text.stdout).not.toContain('MANUAL CHECKLIST');
    expect(ids.filter((id) => text.stdout.includes(id))).toEqual([]);

    expect(full.code, full.stderr).toBe(0);
    expect(full.stdout).toContain('MANUAL CHECKLIST (not verified automatically)');
    expect(ids.filter((id) => !full.stdout.includes(`[ ] ${id} `))).toEqual([]);
    expect(full.stdout).not.toContain('--checklist to show');

    expect(ids.filter((id) => !md.stdout.includes(`- [ ] **${id}**`))).toEqual([]);
    expect(md.stdout).not.toContain('--checklist to show');
  });

  it('R-32: --checklist and --quiet do not change JSON', async () => {
    const [plain, flagged] = await Promise.all([
      cli(['--stdio', GOOD, '--format', 'json']),
      cli(['--stdio', GOOD, '--format', 'json', '--checklist', '--quiet']),
    ]);
    expect(flagged.code, flagged.stderr).toBe(0);
    expect(flagged.json.manual).toEqual(plain.json.manual);
    expect(flagged.json.findings.length).toBe(plain.json.findings.length);
  });
});

describe('R-33: --quiet', () => {
  it('R-33: --quiet on BAD prints only error and warning findings, Score, Result and the disclaimer (U-6)', async () => {
    const [json, quiet] = await Promise.all([cli(['--stdio', BAD, '--format', 'json']), cli(['--stdio', BAD, '--quiet'])]);
    expect(quiet.code, quiet.stderr).toBe(1);
    const lines = quiet.stdout.split('\n').filter((l) => l.trim());
    const scoreAt = lines.findIndex((l) => l.startsWith('Score '));
    expect(scoreAt).toBeGreaterThan(0);
    const findingLines = lines.slice(0, scoreAt);
    // Before the Score line: finding lines only (x = error, ! = warning), no header, sections, fixes or checklist.
    expect(findingLines.filter((l) => !/^ {2}[x!] [A-Z]+-\d{3} /.test(l))).toEqual([]);
    expect(findingLines.some((l) => l.startsWith('  x '))).toBe(true);
    expect(findingLines.some((l) => l.startsWith('  ! '))).toBe(true);
    const shown = new Set(findingLines.map((l) => l.slice(4).split(' ')[0]));
    expect([...new Set<string>(nonInfo(json.json).map((f: any) => f.ruleId))].filter((id) => !shown.has(id))).toEqual([]);
    const infoOnly = json.json.findings.filter((f: any) => f.severity === 'info' && !nonInfo(json.json).some((x: any) => x.ruleId === f.ruleId));
    expect(infoOnly.length).toBeGreaterThan(0);
    expect(infoOnly.filter((f: any) => shown.has(f.ruleId))).toEqual([]);
    expect(lines[scoreAt + 1]).toMatch(/Result: FAIL \(--fail-on error\)/);
    // U-6: the disclaimer stays, and nothing claims a verified or approved server.
    expect(lines.slice(scoreAt + 2).join('\n')).toContain('Passing these automated checks does not guarantee approval.');
    expect(quiet.stdout).toContain('not affiliated with Anthropic or OpenAI');
    expect(quiet.stdout).not.toMatch(/\b(verified|approved)\b/i);
    expect(quiet.stdout).not.toMatch(/MANUAL CHECKLIST|manual items|^INFO|^ERRORS|^Server /m);
  });

  it('R-33: --quiet and --checklist leave markdown and JSON as they are without them (D-3: text only)', async () => {
    const [md, mdFlagged, json, jsonFlagged] = await Promise.all([
      cli(['--stdio', BAD, '--format', 'markdown']), cli(['--stdio', BAD, '--format', 'markdown', '--quiet', '--checklist']),
      cli(['--stdio', BAD, '--format', 'json']), cli(['--stdio', BAD, '--format', 'json', '--quiet', '--checklist']),
    ]);
    expect(md.stdout).toContain('## Info (');
    expect(mdFlagged.code, mdFlagged.stderr).toBe(md.code);
    expect(mdFlagged.stdout).toBe(md.stdout);
    const untimed = (r: any) => ({ ...r, startedAt: undefined, durationMs: undefined });
    expect(jsonFlagged.code, jsonFlagged.stderr).toBe(json.code);
    expect(untimed(jsonFlagged.json)).toEqual(untimed(json.json));
  });
});

describe('R-34: revision in the header, TOOL-013 info, MAN-024', () => {
  it('R-34: revision in the header, no SRV-020 line in text and markdown; SRV-020 stays in JSON (legacy HTTP)', async () => {
    const s = track(await startBridge(createGoodServer, { rejectForeignOrigin: true }));
    const [json, text, md] = await Promise.all([cli([s.url, '--format', 'json']), cli([s.url]), cli([s.url, '--format', 'markdown'])]);
    expect(json.json.findings.filter((f: any) => f.ruleId === 'SRV-020')).toHaveLength(1);
    expect(text.code, text.stderr).toBe(0);
    expect(text.stdout).not.toContain('SRV-020');
    expect(header(text.stdout)).toMatch(/era legacy \(2025-11-25\)[^\n]*\n[^\n]*2026-07-28 clients fall back to initialize/);
    expect(md.stdout).not.toContain('SRV-020');
    expect(mdHeader(md.stdout)).toContain('era legacy (2025-11-25)');
    expect(mdHeader(md.stdout)).toContain('2026-07-28 clients fall back to initialize');
  });

  it('R-34: revision in the header, no SRV-020 line in text (2026-07-28 HTTP)', async () => {
    const s = track(await startModernServer());
    const [json, text] = await Promise.all([cli([s.url, '--format', 'json']), cli([s.url, '--verbose'])]);
    expect(json.json.findings.some((f: any) => f.ruleId === 'SRV-020')).toBe(true);
    expect(text.stdout).not.toContain('SRV-020');
    expect(header(text.stdout)).toContain('era modern (2026-07-28)');
  });

  it('R-34: TOOL-013 info only with --verbose (text and markdown); JSON keeps it', async () => {
    const s = track(await startBridge(goodWithIdempotentReadOnly, { rejectForeignOrigin: true }));
    const [json, text, verbose, md] = await Promise.all([
      cli([s.url, '--format', 'json']), cli([s.url]), cli([s.url, '--verbose']), cli([s.url, '--format', 'markdown']),
    ]);
    expect(json.json.findings.filter((f: any) => f.ruleId === 'TOOL-013')).toMatchObject([{ severity: 'info', tool: 'list_tags' }]);
    expect(text.code, text.stderr).toBe(0);
    expect(text.stdout).not.toContain('TOOL-013');
    expect(md.stdout).not.toContain('TOOL-013');
    expect(verbose.stdout).toMatch(/TOOL-013 \[spec\] list_tags: idempotentHint is meaningless on a read-only tool/);
  });

  it('R-34: MAN-024 states the screenshot rules without the "no longer shown" note', async () => {
    const list = await cli(['--list-rules']);
    const line = list.stdout.split('\n').find((l) => l.startsWith('MAN-024'));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/no longer shown/);
    expect(line).toMatch(/optional/i);
    expect(line).toMatch(/custom UI/);
    expect(line).toMatch(/one PNG or JPEG per starter prompt, exactly 706 px wide, 400–860 px tall/);
  });
});
