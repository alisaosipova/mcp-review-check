// 0.7.0 protocol probes: tasks/get, subscriptions/listen, observed logging notifications.
import { afterEach, describe, expect, it } from 'vitest';
import { startModernServer, type ModernOptions } from './fixtures/modern-server.js';
import type { Started } from './fixtures/http-bridge.js';
import { cli } from './cli-runner.js';
import { SPEC_005, SPEC_023, SPEC_024 } from '../src/rules/spec.js';
import { emptySnapshot, type Snapshot } from '../src/snapshot.js';

let servers: Started[] = [];
afterEach(async () => { await Promise.all(servers.map((s) => s.close())); servers = []; });

async function run(opts: ModernOptions) {
  const s = await startModernServer(opts);
  servers.push(s);
  const r = await cli([s.url, '--format', 'json']);
  const spec = (id: string) => r.json.findings.filter((f: any) => f.ruleId === id);
  return { r, spec };
}

describe('tasks/get probe (SPEC-023)', () => {
  it('verified: -32602 for an unknown taskId leaves only the update/cancel note', async () => {
    const { spec } = await run({ tasks: 'ok' });
    const f = spec('SPEC-023');
    expect(f.every((x: any) => x.severity === 'info')).toBe(true);
    const text = f.map((x: any) => x.message).join('\n');
    expect(text).toContain('tasks/update, tasks/cancel not probed');
    expect(text).not.toContain('tasks/get,');
  });
  it('declared but not implemented: -32601 is an error', async () => {
    const { spec } = await run({ tasks: 'missing' });
    expect(spec('SPEC-023').some((x: any) => x.severity === 'error' && /tasks\/get is not implemented/.test(x.message))).toBe(true);
  });
  it('not declared: tasks/get is never sent', async () => {
    const { r } = await run({});
    expect(JSON.stringify(r.json)).not.toContain('tasks/get');
  });
});

describe('subscriptions/listen probe (SPEC-005)', () => {
  it('an open SSE stream is clean and the probe returns promptly', async () => {
    const { spec } = await run({ listen: 'sse' });
    expect(spec('SPEC-005')).toEqual([]);
  });
  it('a JSON body instead of a stream is a warning', async () => {
    const { spec } = await run({ listen: 'json' });
    expect(spec('SPEC-005')[0]).toMatchObject({ severity: 'warning' });
    expect(spec('SPEC-005')[0].message).toContain('subscriptions/listen got 200');
  });
});

describe('subscriptions/listen JSON-RPC error with HTTP 200', () => {
  it('is not reported as a non-stream response', async () => {
    const { spec } = await run({ listen: 'rpcerror' });
    expect(spec('SPEC-005')).toEqual([]);
  });
});

describe('logging notifications (SPEC-024)', () => {
  it('undeclared logging and unrequested messages are errors', async () => {
    const { spec } = await run({ logging: { declared: false } });
    expect(spec('SPEC-024').filter((x: any) => x.severity === 'error').length).toBe(2);
  });
  it('declared logging still may not log unrequested; a missing level adds a warning', async () => {
    const { spec } = await run({ logging: { declared: true, level: null } });
    expect(spec('SPEC-024').map((x: any) => x.severity).sort()).toEqual(['error', 'warning']);
  });
  it('no notifications, no finding', async () => {
    const { spec } = await run({});
    expect(spec('SPEC-024')).toEqual([]);
  });
});

describe('rule units', () => {
  const snap = (): Snapshot => emptySnapshot({ kind: 'stdio', command: 'x', args: [] }, { target: 'all', active: false, activeAuth: false });
  it('SPEC-024 counts only what was observed', () => {
    const s = snap();
    expect(SPEC_024.check(s)).toEqual([]);
    s.transport.notifications = { methods: { 'notifications/message': 1 }, message: { total: 1, unrequested: 0, invalidLevel: 1 } };
    s.capabilities = { logging: {} };
    s.initializeRaw = { capabilities: { logging: {} } };
    expect(SPEC_024.check(s).map((f) => f.severity)).toEqual(['warning']);
  });
  it('rules without probes stay silent', () => {
    expect(SPEC_005.check(snap())).toEqual([]);
    expect(SPEC_023.check(snap())).toEqual([]);
  });
});
