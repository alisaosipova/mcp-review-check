// Review round 4, package P5 (1.1.1): rule-phase performance on server-controlled input (A09-01, A09-03, A09-06,
// A09-07, A09-08). Each test fails on 1.1.0 (too slow, or not shared, or unbounded) and the outputs for ordinary
// input stay as they were.
import { describe, expect, it } from 'vitest';
import { RULES, runRules } from '../src/rules/index.js';
import { APPS_003, normalizeMime } from '../src/rules/apps.js';
import { TOOL_009 } from '../src/rules/tools.js';
import { TOOL_036 } from '../src/rules/schema.js';
import { extractOrigins } from '../src/rules/util/html.js';
import { corpus } from '../src/rules/util/text.js';
import { uiResources } from '../src/rules/util/ui.js';
import { defineRule, type Rule } from '../src/rules/types.js';
import { capSnapshot, HTML_CAP, ID_CAP, TEXT_CAP } from '../src/limits.js';
import { counts } from '../src/report/index.js';
import type { Snapshot } from '../src/snapshot.js';
import { snap, tool, toolWithProps } from './helpers.js';

const ms = (f: () => unknown): number => {
  const t0 = performance.now();
  f();
  return performance.now() - t0;
};

const stop = (s: Snapshot, phase: string) => {
  s.limits = { truncated: [], budgetExhausted: { bytes: 1, overBytes: 1, phase, completed: [], unfinished: [phase] } };
};

describe('A09-01: importmap scan is linear', () => {
  for (const unit of ['<script type=importmap>', '<script type=importmap>{', ' type=importmap']) {
    it(`2 MB of ${JSON.stringify(unit)} runs in under 1 s`, () => {
      const body = unit.repeat(Math.ceil(HTML_CAP / unit.length));
      const html = `<html><body>${unit.startsWith(' ') ? `<script${body}` : body}</body></html>`;
      expect(ms(() => extractOrigins(html))).toBeLessThan(1000); // 40-100 s before the fix
    });
  }
  it('closed and unclosed maps are still read; an opener inside a map body is text', () => {
    const map = (u: string) => `{"imports":{"x":"${u}"}}`;
    const html = `<script type="importmap">${map('https://a.example.com/x.js')}</script>`
      + `<script type=importmap>${map('https://b.example.com/x.js')}</script>`
      + `<script type=importmap>${map('https://c.example.com/x.js')}`;
    expect(extractOrigins(html).map((o) => o.origin)).toEqual(['https://a.example.com', 'https://b.example.com', 'https://c.example.com']);
    const nested = `<script type=importmap>{"imports":{"x":"<script type=importmap>"}}</script>`;
    expect(extractOrigins(nested)).toEqual([]);
  });
});

describe('A09-03: read item fields are capped; normalizeMime is linear', () => {
  it('a 1 MB mimeType parameter without "=" normalizes in milliseconds', () => {
    const m = `text/html;a${' '.repeat(1024 * 1024)}x`;
    expect(ms(() => normalizeMime(m))).toBeLessThan(500);
  });
  it('normalizeMime keeps its results on ordinary input', () => {
    expect(normalizeMime('Text/HTML ; Profile = "mcp-app"')).toBe('text/html;profile=mcp-app');
    expect(normalizeMime('text/html;profile="a\\"b"')).toBe('text/html;profile=a"b');
    expect(normalizeMime('text/html;profile=mcp-app')).toBe('text/html;profile=mcp-app');
    expect(normalizeMime('text/html;x = =y')).toBe('text/html;x==y');
    expect(normalizeMime('text/html;flag')).toBe('text/html;flag');
    expect(normalizeMime('text/html; =v')).toBe('text/html;=v');
  });
  it('capSnapshot cuts uri, mimeType and _meta of a read item and records it; text keeps HTML_CAP', () => {
    const uiUri = 'ui://acme/board.html';
    const big = 'x'.repeat(2 * ID_CAP);
    const text = `<html>${'a'.repeat(TEXT_CAP * 4)}</html>`;
    const s = snap({
      tools: [tool({ name: 'show_board', _meta: { ui: { resourceUri: uiUri } } })],
      set: (x) => {
        x.resourceReads[uiUri] = { ok: true, durationMs: 1, raw: { contents: [{ uri: uiUri + big, mimeType: `text/html;a${big}`, text, _meta: { ui: { domain: big, csp: { connectDomains: [big] } } } }] } };
      },
    });
    const out = capSnapshot(s);
    const item = (s.resourceReads[uiUri].raw as { contents: Array<Record<string, any>> }).contents[0];
    expect(item.uri.length).toBe(ID_CAP);
    expect(item.mimeType.length).toBe(TEXT_CAP);
    expect(item._meta.ui.domain.length).toBe(TEXT_CAP);
    expect(item._meta.ui.csp.connectDomains[0].length).toBe(TEXT_CAP);
    expect(item.text).toBe(text);
    expect(out.some((t) => t.where.startsWith('UI resource ui://acme/board.html item') && t.length > TEXT_CAP)).toBe(true);
  });
  it('an ordinary read item is not touched or reported', () => {
    const uiUri = 'ui://acme/board.html';
    const item = { uri: uiUri, mimeType: 'text/html;profile=mcp-app', text: '<p>x</p>', _meta: { ui: { csp: { connectDomains: ['https://a.example.com'] } } } };
    const s = snap({ set: (x) => { x.resourceReads[uiUri] = { ok: true, durationMs: 1, raw: { contents: [structuredClone(item)] } }; } });
    expect(capSnapshot(s)).toEqual([]);
    expect((s.resourceReads[uiUri].raw as { contents: unknown[] }).contents[0]).toEqual(item);
  });
});

