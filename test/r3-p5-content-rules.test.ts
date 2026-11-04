// Review round 3, package P5 (1.0.1): content-rule false positives (A05-03, A05-04, A05-09) and quadratic regexes on
// server-controlled text (A09-01, A09-02, A09-03), plus a regex-complexity guard over every rule.
import { describe, expect, it } from 'vitest';
import { TOOL_015 } from '../src/rules/annotations.js';
import { RULES, runRules } from '../src/rules/index.js';
import { INJ_002, INJ_007, mixedScript, referencedIdentifiers } from '../src/rules/injection.js';
import { POL_003 } from '../src/rules/policy.js';
import { extractOrigins } from '../src/rules/util/html.js';
import { enumValues, resolvedNode, snakeCase } from '../src/rules/util/schemaWalk.js';
import { tokenize } from '../src/rules/util/text.js';
import { capSnapshot } from '../src/limits.js';
import { evaluate, snap, tool, toolWithProps } from './helpers.js';

const ms = (f: () => unknown): number => {
  const t0 = performance.now();
  f();
  return performance.now() - t0;
};

/** Deterministic pseudo-random strings over a small alphabet (xorshift). */
function randomStrings(alphabet: string, count: number, maxLen: number): string[] {
  let x = 0x9e3779b9;
  const next = () => ((x ^= x << 13), (x ^= x >>> 17), (x ^= x << 5), x >>> 0);
  return Array.from({ length: count }, () => Array.from({ length: next() % maxLen }, () => alphabet[next() % alphabet.length]).join(''));
}

describe('A05-03: INJ-007 own-tool exemption with "call the `own_tool`"', () => {
  const own = (description: string) => snap({ tools: [tool({ name: 'search_docs', description })], set: (s) => { s.serverInfo = { name: 'acme-docs', version: '1.0.0' }; } });

  it('the article is not captured as a referenced identifier', () => {
    expect(referencedIdentifiers('Always call the `search_docs` tool first.')).toEqual(['search_docs']);
    expect(referencedIdentifiers('Always use a `search_docs` tool first.')).toEqual(['search_docs']);
    expect(referencedIdentifiers('Always use the search tool first.')).toEqual(['search']);
  });

  for (const [style, q] of [['backtick', '`'], ['single quote', "'"], ['double quote', '"']]) {
    it(`A05-03 ${style}: a hint to call the server's own tool is exempt`, () => {
      const f = evaluate(INJ_007, own(`Search the Acme documentation and return matching pages. Always call the ${q}search_docs${q} tool first.`));
      expect(f.map((x) => x.message)).toEqual([]);
    });
  }

  it('a hint to call a tool the server does not have is still reported', () => {
    const f = evaluate(INJ_007, own('Search the Acme documentation. Always call the `web_search` tool first.'));
    expect(f).toHaveLength(1);
  });
});

describe('A05-04: TOOL-015 reads a property through its local $ref', () => {
  const lookup = (props: Record<string, unknown>, defs: Record<string, unknown> = {}) =>
    snap({ tools: [tool({ name: 'lookup_region', inputSchema: { type: 'object', properties: props, $defs: defs }, annotations: { readOnlyHint: true, openWorldHint: false } })] });

  it('A05-04 an enum kept in $defs (pydantic Enum, zod nativeEnum) is constrained', () => {
    const s = lookup({ host: { $ref: '#/$defs/Host', description: 'Region host' } }, { Host: { type: 'string', enum: ['eu.acme.example', 'us.acme.example'] } });
    expect(evaluate(TOOL_015, s)).toEqual([]);
  });

  it('A05-04 a chained ref, an anyOf of consts and an unresolved ref are not free-form', () => {
    expect(evaluate(TOOL_015, lookup({ host: { $ref: '#/$defs/A' } }, { A: { $ref: '#/$defs/B' }, B: { type: 'string', enum: ['a.example'] } }))).toEqual([]);
    expect(evaluate(TOOL_015, lookup({ host: { anyOf: [{ const: 'eu.acme.example' }, { const: 'us.acme.example' }] } }))).toEqual([]);
    expect(evaluate(TOOL_015, lookup({ host: { $ref: 'https://schemas.acme.example/host.json' } }))).toEqual([]);
    expect(evaluate(TOOL_015, lookup({ host: { $ref: '#/$defs/Port' } }, { Port: { type: 'integer' } }))).toEqual([]);
  });

  it('an anyOf with a free string branch, inline or through a ref, is still free-form (review P5 enumValues)', () => {
    const mixed = { anyOf: [{ const: 'auto' }, { type: 'string' }] };
    expect(evaluate(TOOL_015, lookup({ host: mixed }))).toHaveLength(1);
    expect(evaluate(TOOL_015, lookup({ host: { $ref: '#/$defs/H' } }, { H: mixed }))).toHaveLength(1);
    expect(enumValues(mixed)).toBeUndefined();
    expect(enumValues({ oneOf: [{ enum: ['a'] }, {}] })).toBeUndefined();
    expect(enumValues({ anyOf: [{ enum: ['a', 'b'] }, { type: 'null' }] })).toEqual(['a', 'b']);
    expect(evaluate(TOOL_015, lookup({ host: { anyOf: [{ enum: ['eu.acme.example'] }, { type: 'null' }] } }))).toEqual([]);
  });

  it('a free-form host, inline or through a ref to a plain string, is still reported', () => {
    expect(evaluate(TOOL_015, lookup({ host: { type: 'string' } }))).toHaveLength(1);
    expect(evaluate(TOOL_015, lookup({ host: { $ref: '#/$defs/Host' } }, { Host: { type: 'string' } }))).toHaveLength(1);
  });

  it('resolvedNode lets the node override its target and stops on a ref cycle; enumValues reads const lists', () => {
    const root = { $defs: { A: { $ref: '#/$defs/B', type: 'string' }, B: { $ref: '#/$defs/A', enum: ['x'] } } };
    const r = resolvedNode(root, { $ref: '#/$defs/A', description: 'd' });
    expect(r.unresolved).toBe(false);
    expect(r.node).toMatchObject({ type: 'string', enum: ['x'], description: 'd' });
    expect(enumValues({ oneOf: [{ const: 1 }, { enum: [2, 3] }] })).toEqual([1, 2, 3]);
    expect(enumValues({ type: 'string' })).toBeUndefined();
  });
});

