// Regression tests for the WP5-apps remediation package (review 2026-11-01): APPS rules and the ui/html helpers.
import { describe, expect, it } from 'vitest';
import { APPS_001, APPS_003, APPS_005, APPS_006, APPS_007, APPS_012, APPS_013, APPS_015, APPS_016, APPS_017, APPS_019, normalizeMime } from '../src/rules/apps.js';
import { extractLinks, extractOrigins } from '../src/rules/util/html.js';
import { POL_004 } from '../src/rules/policy.js';
import type { Snapshot } from '../src/snapshot.js';
import { evaluate, snap, tool } from './helpers.js';

const URI = 'ui://acme/board.html';
const MIME = 'text/html;profile=mcp-app';
const META = {
  ui: { csp: { resourceDomains: ['https://cdn.acme.test'], connectDomains: ['https://api.acme.test'] }, prefersBorder: true },
  'openai/widgetDomain': 'https://widgets.acme.test',
};
const uiTool = (meta: Record<string, unknown> = {}) =>
  tool({ name: 'show_board', outputSchema: { type: 'object' }, _meta: { ui: { resourceUri: URI }, ...meta } });

interface UiOpts { html?: string; meta?: Record<string, unknown>; mime?: string; itemUri?: string; extraItems?: unknown[]; url?: string; set?: (s: Snapshot) => void }

function ui(o: UiOpts = {}): Snapshot {
  return snap({
    url: o.url,
    tools: [uiTool()],
    resources: [{ uri: URI, name: 'board', mimeType: MIME }],
    set: (s) => {
      const item = { uri: o.itemUri ?? URI, mimeType: o.mime ?? MIME, text: o.html ?? '<!doctype html><p>hi</p>', _meta: o.meta ?? META };
      s.resourceReads[URI] = { ok: true, durationMs: 5, raw: { contents: [item, ...(o.extraItems ?? [])] } };
      o.set?.(s);
    },
  });
}

const csp = (c: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ ...META, ui: { ...META.ui, csp: c }, ...extra });
const messages = (fs: Array<{ message: string }>) => fs.map((f) => f.message);

describe('F084: the JS URL constructor is not a CSS url()', () => {
  it('new URL("https://...") yields no resource origin; CSS url() still does in any case', () => {
    const o = extractOrigins('<script>const u = new URL("https://api.example.com/v1"); fetch(u)</script><style>.a{background:URL("https://img.example.com/a.png")}</style><div style="background:url(https://d.example.com/y.png)"></div>');
    expect(o.map((x) => `${x.kind} ${x.origin}`)).toEqual(['resource https://img.example.com', 'resource https://d.example.com']);
  });

  it('APPS-007 raises no resource error for a URL object built from a connectDomains origin', () => {
    const s = ui({ html: '<!doctype html><script>const u = new URL("https://api.acme.test/v1"); fetch(u)</script>' });
    expect(messages(evaluate(APPS_007, s))).toEqual([]);
  });
});

describe('R032: wildcards on multi-label public suffixes and shared cloud hosts are overly broad', () => {
  const broad = (entry: string) => messages(evaluate(APPS_006, ui({ meta: csp({ resourceDomains: [entry] }) })));

  it.each(['https://*.co.uk', 'https://*.com.au', 'https://*.cloudfront.net', 'https://*.amazonaws.com', 'https://*.com', 'https://*.vercel.app'])('%s', (entry) => {
    expect(broad(entry)).toEqual([`resourceDomains: "${entry}" is overly broad`]);
  });

  it('a wildcard under an owned domain stays narrow, also under a multi-label suffix', () => {
    expect(broad('https://*.acme.co.uk')).toEqual([]);
    expect(broad('https://*.acme.test')).toEqual([]);
    expect(broad('https://*.mybucket.s3.amazonaws.com')).toEqual([]);
  });
});

