// Regression tests for the WP2-connect remediation (review 2026-11-01): connect.ts, limits.ts, snapshot.ts,
// protocol/recording.ts and diagnose.ts.
import { fileURLToPath } from 'node:url';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { describe, expect, it } from 'vitest';
import { isJsonRpcLine, NON_JSON_KEPT, NON_JSON_LINE_CAP, stdoutTap } from '../src/connect.js';
import { RecordingTransport, TRANSPORT_ERRORS_KEPT } from '../src/protocol/recording.js';
import { createRedactor } from '../src/protocol/trace.js';
import { cli } from './cli-runner.js';

const WP2 = fileURLToPath(new URL('./fixtures/wp2-stdio-server.mjs', import.meta.url));
const server = (...args: string[]) => `node "${WP2}" ${args.join(' ')}`;
const noRedact = createRedactor();

describe('stdio stdout tap (R046, F141, F012, C003)', () => {
  it('counts every non-JSON-RPC line but keeps only the first lines, each cut', () => {
    const tap = stdoutTap(noRedact);
    for (let i = 0; i < 5000; i++) tap.push(Buffer.from(`log line ${i} ${'y'.repeat(2000)}\n`));
    expect(tap.out.total).toBe(5000);
    expect(tap.out.lines).toHaveLength(NON_JSON_KEPT);
    expect(tap.out.lines[0].startsWith('log line 0 ')).toBe(true);
    expect(tap.out.lines[0].length).toBe(NON_JSON_LINE_CAP + 1); // the cut plus an ellipsis
  });

  it('treats a JSON log line as foreign output and a JSON-RPC message (or batch) as not', () => {
    expect(isJsonRpcLine('{"level":30,"msg":"request tools/list"}')).toBe(false);
    expect(isJsonRpcLine('[1,2]')).toBe(false);
    expect(isJsonRpcLine('42')).toBe(false);
    expect(isJsonRpcLine('{"jsonrpc":"2.0","id":1,"result":{}}')).toBe(true);
    expect(isJsonRpcLine(' [{"jsonrpc":"2.0","method":"x"}]')).toBe(true);
    const tap = stdoutTap(noRedact);
    tap.push(Buffer.from('{"level":30,"msg":"hi"}\n{"jsonrpc":"2.0","id":1,"result":{}}\n'));
    expect(tap.out).toEqual({ lines: ['{"level":30,"msg":"hi"}'], total: 1 });
  });

  it('keeps only the head of a huge line without a newline, and joins a UTF-8 character split across chunks', () => {
    const tap = stdoutTap(noRedact);
    const chunk = Buffer.alloc(1024 * 1024, 'z');
    for (let i = 0; i < 64; i++) tap.push(chunk);
    tap.push(Buffer.from('\n'));
    expect(tap.out.total).toBe(1);
    expect(tap.out.lines[0].length).toBe(NON_JSON_LINE_CAP + 1);
    const euro = Buffer.from('price €\n');
    tap.push(euro.subarray(0, 7));
    tap.push(euro.subarray(7));
    expect(tap.out.lines[1]).toBe('price €');
  });
});

describe('RecordingTransport (R046, F033)', () => {
  it('keeps the first transport error messages and counts the rest; a response clears its pending request', async () => {
    const inner = { start: async () => {}, send: async () => {}, close: async () => {} } as unknown as Transport;
    const rec = new RecordingTransport(inner);
    await rec.start();
    for (let i = 0; i < 1000; i++) inner.onerror?.(new SyntaxError(`Unexpected token ${i}`));
    inner.onerror?.(new Error('ReadBuffer exceeded maximum size of 10485760 bytes'));
    expect(rec.transportErrors).toHaveLength(TRANSPORT_ERRORS_KEPT);
    expect(rec.transportErrorCount).toBe(1001);
    expect(rec.overflow).toMatch(/ReadBuffer exceeded/);
    await rec.send({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
    expect(rec.pending.size).toBe(1);
    inner.onmessage?.({ jsonrpc: '2.0', id: 7, result: { tools: [] } });
    expect(rec.pending.size).toBe(0);
  });
});

describe('stdio servers that write to stdout (C003, R046)', () => {
  it('SRV-018 reports JSON log lines (pino) on stdout', async () => {
    const r = await cli(['--stdio', server('pino'), '--format', 'json']);
    const f = r.json.findings.find((x: any) => x.ruleId === 'SRV-018');
    expect(f, r.stderr).toBeDefined();
    expect(f.message).toMatch(/^6 non-JSON line\(s\) on stdout: .*level.*request initialize/);
  });

  it('a flood of stdout lines before initialize is counted without keeping every line', async () => {
    const r = await cli(['--stdio', server('spam', '200000'), '--format', 'json']);
    expect(r.code, r.stderr).not.toBe(134);
    expect(r.json.findings.find((x: any) => x.ruleId === 'SRV-018')).toBeDefined();
  }, 60000);
});