describe('A05-09: INJ-002 and biomedical Greek notation', () => {
  it('A05-09 gene, receptor and cytokine names are not homoglyphs', () => {
    for (const w of ['TNFα', 'NFκB', 'PPARγ', 'ERα', 'IFNγ', 'IκBα', 'Kγ']) expect(mixedScript(w), w).toBe(false);
  });

  it('Greek letters swapped into a same-case word, uppercase Greek and Cyrillic are still mixed-script', () => {
    for (const w of ['pαypal', 'gοοgle', 'PΑYPAL', 'Tοken', 'pаypal', 'NFκBа']) expect(mixedScript(w), w).toBe(true);
  });

  it('the notation test is linear on Latin capitals with a long Greek run that fails at the end (review P5 GREEK_NOTATION)', () => {
    const word = 'A' + 'α'.repeat(5000) + 'b';
    expect(ms(() => expect(mixedScript(word)).toBe(true))).toBeLessThan(200);
    expect(mixedScript('A' + 'α'.repeat(30) + 'B')).toBe(false);
    const s = snap({ tools: [tool({ name: 'search_pubmed', description: `Search PubMed abstracts for A${'α'.repeat(30)}b signaling.` })] });
    expect(ms(() => expect(evaluate(INJ_002, s)).toHaveLength(1))).toBeLessThan(500);
  });

  it('A05-09 a PubMed tool description gets no INJ-002 warning', () => {
    const s = snap({ tools: [tool({ name: 'search_pubmed', description: 'Search PubMed abstracts, for example papers on TNFα or NFκB signaling, and return titles with PMIDs.' })] });
    expect(evaluate(INJ_002, s)).toEqual([]);
  });
});

describe('A09-01: snakeCase and tokenize are linear on long uppercase runs', () => {
  const oldSnake = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').replace(/[\s\-.]+/g, '_').toLowerCase();
  const oldTokenize = (name: string) => name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2').split(/[_\-.\s/:]+/).filter(Boolean).map((s) => s.toLowerCase());

  it('A09-01 output is unchanged on random names', () => {
    for (const s of randomStrings('AaBb0_ -.Z', 20000, 24)) {
      expect(snakeCase(s), s).toBe(oldSnake(s));
      expect(tokenize(s), s).toEqual(oldTokenize(s));
    }
    expect(snakeCase('HTTPServerError')).toBe('http_server_error');
    expect(tokenize('getHTTPResponse')).toEqual(['get', 'http', 'response']);
  });

  it('A09-01 a 1 MB run of capitals takes milliseconds', () => {
    const big = 'A'.repeat(1024 * 1024);
    expect(ms(() => snakeCase(big))).toBeLessThan(1000);
    expect(ms(() => tokenize(big))).toBeLessThan(1000);
  });
});

describe('A09-02: POL-003 ADS regex is linear on digit runs', () => {
  const desc = (description: string) => snap({ tools: [tool({ description })] });

  it('A09-02 "N% off!" is still reported, at the same position', () => {
    for (const [text, hit] of [['Get 50% off!', '50% off!'], ['save 5% off! now', '5% off'], ['a50% off!', '50% off!'], ['x100% off!', '100% off!']]) {
      const f = evaluate(POL_003, desc(`Search the Acme notes. ${text}`));
      expect(f, text).toHaveLength(1);
      expect(f[0].message, text).toContain(hit);
    }
  });

  it('A09-02 a tool name of 1 MB of digits takes well under a second', () => {
    const s = snap({ tools: [tool({ name: '0'.repeat(1024 * 1024) })] });
    expect(ms(() => evaluate(POL_003, s))).toBeLessThan(1000);
  });
});

