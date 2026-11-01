// Regression tests for the WP5-apps remediation package (review 2026-11-01): APPS rules and the ui/html helpers.
import { describe, expect, it } from 'vitest';
import { APPS_006, APPS_007 } from '../src/rules/apps.js';
import { extractOrigins } from '../src/rules/util/html.js';
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
