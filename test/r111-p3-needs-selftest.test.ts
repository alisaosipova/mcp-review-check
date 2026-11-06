// Rule-metadata self-test (1.2.0, review round 4 I-A13-2, I-A13-3; spec §1.3, §4.2): every rule runs against snapshots
// that lack the server's answers (auth-required, token-rejected, connect-failed over HTTP and stdio, listing-only)
// through a read-recording Proxy. A rule that reads data its declared needs do not guarantee and still counts as run
// judged nothing: the test fails, so a missing `handshake` / `tools` need is caught mechanically. It watches top-level
// snapshot keys only (TRACKED below); reads under `transport` (exchanges, probes, observed errors) are not recorded.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadOpenAiManifest, loadPluginDir, mergeListings } from '../src/listing/index.js';
import { CONNECT_REASON, LISTING_ONLY_REASON, runRules } from '../src/rules/engine.js';
import { RULES } from '../src/rules/index.js';
import type { Need, Rule } from '../src/rules/types.js';
import { emptySnapshot, type Snapshot } from '../src/snapshot.js';
import { loadSnapshot } from './helpers.js';

const HANDSHAKE = ['serverInfo', 'capabilities', 'instructions', 'initializeRaw', 'discoverRaw', 'protocolVersion'];
const LISTS = ['tools', 'resources', 'resourceTemplates', 'prompts', 'listMeta'];
/** The server data the self-test watches: what a run without the server's answers does not have. */
const TRACKED = new Set([...HANDSHAKE, ...LISTS, 'resourceReads', 'authProbe']);

/** What each need guarantees is present when it is met. */
const GUARANTEES: Partial<Record<Need, string[]>> = {
  handshake: HANDSHAKE,
  legacy: HANDSHAKE,
  modern: HANDSHAKE,
  tools: [...HANDSHAKE, 'tools', 'listMeta'],
  resources: [...HANDSHAKE, 'resources', 'resourceTemplates', 'listMeta'],
  prompts: [...HANDSHAKE, 'prompts', 'listMeta'],
  ui: [...HANDSHAKE, 'tools', 'resources', 'resourceTemplates', 'listMeta', 'resourceReads'],
  active: [...HANDSHAKE, 'tools', 'listMeta'],
  auth: ['authProbe'],
  'active-auth': ['authProbe'],
  // A URL rule judges the URL alone and may add what the auth probe saw when it ran (SRV-004: the authorization
  // server's DNS); it must not read the handshake or the lists.
  url: ['authProbe'],
};

/**
 * Rules whose body (not metadata) reads unguaranteed data and still runs: handed off to the package that owns the
 * rule file. Empty means none; an entry here that no longer reads such data fails the test (stale allowlist).
 */
const KNOWN_BODY_DEFECTS: Record<string, string> = {};

function guaranteed(rule: Rule): Set<string> {
  return new Set(rule.needs.flatMap((n) => GUARANTEES[n] ?? []));
}

/** Missing data: what a run without the server's answers has in place of it. Data the fixture does have (the auth
 *  probe of an auth-required run) is a fair read whatever the needs. */
const absent = (v: unknown) => v === undefined || v === null || (Array.isArray(v) ? v.length === 0 : typeof v === 'object' && Object.keys(v as object).length === 0);

/** Each rule wrapped so its check() sees a Proxy that records the tracked top-level keys it reads while they are missing. */
function recording(reads: Map<string, Set<string>>, rules: Rule[] = RULES): Rule[] {
  return rules.map((rule) => ({
    ...rule,
    check(s: Snapshot) {
      const seen = new Set<string>();
      reads.set(rule.id, seen);
      const view = new Proxy(s, {
        get(t, k, r) { const v = Reflect.get(t, k, r); if (typeof k === 'string' && TRACKED.has(k) && absent(v)) seen.add(k); return v; },
        has(t, k) { if (typeof k === 'string' && TRACKED.has(k) && absent(Reflect.get(t, k))) seen.add(k); return Reflect.has(t, k); },
      });
      return rule.check(view);
    },
  }));
}

