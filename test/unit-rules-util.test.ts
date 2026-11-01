// Unit tests for src/rules/util/access.ts and src/rules/util/ui.ts: accessors over raw payloads and the UI resource view (F156).
import { describe, expect, it } from 'vitest';
import {
  annotations, hasUi, hostOf, isNonEmptyStr, isObj, isStrArray, listPreview, plural, properties, toolName, uiUriOf,
} from '../src/rules/util/access.js';
import { cspOf, decodeItem, uiResources } from '../src/rules/util/ui.js';
import { snap, tool } from './helpers.js';

describe('access', () => {
  it('type guards reject the near misses a hostile payload sends', () => {
    expect([isObj({}), isObj([]), isObj(null), isObj('x')]).toEqual([true, false, false, false]);
    expect([isNonEmptyStr(' a '), isNonEmptyStr('  '), isNonEmptyStr(1)]).toEqual([true, false, false]);
    expect([isStrArray([]), isStrArray(['a']), isStrArray(['a', 1]), isStrArray('a')]).toEqual([true, true, false, false]);
  });

  it('toolName, annotations and properties tolerate malformed tools', () => {
    expect(toolName({ name: 42 })).toBe('42');
    expect(annotations({ annotations: [] })).toEqual({});
    expect(properties({ properties: { a: {} } })).toEqual({ a: {} });
    expect(properties({ properties: ['a'] })).toEqual({});
  });

  it('uiUriOf prefers _meta.ui.resourceUri, then ui/resourceUri, then openai/outputTemplate', () => {
    expect(uiUriOf({ _meta: { ui: { resourceUri: 'ui://a' }, 'ui/resourceUri': 'ui://b', 'openai/outputTemplate': 'ui://c' } })).toBe('ui://a');
    expect(uiUriOf({ _meta: { 'ui/resourceUri': 'ui://b', 'openai/outputTemplate': 'ui://c' } })).toBe('ui://b');
    expect(uiUriOf({ _meta: { 'openai/outputTemplate': 'ui://c' } })).toBe('ui://c');
    expect(uiUriOf({ _meta: 'x' })).toBeUndefined();
  });

  it('hasUi is true for a UI tool or a listed ui:// resource; hostOf is lower-cased and HTTP only', () => {
    expect(hasUi(snap())).toBe(false);
    expect(hasUi(snap({ resources: [{ uri: 'ui://w' }] }))).toBe(true);
    expect(hostOf(snap({ url: 'https://MCP.Acme.test/mcp' }))).toBe('mcp.acme.test');
    expect(hostOf(snap())).toBeUndefined();
  });

  it('plural and listPreview', () => {
    expect([plural(1, 'tool'), plural(0, 'tool'), plural(2, 'tool')]).toEqual(['1 tool', '0 tools', '2 tools']);
    expect(listPreview(['a', 'b', 'c'])).toBe('a, b, c');
    expect(listPreview(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c, +2 more');
  });
});

describe('ui', () => {
  it('decodeItem reads text, then a base64 blob', () => {
    expect(decodeItem({ text: '<p>' })).toBe('<p>');
    expect(decodeItem({ blob: Buffer.from('<b>é</b>').toString('base64') })).toBe('<b>é</b>');
    expect(decodeItem({})).toBeUndefined();
    expect(decodeItem(undefined)).toBeUndefined();
  });

  it('uiResources joins tools, the list entry and the read; the item _meta wins over the list entry', () => {
    const s = snap({
      tools: [tool({ name: 'a', _meta: { ui: { resourceUri: 'ui://w' } } }), tool({ name: 'b', _meta: { 'openai/outputTemplate': 'ui://w' } })],
      resources: [{ uri: 'ui://w', _meta: { ui: { prefersBorder: false } } }],
      set: (x) => { x.resourceReads['ui://w'] = { ok: true, durationMs: 1, raw: { contents: [{ uri: 'ui://w', text: '<html>', _meta: { ui: { prefersBorder: true } } }] } }; },
    });
    const [r] = uiResources(s);
    expect(r).toMatchObject({ uri: 'ui://w', tools: ['a', 'b'], html: '<html>', ui: { prefersBorder: true } });
    expect(r.itemUriMismatch).toBeUndefined();
  });

  it('a read whose only text/html item has another uri is still used, flagged as a mismatch; no read falls back to the list _meta', () => {
    const mismatch = snap({
      tools: [tool({ name: 'a', _meta: { ui: { resourceUri: 'ui://w' } } })],
      set: (x) => { x.resourceReads['ui://w'] = { ok: true, durationMs: 1, raw: { contents: [{ uri: 'ui://other', mimeType: 'text/html;profile=mcp-app', text: 'x' }] } }; },
    });
    expect(uiResources(mismatch)[0]).toMatchObject({ itemUriMismatch: true, html: 'x' });
    const unread = uiResources(snap({ resources: [{ uri: 'ui://v', _meta: { ui: { domain: 'd' } } }] }))[0];
    expect(unread).toMatchObject({ uri: 'ui://v', tools: [], ui: { domain: 'd' } });
    expect(unread.html).toBeUndefined();
  });

  it('cspOf merges ui.csp and openai/widgetCSP, flags malformed fields and suggests a near-miss spelling', () => {
    const v = cspOf({
      uri: 'ui://w', tools: [], ui: { csp: { connectDomains: ['https://api.test'], resourceDomains: 'https://cdn.test', connect_domains: [] } },
      meta: { 'openai/widgetCSP': { resource_domains: ['https://img.test'], redirect_domains: ['https://r.test'] } },
    });
    expect(v.declared).toBe(true);
    expect(v.connect).toEqual(['https://api.test']);
    expect(v.resource).toEqual(['https://img.test']);
    expect(v.redirect).toEqual(['https://r.test']);
    expect(v.malformed).toEqual(['ui.csp.resourceDomains']);
    expect(v.unknown).toEqual([{ field: 'ui.csp.connect_domains', suggestion: 'connectDomains' }]);
    expect(v.entries).toContainEqual({ field: 'redirect_domains', value: 'https://r.test', list: 'redirect' });
    expect(cspOf({ uri: 'ui://w', tools: [], ui: {}, meta: {} }).declared).toBe(false);
  });
});