describe('F101: ES module imports and import maps are resource origins', () => {
  it('static, side-effect, re-export and dynamic imports from absolute URLs', () => {
    const o = extractOrigins(`<script type="module">
      import { App } from "https://esm.sh/@modelcontextprotocol/ext-apps";
      import 'https://cdn.skypack.dev/side-effect';
      export * from "https://ga.jspm.io/npm:x";
      const m = await import("https://unpkg.com/lit");
      import { local } from "./local.js";
      export const docs = "https://docs.example.com";
    </script>`);
    expect(o.map((x) => `${x.kind} ${x.origin} ${x.confidence}`)).toEqual([
      'resource https://esm.sh js', 'resource https://cdn.skypack.dev js', 'resource https://ga.jspm.io js', 'resource https://unpkg.com js',
    ]);
  });

  it('import map targets in imports and scopes; a broken map is skipped', () => {
    const o = extractOrigins('<script type="importmap">{"imports":{"ext-apps":"https://esm.sh/@modelcontextprotocol/ext-apps","rel":"./x.js"},"scopes":{"/a/":{"b":"https://cdn.jsdelivr.net/b.js"}}}</script><script type="importmap">{broken</script>');
    expect(o.map((x) => `${x.kind} ${x.origin}`)).toEqual(['resource https://esm.sh', 'resource https://cdn.jsdelivr.net']);
  });

  it('APPS-007 reports an undeclared module origin at warning (js confidence)', () => {
    const f = evaluate(APPS_007, ui({ html: '<!doctype html><script type="module">import { App } from "https://esm.sh/@modelcontextprotocol/ext-apps";</script>' }));
    expect(f.map((x) => [x.severity, x.message])).toEqual([['warning', 'resource origin https://esm.sh is not declared in the CSP']]);
  });
});

describe('F099: extractLinks takes hrefs of <a> and <area> only', () => {
  it('stylesheet, icon and base hrefs are not links', () => {
    const html = '<base href="https://acme.test/"><link rel="stylesheet" href="https://cdn.example.com/css/pricing.css"><link rel="icon" href="/billing.ico">'
      + '<a class="x" href="https://acme.test/upgrade">Upgrade</a><map><area shape="rect" href=\'https://acme.test/checkout\'></map><a href="{{base}}/billing">t</a>';
    expect(extractLinks(html)).toEqual(['https://acme.test/upgrade', 'https://acme.test/checkout']);
  });

  it('POL-004 no longer reads a pricing.css stylesheet as an upsell link', () => {
    const f = evaluate(POL_004, ui({ html: '<!doctype html><link rel="stylesheet" href="https://cdn.acme.test/css/pricing.css"><p>board</p>' }));
    expect(messages(f)).toEqual([]);
  });
});

describe('R041: the shared ChatGPT sandbox is recognised in any case', () => {
  it.each(['https://web-sandbox.oaiusercontent.com', 'HTTPS://WEB-SANDBOX.OAIUSERCONTENT.COM', 'https://Web-Sandbox.OaiUserContent.com'])('%s', (d) => {
    const f = evaluate(APPS_012, ui({ meta: { ...META, 'openai/widgetDomain': d } }));
    expect(f.map((x) => [x.severity, x.message])).toEqual([['warning', 'widget domain is the shared default sandbox (not unique)']]);
  });
});

describe('R030: a read item under a different uri is still the widget', () => {
  const html = '<!doctype html><script src="https://evil.example/x.js"></script>';

  it('the only item is checked: APPS-001 names its uri, APPS-005/012 read its _meta, APPS-007 sees its HTML', () => {
    const s = ui({ itemUri: `${URI}?v=2`, html });
    expect(messages(evaluate(APPS_001, s))).toEqual([`resources/read returned no content item with a matching uri (the item has uri "${URI}?v=2"; its content is checked as the widget)`]);
    expect(messages(evaluate(APPS_005, s))).toEqual([]);
    expect(messages(evaluate(APPS_012, s))).toEqual([]);
    expect(messages(evaluate(APPS_007, s))).toEqual(['resource origin https://evil.example is not declared in the CSP']);
  });

  it('with several items the single text/html one is used; with two HTML items none is guessed', () => {
    const extra = { uri: 'ui://acme/data.json', mimeType: 'application/json', text: '{}' };
    expect(messages(evaluate(APPS_007, ui({ itemUri: 'ui://other', html, extraItems: [extra] })))).toHaveLength(1);
    const twoHtml = ui({ itemUri: 'ui://other', html, extraItems: [{ uri: 'ui://b', mimeType: MIME, text: html }] });
    expect(messages(evaluate(APPS_001, twoHtml))).toEqual(['resources/read returned no content item with a matching uri']);
    expect(messages(evaluate(APPS_007, twoHtml))).toEqual([]);
  });
});