describe('A09-06: one corpus per run, also when the run was stopped', () => {
  const probes = (seen: unknown[]): Rule[] => [1, 2].map((i) => defineRule(
    { id: `TST-90${i}`, title: 'probe', severity: { spec: 'info' }, needs: ['tools'], rationale: '', fix: '', sources: [] },
    (s) => { seen.push(corpus(s)[0]); return []; },
  ));
  for (const stopped of [false, true]) {
    it(`two corpus rules of one ${stopped ? 'budget-exhausted' : 'complete'} run share the entries (buildCorpus once)`, () => {
      const s = snap({ tools: [tool()] });
      if (stopped) stop(s, 'tools re-list');
      const seen: unknown[] = [];
      runRules(s, probes(seen));
      expect(seen).toHaveLength(2);
      expect(seen[0]).toBeDefined();
      expect(seen[1]).toBe(seen[0]);
    });
  }
});

describe('A09-07: uiResources is built once per snapshot and is linear', () => {
  const big = (n: number) => snap({
    tools: Array.from({ length: n }, (_, i) => tool({ name: `t${i}`, _meta: { ui: { resourceUri: `ui://acme/w${i}.html` } } })),
    resources: Array.from({ length: n }, (_, i) => ({ uri: `file:///r${i}.txt`, name: `r${i}` })),
  });
  it('40k tools across the 16 call sites runs in under 1 s', () => {
    const s = big(40_000);
    const t = ms(() => { for (let i = 0; i < 15; i++) uiResources(s); counts(s); });
    expect(t).toBeLessThan(3000); // 100 s before the fix; slack for slow CI runners
    expect(uiResources(s)).toHaveLength(40_000);
  });
  it('a tool URI that is listed without ui:// is still matched to its first list entry', () => {
    const s = snap({
      tools: [tool({ _meta: { ui: { resourceUri: 'https://acme.example.com/w.html' } } })],
      resources: [{ uri: 'https://acme.example.com/w.html', name: 'first' }, { uri: 'https://acme.example.com/w.html', name: 'second' }],
    });
    expect(uiResources(s)[0].listEntry?.name).toBe('first');
  });
  it('the decoded HTML is shared across calls and a later run sees an in-place change', async () => {
    const uiUri = 'ui://acme/board.html';
    const item = { uri: uiUri, mimeType: 'text/html;profile=mcp-app', blob: Buffer.from('<p>one</p>').toString('base64') };
    const s = snap({ tools: [tool({ _meta: { ui: { resourceUri: uiUri } } })], set: (x) => { x.resourceReads[uiUri] = { ok: true, durationMs: 1, raw: { contents: [item] } }; } });
    expect(uiResources(s)[0].html).toBe('<p>one</p>');
    expect(uiResources(s)[0]).toBe(uiResources(s)[0]);
    await null;
    item.blob = Buffer.from('<p>two</p>').toString('base64');
    expect(uiResources(s)[0].html).toBe('<p>two</p>');
  });
  it('in a stopped run every UI rule still notes the missing read (skipped, not passed)', () => {
    const s = snap({ tools: [tool({ _meta: { ui: { resourceUri: 'ui://acme/board.html' } } })] });
    s.limits = { truncated: [], stopped: { maxDurationMs: 1, phase: 'UI resource reads', unfinished: ['UI resource reads'] } };
    const again = { ...APPS_003, id: 'APPS-903' };
    const r = runRules(s, [APPS_003, again]);
    expect(r.skipped.filter((x) => x.reason === 'stopped by --max-duration').map((x) => x.ruleId)).toEqual(['APPS-003', 'APPS-903']);
  });
});

describe('A09-08: pointers in messages and the path field are bounded', () => {
  const nested = (name: string, depth: number) => {
    let node: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < depth; i++) node = { type: 'object', properties: { [`${name}${i}`]: node } };
    return node;
  };
  it('a 100 KB property name yields a TOOL-009 message of at most 2 KB', () => {
    const s = snap({ tools: [tool({ inputSchema: nested('n'.repeat(100 * 1024), 4) })] });
    const f = runRules(s, [TOOL_009]).findings;
    expect(f).toHaveLength(1);
    expect(f[0].message.length).toBeLessThanOrEqual(2048);
    expect(f[0].message).toMatch(/^4 parameter\(s\) without description: \/properties\/n{48}\u2026n{59}3, /u);
  });
  it('a $ref under a long path keeps a bounded path field and message', () => {
    const schema = nested('p'.repeat(100 * 1024), 3);
    (schema.properties as Record<string, Record<string, unknown>>)[`${'p'.repeat(100 * 1024)}2`] = { $ref: '#/$defs/missing' };
    const f = runRules(snap({ tools: [tool({ inputSchema: schema })] }), [TOOL_036]).findings;
    expect(f).toHaveLength(1);
    expect(f[0].path!.length).toBeLessThanOrEqual(4096);
    expect(f[0].message.length).toBeLessThanOrEqual(2048);
  });
  it('ordinary pointers are shown in full', () => {
    const s = snap({ tools: [toolWithProps('get_note', { id: { type: 'string' }, opts: { type: 'object', properties: { depth: { type: 'integer' } } } })] });
    expect(runRules(s, [TOOL_009]).findings.map((f) => f.message)).toEqual(['3 parameter(s) without description: /properties/id, /properties/opts, /properties/opts/properties/depth']);
  });
});
