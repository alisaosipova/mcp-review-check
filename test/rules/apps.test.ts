import { describe, expect, it } from 'vitest';
import { appsRules, claudeUiDomain, normalizeMime } from '../../src/rules/apps.js';
import { extractOrigins, originMatches } from '../../src/rules/util/html.js';
import type { Snapshot } from '../../src/snapshot.js';
import { checkCase, evaluate, snap, tool, type Case } from '../helpers.js';

const URI = 'ui://acme/board.html';
const MIME = 'text/html;profile=mcp-app';
const GOOD_HTML = '<!doctype html><html><head><script src="https://cdn.acme.test/app.js"></script></head><body><img src="https://cdn.acme.test/logo.png" alt="logo"><script>fetch("https://api.acme.test/v1")</script></body></html>';
const GOOD_META = {
  ui: { csp: { resourceDomains: ['https://cdn.acme.test'], connectDomains: ['https://api.acme.test'] }, prefersBorder: true },
  'openai/widgetDomain': 'https://widgets.acme.test',
};
const uiTool = (meta: Record<string, unknown> = {}, over: Record<string, unknown> = {}) =>
  tool({ name: 'show_board', outputSchema: { type: 'object' }, _meta: { ui: { resourceUri: URI }, 'openai/toolInvocation/invoking': 'Opening', ...meta }, ...over });

interface UiOpts { html?: string; meta?: Record<string, unknown>; mime?: string; listMime?: string; tools?: Record<string, unknown>[]; url?: string; set?: (s: Snapshot) => void }

function ui(o: UiOpts = {}): Snapshot {
  const meta = o.meta ?? GOOD_META;
  return snap({
    url: o.url,
    tools: o.tools ?? [uiTool()],
    resources: [{ uri: URI, name: 'board', mimeType: o.listMime ?? o.mime ?? MIME }],
    set: (s) => {
      s.resourceReads[URI] = { ok: true, durationMs: 5, raw: { contents: [{ uri: URI, mimeType: o.mime ?? MIME, text: o.html ?? GOOD_HTML, _meta: meta }] } };
      o.set?.(s);
    },
  });
}

const csp = (c: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ ...GOOD_META, ui: { ...GOOD_META.ui, csp: c }, ...extra });