describe('R042: APPS-017 names a _meta.ui that is not an object', () => {
  it.each([['csp-here', 'a string'], [[], 'an array'], [null, 'a null'], [3, 'a number']])('%j', (value, what) => {
    const f = evaluate(APPS_017, ui({ meta: { ui: value, 'openai/widgetDomain': 'https://widgets.acme.test' } }));
    expect(f.map((x) => [x.severity, x.message])).toEqual([['error', `_meta.ui is ${what}, not an object`]]);
  });

  it('an absent _meta.ui keeps the prefersBorder hint', () => {
    expect(messages(evaluate(APPS_017, ui({ meta: { 'openai/widgetDomain': 'https://widgets.acme.test' } })))).toEqual(['prefersBorder is not set (explicit value recommended)']);
  });
});

describe('APPS-006 entry checks (R033, R034, R035, R043, F106)', () => {
  const run = (c: Record<string, unknown>, extra: Record<string, unknown> = {}) => evaluate(APPS_006, ui({ meta: csp(c, extra) }));

  it('R033: unencrypted ws:// to a public host is flagged like http://; loopback is not', () => {
    expect(messages(run({ connectDomains: ['ws://realtime.example.com', 'ws://localhost:8080'] })).sort()).toEqual([
      'connectDomains: "ws://localhost:8080" names localhost or a private IP',
      'connectDomains: "ws://realtime.example.com" uses ws://',
    ]);
  });

  it('R034: a wildcard that is not the leftmost label is invalid; data: and blob: are scheme sources', () => {
    expect(messages(run({ resourceDomains: ['https://api.*.example.com', 'https://*.example.*', 'data:', 'blob:'] })).sort()).toEqual([
      'resourceDomains: "blob:" is a scheme source (any blob: URL), not an origin',
      'resourceDomains: "data:" is a scheme source (any data: URL), not an origin',
      'resourceDomains: "https://*.example.*" has a wildcard outside the leftmost host label (only https://*.example.com is valid)',
      'resourceDomains: "https://api.*.example.com" has a wildcard outside the leftmost host label (only https://*.example.com is valid)',
    ]);
  });

  it('R035: a scheme-less host gets one APPS-006 finding and counts as declared for APPS-007', () => {
    const meta = csp({ connectDomains: ['api.acme.test'] });
    expect(messages(evaluate(APPS_006, ui({ meta })))).toEqual(['connectDomains: "api.acme.test" has no scheme; write https://api.acme.test']);
    const html = '<!doctype html><script>fetch("https://api.acme.test/v1"); new WebSocket("wss://api.acme.test/ws"); fetch("http://api.acme.test/x")</script>';
    expect(messages(evaluate(APPS_007, ui({ meta, html })))).toEqual(['connect origin http://api.acme.test is not declared in the CSP']);
  });

  it('R043: entry problems are chatgpt/spec findings and only the CDN hint is Claude info', () => {
    const f = run({ resourceDomains: ['https://unpkg.com', 'https://cdn.acme.test/'] });
    expect(f.map((x) => [x.platforms, x.severityByPlatform, x.message])).toEqual([
      [['chatgpt', 'spec'], { chatgpt: 'warning', spec: 'warning' }, 'resourceDomains: "https://cdn.acme.test/" has a path, query, fragment or trailing slash'],
      [['claude'], { claude: 'info' }, 'resourceDomains: public CDN unpkg.com; serve from your own origin in production'],
    ]);
    expect(APPS_006.severity).toEqual({ chatgpt: 'warning', claude: 'info', spec: 'warning' });
  });

  it('F106: one entry repeated in ui.csp and openai/widgetCSP is reported once, naming both fields', () => {
    const f = run({ connectDomains: ['https://api.example.com/'] }, { 'openai/widgetCSP': { connect_domains: ['https://api.example.com/'], resource_domains: ['https://api.example.com/'] } });
    expect(messages(f)).toEqual([
      'connectDomains/connect_domains: "https://api.example.com/" has a path, query, fragment or trailing slash',
      'resource_domains: "https://api.example.com/" has a path, query, fragment or trailing slash',
    ]);
  });
});

