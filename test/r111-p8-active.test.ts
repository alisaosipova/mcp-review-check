// Block P8 of release 1.2.0 (review 2026-11-05, area A03): the --active calls on a 2026-07-28 server carry the
// Mcp-Param-{Name} headers and the spec's =?base64?...?= encoding (A03-01, A03-03), the --tool-args "not used" warning
// names the real reason (A03-04), the name filter knows more write verbs and splits on any separator (I-A03-1), and the
// clientInfo variants land in the result as each one finishes (I-A03-3). Local fixtures only.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSnapshot } from '../src/connect.js';
import { activeSkipReason, isSafeToCall, runActive, writeVerbOf } from '../src/probe/active.js';
import { encodeHeaderValue, mcpNameOf, mcpParamHeaders } from '../src/protocol/modern.js';
import { runRules } from '../src/rules/engine.js';
import { RT_003 } from '../src/rules/runtime.js';
import { emptySnapshot, type Snapshot } from '../src/snapshot.js';
import { BAD, cli, ROOT } from './cli-runner.js';
import { startModernServer } from './fixtures/modern-server.js';
import type { Started } from './fixtures/http-bridge.js';

const started: Started[] = [];
afterEach(async () => { await Promise.all(started.splice(0).map((s) => s.close())); });

const readOnly = (name: string, extra: Record<string, unknown> = {}) => ({ name, annotations: { readOnlyHint: true, ...extra } });

async function activeModern(): Promise<Snapshot> {
  const s = await startModernServer({ headerTools: true });
  started.push(s);
  const { snap } = await buildSnapshot({ target: { kind: 'http', url: s.url }, timeoutMs: 20000, active: true });
  return snap;
}

describe('A03-01 / A03-03: header encoding on a 2026-07-28 server', () => {
  it('encodes values as the spec table does', () => {
    expect(encodeHeaderValue('us-west1')).toBe('us-west1');
    expect(encodeHeaderValue('Hello, \u4e16\u754c')).toBe('=?base64?SGVsbG8sIOS4lueVjA==?=');
    expect(encodeHeaderValue(' padded ')).toBe('=?base64?IHBhZGRlZCA=?=');
    expect(encodeHeaderValue('line1\nline2')).toBe('=?base64?bGluZTEKbGluZTI=?=');
    expect(encodeHeaderValue('=?base64?literal?=')).toBe('=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?=');
    expect(encodeHeaderValue('a\tb')).toBe(`=?base64?${Buffer.from('a\tb').toString('base64')}?=`);
    expect(encodeHeaderValue('a b')).toBe('a b');
  });

  it('Mcp-Name uses the base64 form for a non-ASCII name or URI, not percent-encoding', () => {
    expect(mcpNameOf('tools/call', { name: 'm\u00e9t\u00e9o' })).toBe(`=?base64?${Buffer.from('m\u00e9t\u00e9o').toString('base64')}?=`);
    expect(mcpNameOf('resources/read', { uri: 'ui://w/\u00e9.html' })).not.toContain('%C3');
    expect(mcpNameOf('tools/call', { name: 'search' })).toBe('search');
  });

  it('Mcp-Param headers follow the plain properties chain and the value types; null, absent and objects send none', () => {
    const schema = {
      type: 'object', properties: {
        region: { type: 'string', 'x-mcp-header': 'Region' }, n: { type: 'integer', 'x-mcp-header': 'N' },
        dry: { type: 'boolean', 'x-mcp-header': 'Dry' }, opt: { type: ['string', 'null'], 'x-mcp-header': 'Opt' },
        nested: { type: 'object', properties: { zone: { type: 'string', 'x-mcp-header': 'Zone' } } },
      },
    };
    expect(mcpParamHeaders(schema, { region: '\u00e9u', n: -7, dry: false, opt: null, nested: { zone: 'z1' } })).toEqual({
      'mcp-param-region': `=?base64?${Buffer.from('\u00e9u').toString('base64')}?=`, 'mcp-param-n': '-7', 'mcp-param-dry': 'false', 'mcp-param-zone': 'z1',
    });
    expect(mcpParamHeaders(schema, {})).toEqual({});
    expect(mcpParamHeaders(schema, { region: { x: 1 } })).toEqual({});
  });

  it('--active calls an x-mcp-header tool and a non-ASCII tool without HeaderMismatch, and RT-003 stays quiet', async () => {
    const snap = await activeModern();
    expect(snap.era).toBe('modern');
    const calls = snap.active?.calls ?? [];
    const forecast = calls.filter((c) => c.tool === 'get_forecast');
    const meteo = calls.filter((c) => c.tool === 'm\u00e9t\u00e9o');
    expect(forecast.map((c) => c.kind)).toEqual(['synthetic', 'invalid-missing', 'invalid-type']);
    expect(meteo.map((c) => c.kind)).toEqual(['synthetic', 'invalid-missing', 'invalid-type']);
    for (const c of [...forecast, ...meteo]) expect(c.jsonRpcError, `${c.tool} ${c.kind}`).toBeUndefined();
    expect(forecast[0].result).toMatchObject({ content: [{ text: 'ok' }] });
    expect(meteo[0].result).toMatchObject({ content: [{ text: 'ok' }] });
    const sent = snap.transport.exchanges.find((e) => e.label === 'active get_forecast');
    expect(sent?.requestHeaders['mcp-param-region']).toBe('mcp-review-check');
    expect(runRules(snap, [RT_003]).findings).toEqual([]);
  }, 30000);

  it('a tool whose x-mcp-header breaks TOOL-021 is not called on a 2026-07-28-only server, and the reason says so', () => {
    const bad = { ...readOnly('get_x'), inputSchema: { type: 'object', properties: { a: { type: 'number', 'x-mcp-header': 'A' } } } };
    expect(activeSkipReason(bad, [bad], undefined, { modern: true })).toContain('TOOL-021');
    expect(activeSkipReason(bad, [bad])).toBeUndefined();
  });
});