const cases: Record<string, Case> = {
  'APPS-001': { pos: ui({ tools: [uiTool({ ui: { resourceUri: 'https://acme.test/w.html' } })] }), neg: ui(), severity: 'error' },
  'APPS-002': { pos: ui({ tools: [uiTool({ ui: {}, 'ui/resourceUri': URI })] }), neg: ui(), severity: 'warning' },
  'APPS-003': { pos: ui({ mime: 'text/html' }), neg: ui({ mime: 'text/html; profile=mcp-app' }), severity: 'error' },
  'APPS-004': { pos: ui({ html: 'just some text' }), neg: ui() },
  'APPS-005': { pos: ui({ meta: { ui: { prefersBorder: true }, 'openai/widgetDomain': 'https://w.acme.test' } }), neg: ui(), severity: 'error' },
  'APPS-006': { pos: ui({ meta: csp({ resourceDomains: ['https://cdn.acme.test', '*'], connectDomains: ['https://api.acme.test'] }) }), neg: ui() },
  'APPS-007': { pos: ui({ html: '<!doctype html><script src="https://evil-cdn.test/x.js"></script>' }), neg: ui(), severity: 'error' },
  'APPS-008': { pos: ui({ meta: csp({ ...GOOD_META.ui.csp, frameDomains: ['https://www.youtube.com'] }) }), neg: ui(), severity: 'warning' },
  'APPS-009': { pos: ui({ tools: [uiTool({ ui: { resourceUri: URI, csp: { connectDomains: [] } } })] }), neg: ui() },
  'APPS-010': { pos: ui({ tools: [uiTool({ ui: { resourceUri: URI, visibility: ['everyone'] } })] }), neg: ui(), severity: 'error' },
  'APPS-011': {
    pos: ui({ url: 'https://mcp.acme.test/mcp', meta: { ...GOOD_META, ui: { ...GOOD_META.ui, domain: `${'0'.repeat(32)}.claudemcpcontent.com` } } }),
    neg: ui({ url: 'https://mcp.acme.test/mcp', meta: { ...GOOD_META, ui: { ...GOOD_META.ui, domain: claudeUiDomain('https://mcp.acme.test/mcp') } } }),
    severity: 'error', match: /mismatch/,
  },
  'APPS-012': { pos: ui({ meta: { ui: GOOD_META.ui } }), neg: ui(), severity: 'error' },
  'APPS-013': {
    pos: ui({ html: `${GOOD_HTML}<script>app.openExternal({ url: "https://docs.acme.test/help" })</script>` }),
    neg: ui({ html: `${GOOD_HTML}<script>app.openExternal({ url: "https://docs.acme.test/help" })</script>`, meta: { ...GOOD_META, 'openai/widgetCSP': { redirect_domains: ['https://docs.acme.test'] } } }),
  },
  'APPS-014': {
    pos: ui({ html: '<!doctype html><script type="module">import { App } from "@modelcontextprotocol/ext-apps"; const app = new App();</script>' }),
    // the same import followed by connect() is the documented pattern
    neg: ui({ html: '<!doctype html><script type="module">import { App } from "@modelcontextprotocol/ext-apps"; const app = new App(); await app.connect();</script>' }),
  },
  'APPS-015': { pos: ui({ html: `${GOOD_HTML}<script>alert("hi")</script>` }), neg: ui({ html: `${GOOD_HTML}<script>dialog.prompt("x")</script>` }) },
  'APPS-016': { pos: ui({ html: `${GOOD_HTML}<script>localStorage.setItem("a","b")</script>` }), neg: ui(), severity: 'info' },
  'APPS-017': { pos: ui({ meta: { ...GOOD_META, ui: { ...GOOD_META.ui, prefersBorder: 'yes' } } }), neg: ui(), severity: 'error' },
  'APPS-018': { pos: ui({ tools: [uiTool({}, { outputSchema: undefined })] }), neg: ui() },
  // The UI tool is missing from a text-only client's list; the fallback keeps it (without _meta.ui).
  'APPS-019': {
    pos: ui({ set: (s) => { s.toolsWithoutUi = []; } }),
    neg: ui({ set: (s) => { s.toolsWithoutUi = [tool({ name: 'show_board' })]; } }),
    severity: 'warning', match: /io\.modelcontextprotocol\/ui/,
  },
};