describe('APPS-015 blocked browser APIs (R037, F108)', () => {
  const run = (script: string, meta: Record<string, unknown> = META) => messages(evaluate(APPS_015, ui({ meta, html: `<!doctype html><script>${script}</script>` })));
  const withClipboard = { ...META, ui: { ...META.ui, permissions: { clipboardWrite: {} } } };

  it('R037: a clipboard write with the declared clipboardWrite permission passes; a read still does not', () => {
    expect(run('navigator.clipboard.writeText(x)', withClipboard)).toEqual([]);
    expect(run('navigator.clipboard.writeText(x)')).toEqual(['uses blocked browser API: navigator.clipboard.writeText']);
    expect(run('navigator.clipboard.readText()', withClipboard)).toEqual(['uses blocked browser API: navigator.clipboard.readText']);
  });

  it('R037: a dialog named only in a comment is not a use', () => {
    expect(run('// never use alert() here\n/* confirm("x") */ render()')).toEqual([]);
  });

  it('F108: the widget\'s own prompt/confirm/alert functions and parameters are not browser dialogs', () => {
    expect(run('const prompt = (q) => q; prompt("x");')).toEqual([]);
    expect(run('function confirm(msg) { return show(msg) } confirm("delete?")')).toEqual([]);
    expect(run('const ask = (prompt) => prompt("x");')).toEqual([]);
    expect(run('function run(alert) { alert("x") }')).toEqual([]);
  });

  it('F108: browser dialogs are still found, also window.prompt beside an own prompt', () => {
    expect(run('if (x) alert("hi")')).toEqual(['uses blocked browser API: alert(']);
    expect(run('const prompt = (q) => q; window.prompt("x")')).toEqual(['uses blocked browser API: window.prompt(']);
    expect(run('console.log(confirm); confirm("sure?")')).toEqual(['uses blocked browser API: confirm(']);
  });
});

describe('R040: APPS-016 trackers and alt text', () => {
  const run = (html: string) => messages(evaluate(APPS_016, ui({ html: `<!doctype html>${html}` })));

  it('Google Tag Manager and Google Analytics are trackers', () => {
    expect(run('<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>')).toEqual(['ad or tracker origins: googletagmanager.com']);
    expect(run('<script src="https://www.google-analytics.com/analytics.js"></script>')).toEqual(['ad or tracker origins: google-analytics.com']);
  });

  it('data-alt is not alt text; a real alt attribute is', () => {
    expect(run('<img src="x.png" data-alt="y">')).toEqual(['<img> without alt']);
    expect(run('<img data-alt="y" src="x.png" alt="logo"><img alt="" src="z.png">')).toEqual([]);
  });
});

describe('F107: quoted MIME parameter values', () => {
  it('normalizeMime unquotes values and trims around =', () => {
    expect(normalizeMime('text/html; profile="mcp-app"')).toBe(MIME);
    expect(normalizeMime('TEXT/HTML;Profile = "mcp-app"')).toBe(MIME);
    expect(normalizeMime('text/html;profile="mcp\\-app"')).toBe(MIME);
    expect(normalizeMime('text/html;profile="other"')).toBe('text/html;profile=other');
  });

  it('APPS-003 accepts profile="mcp-app" in resources/read and resources/list', () => {
    expect(messages(evaluate(APPS_003, ui({ mime: 'text/html; profile="mcp-app"' })))).toEqual([]);
  });
});

describe('R038: APPS-019 leaves tools that a fresh full-capability connection lacks too', () => {
  const tools = [uiTool(), tool({ name: 'search_notes', _meta: { ui: { resourceUri: URI } } })];
  const run = (fresh?: string[]) => messages(evaluate(APPS_019, snap({
    tools, resources: [{ uri: URI, name: 'board', mimeType: MIME }],
    set: (s) => { s.toolsWithoutUi = []; if (fresh) s.toolsFreshConnection = fresh; },
  })));

  it('only tools present on the fresh connection are attributed to the UI extension', () => {
    expect(run(['show_board'])).toEqual(['listed only for clients that declare io.modelcontextprotocol/ui; a text-only client\'s tools/list omits it']);
    expect(run()).toHaveLength(2);
  });
});