describe('A03-04: activeSkipReason names the real reason', () => {
  it('readOnlyHint, destructiveHint, write verb, duplicate name, stop', () => {
    expect(activeSkipReason({ name: 'get_x' }, [])).toBe('the tool is not read-only (readOnlyHint is not true), so --active does not call it');
    expect(activeSkipReason(readOnly('get_x', { destructiveHint: true }), [])).toBe('destructiveHint is true, so --active does not call it');
    expect(activeSkipReason(readOnly('delete_x'), [])).toBe('the name contains the write verb "delete", so --active does not call it');
    const dup = [readOnly('get_x'), { name: 'get_x' }];
    expect(activeSkipReason(dup[0], dup)).toBe('the name is listed more than once and not every entry is read-only, so --active does not call it');
    const limits = { truncated: [], stopped: { maxDurationMs: 1, phase: 'active tool calls', unfinished: ['active tool calls'] } } as unknown as Snapshot['limits'];
    expect(activeSkipReason(readOnly('get_x'), [readOnly('get_x')], limits)).toBe('the run stopped before this call');
    expect(activeSkipReason(readOnly('get_x'), [readOnly('get_x')])).toBeUndefined();
  });

  it('the cap: the 51st callable tool is past it', () => {
    const all = Array.from({ length: 51 }, (_, i) => readOnly(`get_x${String.fromCharCode(97 + (i % 26))}${i}`));
    expect(activeSkipReason(all[50], all)).toBe('the tool was past the cap of 50 tools on --active calls');
    expect(activeSkipReason(all[49], all)).toBeUndefined();
  });

  it('the CLI warning for a read-only-annotated delete_x names the write verb, not readOnlyHint', async () => {
    const dir = join(ROOT, 'node_modules', '.cache');
    mkdirSync(dir, { recursive: true });
    const file = join(mkdtempSync(join(dir, 'r111-p8-')), 'args.json');
    writeFileSync(file, JSON.stringify({ delete_x: {} }));
    const r = await cli(['--stdio', BAD, '--active', '--tool-args', file, '--format', 'json']);
    expect(r.stderr).toContain('warning: --tool-args entry "delete_x" was not used: the name contains the write verb "delete", so --active does not call it');
    expect(r.stderr).not.toContain('"delete_x" was not used: the tool is not read-only');
  }, 60000);
});

describe('I-A03-1: wider write-verb list and token splitting', () => {
  it('each listed name is skipped although annotated read-only', () => {
    for (const n of ['upsert_rows', 'append_line', 'restore_backup', 'migrate_db', 'unpublish_post', 'charge_card', 'sign', 'vote',
      'follow', 'unfollow', 'retweet', 'launch', 'scale', 'resize', 'mount', 'unmount', 'format_disk', 'encrypt', 'decrypt',
      'rotate_key', 'configure', 'store', 'attach', 'detach', 'broadcast', 'alert', 'escalate', 'acknowledge', 'resolve_incident',
      'chargeCard', 'rotateKey', 'read+delete', 'read&delete', 'get\u200bdelete', '\uff44\uff45\uff4c\uff45\uff54\uff45_x']) {
      expect(isSafeToCall(readOnly(n)), n).toBe(false);
    }
    expect(writeVerbOf('read&delete')).toBe('delete');
    expect(writeVerbOf('chargeCard')).toBe('charge');
  });

  it('read tools stay callable (resolve_library_id, get_store_info, list_alerts)', () => {
    for (const n of ['resolve_library_id', 'get_store_info', 'list_alerts', 'search_docs', 'get_weather']) expect(isSafeToCall(readOnly(n)), n).toBe(true);
  });
});

describe('I-A03-3: the clientInfo variants land in the result as each finishes', () => {
  it('a stop during the third listing keeps two variants', async () => {
    const into: NonNullable<Snapshot['active']> = { calls: [] };
    const seen: string[] = [];
    let hung!: () => void;
    const reached = new Promise<void>((r) => { hung = r; });
    const snap = emptySnapshot({ kind: 'stdio', command: 'x', args: [] }, { target: 'all', active: true, activeAuth: false });
    void runActive({
      snap, timeoutMs: 1000, now: Date.now, into,
      listWithClientName: (name) => {
        seen.push(name);
        if (seen.length === 3) { hung(); return new Promise(() => {}); } // never answers: the run is stopped here
        return Promise.resolve(name === 'claude-ai' ? ['a', 'b'] : ['a']);
      },
    });
    await reached;
    expect(into.clientInfoVariants).toEqual({ 'mcp-review-check': ['a'], 'claude-ai': ['a', 'b'] });
  });
});