const http = (): Snapshot => emptySnapshot({ kind: 'http', urlAsEntered: 'https://mcp.acme.test/mcp', url: new URL('https://mcp.acme.test/mcp') }, { target: 'all', active: true, activeAuth: false });
const stdio = (): Snapshot => emptySnapshot({ kind: 'stdio', command: 'node', args: ['server.js'] }, { target: 'all', active: true, activeAuth: false });
const LISTING = fileURLToPath(new URL('./fixtures/listing/', import.meta.url));

const FIXTURES: Record<string, () => Snapshot> = {
  'auth-required': () => loadSnapshot('auth-required'),
  'token-rejected': () => { const s = loadSnapshot('auth-required'); s.coverage = { toolLevel: 'token-rejected' }; s.options.authenticated = true; return s; },
  'connect-failed http': () => { const s = http(); s.fatal = 'could not complete a handshake: ECONNREFUSED'; s.coverage = { toolLevel: 'connect-failed', reason: 'ECONNREFUSED' }; return s; },
  'connect-failed stdio': () => { const s = stdio(); s.fatal = 'could not start or initialize the stdio server: spawn x ENOENT'; s.coverage = { toolLevel: 'connect-failed', reason: 'spawn x ENOENT' }; return s; },
  'listing-only': () => {
    const s = emptySnapshot({ kind: 'listing' }, { target: 'all', active: false, activeAuth: false });
    s.listing = mergeListings(loadPluginDir(`${LISTING}plugin-valid`), loadOpenAiManifest(`${LISTING}openai-valid/plugin.json`));
    return s;
  },
};

/** "<fixture> <rule>: reads <keys>" for each rule that read unguaranteed data and counted as run. */
function violations(name: string, s: Snapshot): string[] {
  const reads = new Map<string, Set<string>>();
  const r = runRules(s, recording(reads));
  expect(r.internalErrors, `${name}: no rule throws`).toBeUndefined();
  const skipped = new Set(r.skipped.map((x) => x.ruleId));
  const out: string[] = [];
  for (const rule of RULES) {
    if (skipped.has(rule.id)) continue;
    const bad = [...(reads.get(rule.id) ?? [])].filter((k) => !guaranteed(rule).has(k));
    if (bad.length) out.push(`${name} ${rule.id}: reads ${bad.sort().join(', ')}`);
  }
  return out;
}

const ruleOf = (v: string) => /([A-Z]+-\d+):/.exec(v)![1];

describe('needs self-test (I-A13-2)', () => {
  const all = Object.entries(FIXTURES).flatMap(([name, make]) => violations(name, make()));

  it('no rule reads server data its needs do not guarantee and still counts as run', () => {
    expect(all.filter((v) => !KNOWN_BODY_DEFECTS[ruleOf(v)])).toEqual([]);
    // The allowlist of body defects is not stale.
    const flagged = new Set(all.map(ruleOf));
    expect(Object.keys(KNOWN_BODY_DEFECTS).filter((id) => !flagged.has(id))).toEqual([]);
    // Negative control: the recorder does flag a rule without needs that reads serverInfo (POL-005 before 1.2.0).
    const reads = new Map<string, Set<string>>();
    const probe = recording(reads, [{ ...RULES[0], id: 'TEST-900', needs: [], check: (s: Snapshot) => (s.serverInfo ? [] : []) }]);
    expect(runRules(loadSnapshot('auth-required'), probe).rulesRun).toBe(1);
    expect([...reads.get('TEST-900')!]).toEqual(['serverInfo']);
  });
});

