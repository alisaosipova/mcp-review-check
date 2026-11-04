// Review round 3, package P3 (src/probe/**): A03-01 --active name filter, A03-02 stream probe timeouts,
// A03-03 the registered DCR client_id on stderr.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSnapshot } from '../src/connect.js';
import type { ModernClient } from '../src/protocol/modern.js';
import { createRedactor, createTracer } from '../src/protocol/trace.js';
import { hasWriteVerb, isSafeToCall } from '../src/probe/active.js';
import { dcrClientNotice } from '../src/probe/auth.js';
import type { Deps } from '../src/probe/network.js';
import { runWireProbes, STREAM_PROBE_MS } from '../src/probe/wire.js';
import type { AuthProbe } from '../src/snapshot.js';
import { startAuthServer } from './fixtures/auth-server.js';
import type { Started } from './fixtures/http-bridge.js';
import { exchange, snap } from './helpers.js';

const readOnly = (name: string, extra: Record<string, unknown> = {}) => ({ name, annotations: { readOnlyHint: true, ...extra } });

describe('A03-01: --active skips read-only-annotated tools whose name has a mutating verb', () => {
  it('A03-01 skips verbs missing from the rules vocabulary, inflected verbs and glued all-caps names', () => {
    for (const n of ['deletes_file', 'exec_command', 'kill_process', 'restart_service', 'deploy_app', 'git_push', 'clear_cache',
      'DELETEFILE', 'deletefile', 'unlink_file', 'rm', 'deleted_items', 'stopping_job', 'stopped_jobs', 'updating_record',
      'toggleFeature', 'grant_role', 'install_package', 'commit_changes']) {
      expect(isSafeToCall(readOnly(n)), n).toBe(false);
    }
  });

  it('A03-01 keeps calling what 1.0.0 called when the name starts with a read verb, and plain read tools', () => {
    for (const n of ['get_commit', 'list_commits', 'get_block', 'get_setting', 'search_locks', 'show_pushes', 'get_weather', 'fetchUrl',
      'search', 'status', 'user_settings', 'recent_posts', 'droplet_info', 'dropdown_options', 'address_info', 'process_info', 'news_feed']) {
      expect(isSafeToCall(readOnly(n)), n).toBe(true);
    }
  });

  it('A03-01 a read verb first does not exempt a second action after a conjunction', () => {
    for (const n of ['get_and_kill_process', 'fetch_then_restart_service', 'read_and_rm', 'list_and_DELETEALL', 'getAndStopJob',
      'search_or_deletes_rows', 'show_then_clear_cache']) {
      expect(isSafeToCall(readOnly(n)), n).toBe(false);
    }
    for (const n of ['get_lock_and_status', 'list_commits_and_tags', 'search_and_filter', 'get_profile_and_settings', 'list_and']) {
      expect(isSafeToCall(readOnly(n)), n).toBe(true);
    }
  });

  it('A03-01 only narrows the 1.0.0 filter: a name 1.0.0 skipped is still skipped', () => {
    for (const n of ['delete_note', 'get_order', 'run_status', 'sendEmail']) expect(hasWriteVerb(n), n).toBe(true);
    expect(isSafeToCall(readOnly('get_weather', { destructiveHint: true }))).toBe(false);
    expect(isSafeToCall({ name: 'get_weather', annotations: { readOnlyHint: false } })).toBe(false);
  });
});