describe('APPS rules', () => {
  it('has a case for every rule', () => expect(Object.keys(cases).sort()).toEqual(appsRules.map((r) => r.id).sort()));
  for (const rule of appsRules) it(`${rule.id} ${rule.title}`, () => checkCase(rule, cases[rule.id]));

  const byId = (id: string) => appsRules.find((r) => r.id === id)!;

  it('APPS-005 claude gets an info note; malformed CSP field is an error', () => {
    const none = evaluate(byId('APPS-005'), ui({ meta: { ui: { prefersBorder: true } } }));
    expect(none.find((f) => f.platforms.includes('claude'))?.severity).toBe('info');
    const bad = evaluate(byId('APPS-005'), ui({ meta: csp({ resourceDomains: 'https://cdn.acme.test' }) }));
    expect(bad.some((f) => f.severity === 'error' && /not string\[\]/.test(f.message))).toBe(true);
  });

  it('APPS-007 js-confidence origins are capped at warning', () => {
    const f = evaluate(byId('APPS-007'), ui({ html: '<!doctype html><script>fetch("https://other-api.test/x")</script>' }));
    expect(f[0].severity).toBe('warning');
  });

  it('APPS-011 stdio target cannot verify', () => {
    const f = evaluate(byId('APPS-011'), ui({ meta: { ...GOOD_META, ui: { ...GOOD_META.ui, domain: `${'a'.repeat(32)}.claudemcpcontent.com` } } }));
    expect(f[0].severity).toBe('info');
  });

  it('APPS-012 shared sandbox is a warning; Claude-format ui.domain adds a fix hint', () => {
    expect(evaluate(byId('APPS-012'), ui({ meta: { ...GOOD_META, 'openai/widgetDomain': 'https://web-sandbox.oaiusercontent.com' } }))[0].severity).toBe('warning');
    const f = evaluate(byId('APPS-012'), ui({ meta: { ui: { ...GOOD_META.ui, domain: `${'a'.repeat(32)}.claudemcpcontent.com` } } }));
    expect(f[0].fix).toMatch(/openai\/widgetDomain/);
  });

  it('APPS-010 deprecated openai/visibility is a chatgpt warning', () => {
    const f = evaluate(byId('APPS-010'), ui({ tools: [uiTool({ 'openai/visibility': 'public' })] }));
    expect(f).toMatchObject([{ severity: 'warning', platforms: ['chatgpt'] }]);
  });

  it('extractOrigins finds tag and js origins and ignores data/relative URLs', () => {
    const o = extractOrigins('<link rel="stylesheet" href="https://fonts.googleapis.com/css"><img src="data:image/png;base64,AAA"><img src="/local.png"><iframe src="https://www.youtube.com/embed/x"></iframe><script>new WebSocket("wss://rt.acme.test/ws")</script>');
    expect(o.map((x) => `${x.kind}:${x.origin}:${x.confidence}`)).toEqual([
      'resource:https://fonts.googleapis.com:tag', 'frame:https://www.youtube.com:tag', 'connect:wss://rt.acme.test:js',
    ]);
  });

  it('originMatches supports exact and wildcard entries', () => {
    expect(originMatches('https://a.acme.test', 'https://*.acme.test')).toBe(true);
    expect(originMatches('https://acme.test', 'https://*.acme.test')).toBe(false);
    expect(originMatches('https://api.acme.test:8443', 'https://api.acme.test')).toBe(false);
  });

  it('APPS-019 does not run without the text-only re-list (it failed or no tool links a UI)', () => {
    const rule = byId('APPS-019');
    expect(rule, 'APPS-019 is in the catalog').toBeDefined();
    expect(evaluate(rule, ui())).toEqual([]);
    // a UI tool that the text-only list keeps is not reported either
    expect(evaluate(rule, ui({ set: (s) => { s.toolsWithoutUi = [tool({ name: 'show_board' })]; } }))).toEqual([]);
  });

  it('extractOrigins and <img> checks stay linear on unterminated tags', () => {
    // 400 000 characters each: a quadratic scan takes seconds here (about 10 s per pass on the baseline).
    const tags = '<img'.repeat(100000);
    const t0 = performance.now();
    extractOrigins(tags);
    evaluate(byId('APPS-016'), ui({ html: tags }));
    evaluate(byId('APPS-014'), ui({ html: 'sendSizeChanged('.repeat(25000) }));
    expect(performance.now() - t0).toBeLessThan(2000);
  }, 180000);

  it('normalizeMime lowercases type and trims around ;', () => {
    expect(normalizeMime('Text/HTML ; profile=mcp-app')).toBe(MIME);
  });

  it('APPS-014 ignores ext-apps mentions in comments and accepts a hand-written ui/initialize handshake (Svelte)', () => {
    const rule = appsRules.find((r) => r.id === 'APPS-014')!;
    // Svelte's MCP-UI adapter: ext-apps appears only in a JSDoc comment and the adapter sends ui/initialize itself.
    const adapter = '<script>/**\n * MCP Apps SEP protocol methods (from @modelcontextprotocol/ext-apps):\n * - ui/notifications/tool-input\n */\nconst METHODS = { INITIALIZE: "ui/initialize" };\nsend(METHODS.INITIALIZE);</script>';
    expect(evaluate(rule, ui({ html: adapter }))).toEqual([]);
    // a comment-only mention without any handshake is not a use either
    expect(evaluate(rule, ui({ html: '<script>// built without @modelcontextprotocol/ext-apps\nrender();</script><!-- new App() is not used -->' }))).toEqual([]);
    // the App class used in code with neither connect() nor ui/initialize is still reported
    expect(evaluate(rule, ui({ html: '<script>/* widget */ const app = new App({ name: "x" }); app.render();</script>' }))).toHaveLength(1);
  });

  it('APPS-014 accepts a hand-written ui/initialize handshake when the App class is used in code without connect()', () => {
    const rule = appsRules.find((r) => r.id === 'APPS-014')!;
    const html = '<script>const app = new App({ name: "x" });\nwindow.parent.postMessage({ jsonrpc: "2.0", id: 1, method: \'ui/initialize\', params: {} }, "*");</script>';
    expect(evaluate(rule, ui({ html }))).toEqual([]);
  });
});