describe('handshake need (A04-03)', () => {
  const HANDSHAKE_RULES = ['SRV-011', 'SRV-012', 'SRV-013', 'SRV-014', 'SRV-015', 'SPEC-002', 'SPEC-008', 'SPEC-016', 'SPEC-017', 'SPEC-018', 'SPEC-020', 'SPEC-021', 'SPEC-023'];

  it('an auth-required run skips the rules that read the handshake with the auth reason, none passes', () => {
    const r = runRules(loadSnapshot('auth-required'), RULES);
    for (const id of HANDSHAKE_RULES) expect(r.skipped.find((x) => x.ruleId === id)?.reason, id).toBe('server requires auth; pass --bearer <token>');
  });

  it('a token-rejected run skips them with "token rejected (401)"', () => {
    const r = runRules(FIXTURES['token-rejected'](), RULES);
    for (const id of HANDSHAKE_RULES) expect(r.skipped.find((x) => x.ruleId === id)?.reason, id).toBe('token rejected (401)');
  });

  it('they declare the need (metadata, not an engine list)', () => {
    for (const id of HANDSHAKE_RULES) expect(RULES.find((x) => x.id === id)!.needs, id).toContain('handshake');
  });
});

describe('URL and transport rules are metadata (I-A13-3)', () => {
  it('the rules that may pass without a transport are the url and transport ones', () => {
    const ids = RULES.filter((x) => x.needs.some((n) => n === 'url' || n === 'transport')).map((x) => x.id).sort();
    expect(ids).toEqual(['AUTH-001', 'SRV-001', 'SRV-003', 'SRV-004', 'SRV-005', 'SRV-017']);
    // Equal output to the engine-side URL_ONLY list it replaces: on a connect failure every other rule that runs has
    // findings, and in a listing-only run every server rule is skipped.
    const r = runRules(FIXTURES['connect-failed http'](), RULES);
    const skipped = new Set(r.skipped.map((x) => x.ruleId));
    const found = new Set(r.findings.map((f) => f.ruleId));
    const passed = RULES.filter((x) => !skipped.has(x.id) && !found.has(x.id)).map((x) => x.id);
    expect(passed.every((id) => ['AUTH-001', 'SRV-001', 'SRV-004', 'SRV-005', 'SRV-017'].includes(id)), passed.join()).toBe(true);
    const l = runRules(FIXTURES['listing-only'](), RULES);
    const reasons = new Map(l.skipped.map((x) => [x.ruleId, x.reason]));
    for (const rule of RULES.filter((x) => !x.id.startsWith('LST-'))) expect(reasons.get(rule.id), rule.id).toBe(LISTING_ONLY_REASON);
  });

  it('SRV-003 is skipped with "stdio target" for a stdio server that started (A10-06), and runs for one that did not', () => {
    const ok = stdio(); ok.initializeRaw = {}; ok.era = 'legacy';
    expect(runRules(ok, RULES).skipped.find((x) => x.ruleId === 'SRV-003')?.reason).toBe('stdio target');
    const r = runRules(FIXTURES['connect-failed stdio'](), RULES);
    expect(r.skipped.some((x) => x.ruleId === 'SRV-003')).toBe(false);
    expect(r.findings.find((f) => f.ruleId === 'SRV-003')?.message).toMatch(/stdio server did not start/);
  });
});

describe('connect failure skip reasons (A04-06)', () => {
  it('server-data needs read "could not connect", not "server did not request auth" or "era unknown"', () => {
    for (const make of [FIXTURES['connect-failed http'], FIXTURES['connect-failed stdio']]) {
      const s = make();
      const r = runRules(s, RULES);
      const reasons = new Map(r.skipped.map((x) => [x.ruleId, x.reason]));
      for (const id of ['AUTH-002', 'AUTH-004', 'SPEC-001', 'SPEC-004', 'SPEC-011', 'TOOL-001', 'APPS-001']) {
        const needs = RULES.find((x) => x.id === id)!.needs;
        if (s.target.kind === 'stdio' && (needs.includes('http') || needs.includes('auth'))) expect(reasons.get(id), id).toBe('stdio target');
        else expect(reasons.get(id), id).toBe(CONNECT_REASON);
      }
      expect([...reasons.values()].filter((x) => /did not request auth|^era /.test(x))).toEqual([]);
    }
  });

  it('a fatal stop keeps the auth reason when there is one', () => {
    const s = FIXTURES['connect-failed http'](); s.coverage = { toolLevel: 'auth-required' };
    expect(runRules(s, RULES).skipped.find((x) => x.ruleId === 'SPEC-001')?.reason).toBe('server requires auth; pass --bearer <token>');
  });
});