describe('A03-02: the GET and subscriptions/listen probes respect a lower --timeout', () => {
  let srv: Server | undefined;
  afterEach(async () => {
    srv?.closeAllConnections();
    await new Promise<void>((r) => (srv ? srv.close(() => r()) : r()));
    srv = undefined;
  });

  it('A03-02 subscriptions/listen waits min(--timeout, 5 s)', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const modern = {
      request: async (_m: string, _p: unknown, opts: Record<string, unknown>) => { sent.push(opts); return { exchange: exchange({ label: String(opts.label) }) }; },
    } as unknown as ModernClient;
    const s = snap({ set: (x) => { x.era = 'modern'; x.capabilities = { tools: { listChanged: true } }; } });
    await runWireProbes({ snap: s, timeoutMs: 1000, now: () => 0, modern });
    expect(sent.find((o) => o.label === 'subscriptions/listen')?.timeoutMs).toBe(1000);
    sent.length = 0;
    await runWireProbes({ snap: s, timeoutMs: 30000, now: () => 0, modern });
    expect(sent.find((o) => o.label === 'subscriptions/listen')?.timeoutMs).toBe(STREAM_PROBE_MS);
  });

  it('A03-02 a GET that never sends headers is cut off at --timeout 1000, not after 5 s', async () => {
    srv = createServer((req, res) => {
      if (req.method === 'GET') return; // hang: no status line
      res.writeHead(400, { 'content-type': 'application/json' }).end('{}');
    });
    await new Promise<void>((r) => srv!.listen(0, '127.0.0.1', () => r()));
    const url = new URL(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/mcp`);
    const tracer = createTracer(createRedactor());
    const s = snap({ url: url.href, set: (x) => { x.transport.kind = 'streamable-http'; } });
    const p = await runWireProbes({ snap: s, timeoutMs: 1000, now: () => performance.now(), sleep: async () => {}, http: { tracer, url, authHeaders: {} } });
    const get = p.get as { durationMs: number; status?: number } | undefined;
    expect(get?.status).toBeUndefined();
    expect(get!.durationMs).toBeLessThan(3000);
  }, 20000);
});

describe('A03-03: --active-auth names the DCR client it registered', () => {
  let server: Started | undefined;
  afterEach(async () => { await server?.close(); server = undefined; });
  const deps: Deps = {
    resolve4: async () => { throw new Error('no DNS'); }, resolve6: async () => { throw new Error('no DNS'); },
    tlsCheck: async () => ({ ok: true }), now: () => performance.now(), sleep: async () => {},
  };
  const base: AuthProbe = { trigger: 'preflight-401', challenge: { status: 401, raw: '', parsed: [] }, prmAttempts: [], as: [], timings: {} } as unknown as AuthProbe;

  it('A03-03 one notice line with the client_id and the registration endpoint', async () => {
    server = await startAuthServer({});
    const { snap: s } = await buildSnapshot({ target: { kind: 'http', url: server.url }, timeoutMs: 5000, activeAuth: true }, deps);
    const line = dcrClientNotice(s.authProbe);
    expect(line).toMatch(/^Notice: --active-auth registered DCR client client_id=client-123 at http:\/\/127\.0\.0\.1:\d+\/register; delete it/);
    expect(line!.split('\n')).toEqual([expect.any(String), '']);
  });

  it('A03-03 no line without --active-auth or when the registration was rejected', () => {
    expect(dcrClientNotice(undefined)).toBeUndefined();
    expect(dcrClientNotice({ ...base })).toBeUndefined();
    expect(dcrClientNotice({ ...base, active: { dcr: exchange({ status: 400 }) } })).toBeUndefined();
    expect(dcrClientNotice({ ...base, active: { dcr: exchange({ status: 201 }) } })).toMatch(/answered 201 without a client_id/);
  });

  it('A03-03 a server-chosen client_id cannot inject control characters or a line, and run secrets are scrubbed', () => {
    const secret = ['sk', 'live', 'SYNTH0123456789abcdef'].join('_');
    const clientId = `id\u001b[2J\n::error::x‮${secret}${'x'.repeat(400)}`;
    const line = dcrClientNotice({ ...base, active: { dcr: exchange({ status: 201, url: 'https://as.test/register' }), clientId } }, createRedactor([], [secret]))!;
    expect(line.split('\n')).toEqual([expect.any(String), '']);
    expect(line.slice(0, -1)).toMatch(/^[\x20-\x7e…]+$/u);
    expect(line).toContain('\\u{1B}');
    expect(line).not.toContain(secret);
    expect(line.length).toBeLessThan(400);
  });

  it('A03-03 the 200-character cut never splits an escape sequence', () => {
    for (const pad of [193, 194, 195, 196, 197, 198]) {
      const clientId = `${'a'.repeat(pad)}\u001b${'b'.repeat(50)}`;
      const line = dcrClientNotice({ ...base, active: { dcr: exchange({ status: 201, url: 'https://as.test/register' }), clientId } })!;
      const shown = /client_id=(\S+) at /.exec(line)![1];
      expect(shown.length, String(pad)).toBeLessThanOrEqual(200);
      expect(shown, String(pad)).toMatch(pad <= 193 ? /^a+\\u\{1B\}b*…$/ : /^a+…$/);
    }
  });
});