describe('A09-03: extractOrigins CSS url() scan', () => {
  const OLD = /(?<![\w$.]|\bnew\s+)url\(\s*["']?([^"')\s]+)["']?\s*\)/gi;
  const oldCss = (html: string) => [...html.matchAll(OLD)].map((m) => m[1]);
  const cssOrigins = (html: string) => extractOrigins(html).map((o) => o.origin);

  it('A09-03 finds exactly what the old regex found, on random and hand-written input', () => {
    const alphabet = ['url(', 'URL(', 'new ', 'x.', ' ', '"', "'", ')', '(', 'https://a.example/', 'b', '\n'];
    let x = 7;
    const next = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff), x);
    for (let n = 0; n < 5000; n++) {
      const html = Array.from({ length: next() % 14 }, () => alphabet[next() % alphabet.length]).join('');
      const want = [...new Set(oldCss(html).map((v) => { try { return /^https?:\/\//i.test(v) ? new URL(v).origin : undefined; } catch { return undefined; } }).filter(Boolean))];
      expect(cssOrigins(html), JSON.stringify(html)).toEqual(want);
    }
    expect(cssOrigins('<div style="background:url( \'https://d.example.com/y.png\' )"></div>')).toEqual(['https://d.example.com']);
    expect(cssOrigins('<script>new URL("https://api.example.com")</script>')).toEqual([]);
  });

  it('A09-03 2 MB of unterminated url( takes well under a second', () => {
    for (const unit of ['url(', 'url("', "url('", 'url("url(']) {
      const html = unit.repeat(Math.floor((2 * 1024 * 1024) / unit.length));
      expect(ms(() => extractOrigins(html)), unit).toBeLessThan(1000);
    }
  });

  it('the cache keeps a scan per resource, so two resources scanned in turn are not rescanned', () => {
    const a = '<img src="https://a.example.com/a.png">';
    const b = '<img src="https://b.example.com/b.png">';
    expect(extractOrigins(a).map((o) => o.origin)).toEqual(['https://a.example.com']);
    expect(extractOrigins(b).map((o) => o.origin)).toEqual(['https://b.example.com']);
    const big = `<img src="https://c.example.com/c.png">${'url('.repeat(200_000)}`;
    extractOrigins(big);
    extractOrigins(a);
    expect(ms(() => extractOrigins(big))).toBeLessThan(5);
    expect(extractOrigins(a).map((o) => o.origin)).toEqual(['https://a.example.com']);
  });

  it('A09-03 the result is cached per HTML and callers cannot corrupt it', () => {
    const html = '<img src="https://img.example.com/a.png">';
    const a = extractOrigins(html);
    a.length = 0;
    expect(extractOrigins(html).map((o) => o.origin)).toEqual(['https://img.example.com']);
  });
});

describe('regex-complexity guard: every rule over large server-controlled fields', () => {
  const SIZE = 200 * 1024;
  const UNITS = ['A', '0', 'a', 'Aa', 'A0', '-', '_', ' ', '.', '/', '%', 'url(', '<a ', '<!--', '<system', '`', '"', "'", '(', '{{', '${', 'https://', 'http://a', 'а', 'α', 'A' + 'α'.repeat(30) + 'b', 'A' + 'α'.repeat(30) + 'b ', 'call ', 'use the ', 'always ', '0% off', '\\', '​'];

  for (const unit of UNITS) {
    it(`unit ${JSON.stringify(unit)} in every field runs all rules in under 5 s`, () => {
      const big = unit.repeat(Math.ceil(SIZE / unit.length));
      const uiUri = 'ui://acme/board.html';
      const s = snap({
        tools: [
          toolWithProps(big, { [big]: { type: 'string', description: big }, host: { type: 'string', description: big } }, { title: big, description: big, annotations: { title: big, readOnlyHint: true, openWorldHint: false } }),
          tool({ name: 'show_board', description: big, _meta: { ui: { resourceUri: uiUri } } }),
        ],
        resources: [{ uri: uiUri, name: big, description: big, mimeType: 'text/html;profile=mcp-app' }, { uri: `file:///${big}`, name: 'r', description: big }],
        prompts: [{ name: big, description: big, arguments: [{ name: big, description: big }] }],
        set: (x) => {
          x.resourceTemplates = [{ uriTemplate: `acme://${big}/{id}`, name: big, description: big }];
          x.instructions = big;
          x.resourceReads[uiUri] = { ok: true, durationMs: 1, raw: { contents: [{ uri: uiUri, mimeType: 'text/html;profile=mcp-app', text: big.repeat(4) }] } };
        },
      });
      capSnapshot(s);
      const t = ms(() => runRules(s, RULES));
      expect(t, `all rules on ${JSON.stringify(unit)}`).toBeLessThan(5000);
    });
  }
});
