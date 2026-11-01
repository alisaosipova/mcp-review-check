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
