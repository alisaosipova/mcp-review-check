// Review round 4, package P1 (1.2.0): baseline engine and drift. A01-05 (a linear wildcard pass, the same matches as
// the 1.1.0 regexes), I-A09-5 (one canonicalization per tool, one fingerprint pass per snapshot), I-A01-5 (UTF-16BE
// baselines) and A01-04 (a listing-only baseline named as such).
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { globMatch, knownFindings, readBaseline, type FindingKey } from '../src/baseline.js';
import { canonicalJson, compareTools, pinFingerprints, TOOL_FIELDS, toolFingerprint, toolFingerprints } from '../src/report/drift.js';
import { decodeText } from '../src/input-file.js';
import { REDACTED_MARK } from '../src/rules/util/net.js';
import { snap } from './helpers.js';
import type { Snapshot } from '../src/snapshot.js';

const R = REDACTED_MARK;
const dir = mkdtempSync(join(tmpdir(), 'mrc-r111-p1b-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// ---- The 1.1.0 wildcard pass, kept here as the reference the linear one must agree with. ----
const subjectKey = (f: FindingKey) => JSON.stringify([f.ruleId, f.tool ?? null, f.resource ?? null, f.path ?? null]);
const wording = (m: string | undefined) => (m ?? '').replace(/\d+(\.\d+)?/g, '#');
const escapeRe = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
const oldSubjectRe = (k: string) => new RegExp(`^${k.split(R).map(escapeRe).join('(?:[^"\\\\]|\\\\.)+?')}$`);
const oldWordRe = (m: string) => new RegExp(`^${m.split(R).map(escapeRe).join('.+?')}$`, 's');

/** The 1.1.0 knownFindings restricted to its wildcard pass (every entry here holds a mark, so the exact passes match none). */
function oldWildcard(findings: FindingKey[], baseline: FindingKey[]): boolean[] {
  const used = baseline.map(() => false);
  const known = findings.map(() => false);
  const wild = baseline.flatMap((b, i) => (subjectKey(b).includes(R) ? [{ i, b, re: oldSubjectRe(subjectKey(b)), wordRe: oldWordRe(wording(b.message)) }] : []));
  const byRule = new Map<string, typeof wild>();
  for (const x of wild) byRule.set(x.b.ruleId, [...(byRule.get(x.b.ruleId) ?? []), x]);
  for (const sameWording of [true, false]) findings.forEach((f, n) => {
    if (known[n] || f.ruleId === 'SRV-020') return;
    const x = byRule.get(f.ruleId)?.find((x) => !used[x.i] && f.platforms.every((p) => x.b.platforms.includes(p)) && x.re.test(subjectKey(f)) && (!sameWording || x.wordRe.test(wording(f.message))));
    if (!x) return;
    used[x.i] = true;
    known[n] = true;
  });
  return known;
}

/** A deterministic pseudo-random generator (mulberry32). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('A01-05: the wildcard pass is linear and matches as the 1.1.0 regexes did', () => {
  it('A01-05 globMatch agrees with the regex on JSON subject keys, escapes and quotes included', () => {
    const cases: Array<[string, string]> = [
      [JSON.stringify(['TOOL-011', `${R}_tool`, null, null]), JSON.stringify(['TOOL-011', 'abc_tool', null, null])],
      [JSON.stringify(['TOOL-011', `${R}_tool`, null, null]), JSON.stringify(['TOOL-011', '_tool', null, null])],
      [JSON.stringify(['T', `a${R}b`, `c${R}`, null]), JSON.stringify(['T', 'axb', 'cy', null])],
      [JSON.stringify(['T', `a${R}`, `${R}b`, null]), JSON.stringify(['T', 'a", "x', 'b', null])],
      [JSON.stringify(['T', `a${R}b`, null, null]), JSON.stringify(['T', 'a"b', null, null])],
      [JSON.stringify(['T', `a${R}b`, null, null]), JSON.stringify(['T', 'a\\b', null, null])],
      [JSON.stringify(['T', `a${R}"b`, null, null]), JSON.stringify(['T', 'a\\"b', null, null])],
      [JSON.stringify(['T', `a${R}"b`, null, null]), JSON.stringify(['T', 'ax"b', null, null])],
      [JSON.stringify(['T', `${R}${R}`, null, null]), JSON.stringify(['T', 'x', null, null])],
      [JSON.stringify(['T', `${R}${R}`, null, null]), JSON.stringify(['T', 'xy', null, null])],
      [JSON.stringify(['T', `${R}a${R}a${R}b`, null, null]), JSON.stringify(['T', 'aaaaaaaaaaaaaaaaaaaaaaab', null, null])],
      [JSON.stringify(['T', `${R}a${R}a${R}b`, null, null]), JSON.stringify(['T', 'aaaaaaaaaaaaaaaaaaaaaaaa', null, null])],
      [JSON.stringify(['T', `x${R}`, null, `/p/${R}`]), JSON.stringify(['T', 'x\n', null, '/p/q'])],
    ];
    for (const [pattern, subject] of cases) expect(globMatch(pattern.split(R), subject, true), `${pattern} ~ ${subject}`).toBe(oldSubjectRe(pattern).test(subject));
    // Random subjects over a small alphabet with quotes and backslashes.
    const rand = rng(7);
    const alphabet = ['a', 'b', '"', '\\', '_', R];
    const str = (n: number, marks: boolean) => Array.from({ length: n }, () => alphabet[Math.floor(rand() * (marks ? 6 : 5))]).join('');
    for (let i = 0; i < 3000; i++) {
      const pattern = JSON.stringify(['T', str(1 + Math.floor(rand() * 6), true), null, null]);
      if (!pattern.includes(R)) continue;
      const subject = JSON.stringify(['T', str(Math.floor(rand() * 8), false), null, null]);
      expect(globMatch(pattern.split(R), subject, true), `${pattern} ~ ${subject}`).toBe(oldSubjectRe(pattern).test(subject));
    }
    // Messages: any character in a gap, at least one.
    for (const [m, s] of [[`a ${R} b`, 'a x b'], [`a ${R} b`, 'a  b'], [`${R}`, ''], [`${R}`, 'x'], [`a${R}a${R}`, 'aaa'], [`a${R}a${R}`, 'aa']]) {
      expect(globMatch(m.split(R), s, false), `${m} ~ ${s}`).toBe(oldWordRe(m).test(s));
    }
  });

  it('A01-05 5,000 findings x 500 wildcard entries take under 1 s, with the same matches as the 1.1.0 regexes', () => {
    const rand = rng(42);
    const baseline: FindingKey[] = Array.from({ length: 500 }, (_, i) => ({
      ruleId: i % 3 ? 'TOOL-011' : 'INJ-003', platforms: ['claude', 'chatgpt'],
      tool: i % 5 ? `${R}_tool_${i}` : `pre_${R}_mid_${R}`, path: i % 7 ? undefined : `/properties/${R}`,
      message: i % 2 ? `Tool name ${R} is ${i} chars` : undefined,
    }));
    const findings: FindingKey[] = Array.from({ length: 5000 }, (_, n) => {
      const i = Math.floor(rand() * 600);
      const hit = i < 500 && rand() < 0.3;
      return {
        ruleId: i % 3 ? 'TOOL-011' : 'INJ-003', platforms: rand() < 0.9 ? ['claude'] : ['claude', 'chatgpt'],
        tool: hit ? (i % 5 ? `value${n}_tool_${i}` : `pre_v${n}_mid_w`) : `other_${n}_${'a'.repeat(Math.floor(rand() * 40))}`,
        path: hit && i % 7 === 0 ? `/properties/p${n}` : undefined,
        message: hit && i % 2 ? `Tool name x${n} is ${i + 1} chars` : `free text ${n}`,
      };
    });
    knownFindings(findings.slice(0, 200), baseline); // warm the JIT, so the timing is of the algorithm
    const t0 = performance.now();
    const now = knownFindings(findings, baseline);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(1000);
    expect(now).toEqual(oldWildcard(findings, baseline));
    expect(now.filter(Boolean).length).toBeGreaterThan(50);
  });

  it('A01-05 the round-3 worst cases stay fast (many marks, a long subject, a long message)', () => {
    const t0 = performance.now();
    const k = knownFindings([{ ruleId: 'TOOL-011', platforms: ['claude'], tool: 'a'.repeat(4000) }], [{ ruleId: 'TOOL-011', platforms: ['claude'], tool: `${R}a${R}a${R}b` }]);
    expect(k).toEqual([false]);
    const msg = knownFindings([{ ruleId: 'X-001', platforms: ['claude'], tool: 'q', message: 'a'.repeat(300) }], [{ ruleId: 'X-001', platforms: ['claude'], tool: R, message: Array(7).fill('a').join(R) + 'b' }]);
    expect(msg).toEqual([true]); // the subject matches; the wording pass fails, the any-wording pass takes it
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('A01-05 baseline order: the first free entry is taken, a used one is not taken twice', () => {
    const base: FindingKey[] = [
      { ruleId: 'TOOL-011', platforms: ['claude'], tool: `${R}_a` },
      { ruleId: 'TOOL-011', platforms: ['claude'], tool: `x${R}` },
    ];
    const f: FindingKey[] = [{ ruleId: 'TOOL-011', platforms: ['claude'], tool: 'x1_a' }, { ruleId: 'TOOL-011', platforms: ['claude'], tool: 'x2_a' }, { ruleId: 'TOOL-011', platforms: ['claude'], tool: 'x3_a' }];
    expect(knownFindings(f, base)).toEqual([true, true, false]);
    expect(knownFindings(f, base)).toEqual(oldWildcard(f, base));
  });
});

// ---- I-A09-5 ----

/** The 1.1.0 fingerprint: the whole tool canonicalized on its own. */
function oldFingerprint(t: Record<string, unknown>) {
  const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
  const present = TOOL_FIELDS.filter((f) => t[f] !== undefined);
  return { sha256: sha(canonicalJson(Object.fromEntries(present.map((f) => [f, t[f]])))), fields: Object.fromEntries(present.map((f) => [f, sha(canonicalJson(t[f]))])) };
}

function realTools(): Array<Record<string, unknown>> {
  const base = new URL('./fixtures/real/', import.meta.url);
  return readdirSync(base).filter((n) => /\.json(\.br)?$/.test(n) && !n.startsWith('baseline')).flatMap((n) => {
    const buf = readFileSync(new URL(n, base));
    const doc = JSON.parse((n.endsWith('.br') ? brotliDecompressSync(buf) : buf).toString('utf8'));
    return Array.isArray(doc.tools) ? doc.tools : [];
  });
}

describe('I-A09-5: one canonicalization per tool, one fingerprint pass per snapshot', () => {
  it('I-A09-5 the digests equal the 1.1.0 ones on every tool of test/fixtures/real', () => {
    const tools = realTools();
    expect(tools.length).toBeGreaterThan(20);
    for (const t of tools) {
      const fp = toolFingerprint(t);
      const old = oldFingerprint(t);
      expect(fp.sha256).toBe(old.sha256);
      expect(fp.fields).toEqual(old.fields);
    }
    // Keys that sort before or after the fields (and undefined members) do not change it.
    const t = { _meta: { z: 1, a: [1, { b: undefined, a: 2 }] }, name: 'n', zzz: 'ignored', title: undefined, annotations: { readOnlyHint: true } };
    expect(toolFingerprint(t).sha256).toBe(oldFingerprint(t).sha256);
  });

  it('I-A09-5 a tool is serialized once: about half the JSON.stringify calls of 1.1.0', () => {
    const tool = realTools().find((t) => t.inputSchema && t.description)!;
    const spy = vi.spyOn(JSON, 'stringify');
    oldFingerprint(tool);
    const before = spy.mock.calls.length;
    spy.mockClear();
    toolFingerprint(tool);
    const after = spy.mock.calls.length;
    spy.mockRestore();
    expect(after).toBeLessThanOrEqual(Math.ceil(before / 2) + TOOL_FIELDS.length);
  });

  it('I-A09-5 pinFingerprints and compareTools fingerprint each snapshot once', () => {
    const tools = realTools().slice(0, 40);
    const rulesSnap: Snapshot = snap({ tools });
    const reportSnap: Snapshot = snap({ tools: tools.map((t) => ({ ...t })) });
    const spy = vi.spyOn(JSON, 'stringify');
    const one = (() => { spy.mockClear(); tools.forEach((t) => toolFingerprint(t)); return spy.mock.calls.length; })();
    spy.mockClear();
    pinFingerprints(reportSnap, rulesSnap);
    const baseline = toolFingerprints(reportSnap)!;
    compareTools(baseline, reportSnap);
    toolFingerprints(reportSnap);
    const calls = spy.mock.calls.length;
    spy.mockRestore();
    // Two passes (the rules' snapshot and the report's), not three; compareTools reuses the report's own digests.
    expect(calls).toBeLessThanOrEqual(2 * one + 10);
    expect(compareTools(baseline, reportSnap).toolChanges).toEqual({ added: [], removed: [], changed: [] });
  });
});

describe('I-A01-5 and A01-04: reading a baseline', () => {
  const report = (extra: Record<string, unknown> = {}) => JSON.stringify({ tool: { name: 'mcp-review-check' }, schemaVersion: 1, findings: [{ ruleId: 'TOOL-011', platforms: ['claude'], tool: '\u00fc' }], toolFingerprints: [], ...extra });

  it('I-A01-5 an FE FF baseline reads like its UTF-8 form; FF FE and a UTF-8 BOM still do', () => {
    const text = report();
    const forms = {
      be: Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]),
      le: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]),
      bom: Buffer.from(`\uFEFF${text}`, 'utf8'),
      plain: Buffer.from(text, 'utf8'),
    };
    for (const [name, buf] of Object.entries(forms)) {
      expect(decodeText(buf), name).toBe(text);
      writeFileSync(join(dir, `${name}.json`), buf);
      expect(readBaseline(join(dir, `${name}.json`)).findings[0].tool, name).toBe('\u00fc');
    }
  });

  it('A01-04 a listing-only baseline is reported as one, not as a run that did not list every tool', () => {
    writeFileSync(join(dir, 'lo.json'), report({ server: { listingOnly: true }, toolFingerprints: null }));
    const b = readBaseline(join(dir, 'lo.json'));
    expect(b).toMatchObject({ tools: null, listingOnly: true });
    const s = snap({ tools: [{ name: 'a', inputSchema: { type: 'object' } }] });
    expect(compareTools(b.tools, s, b.listingOnly).notCompared).toBe('the baseline is a listing-only report (no server was checked), so it recorded no tool fingerprints');
    writeFileSync(join(dir, 'partial.json'), report({ toolFingerprints: null }));
    const p = readBaseline(join(dir, 'partial.json'));
    expect(p.listingOnly).toBeUndefined();
    expect(compareTools(p.tools, s, p.listingOnly).notCompared).toMatch(/^the baseline run did not list every tool/);
  });
});
