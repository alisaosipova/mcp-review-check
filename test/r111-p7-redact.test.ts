// Review round 4, package P7 (1.2.0; spec s4.5): a secret is masked in every escape a server or Node may write it in
// (A07-06, I-A07-7, the A01-06 inspect form), a plain --env value equal to a report word is not a secret and the
// report's own catalog text is kept (A07-04), and readBody keeps one copy of the body (I-A09-6). Synthetic values only.
import { describe, expect, it, vi } from 'vitest';
import { buildRedactor, redactDeep } from '../src/redact.js';
import { createRedactor, readBody, REDACTED, scrub, snippetOf } from '../src/protocol/trace.js';
import { buildReport } from '../src/report/index.js';
import type { Finding } from '../src/rules/types.js';
import { snap } from './helpers.js';

const SECRET = 'SYNTH/key+BBBB2222=';

describe('A07-06 / I-A07-7: every escape of a secret is masked', () => {
  const r = createRedactor([], [SECRET]);
  const forms: Array<[string, string]> = [
    ['as written', SECRET],
    ['encodeURIComponent', encodeURIComponent(SECRET)],
    ['Python quote (safe="/")', encodeURIComponent(SECRET).replace(/%2F/g, '/')],
    ['lowercase hex', encodeURIComponent(SECRET).replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase())],
    ['the whole echo lowercased', encodeURIComponent(SECRET).toLowerCase()],
    ['JSON with an escaped slash', SECRET.replace('/', '\\/')],
    ['JSON \\uXXXX for each symbol', SECRET.replace('/', '\\u002f').replace('+', '\\u002B').replace('=', '\\u003d')],
    ['mixed', 'SYNTH%2fkey\\u002bBBBB2222%3D'],
  ];
  for (const [name, form] of forms) {
    it(name, () => {
      expect(scrub(`GET https://api.test/x?key=${form}&n=1`, r)).toBe(`GET https://api.test/x?key=${REDACTED}&n=1`);
    });
  }

  it('the A01-06 safety net: a NUL quoted by util.inspect as \\x00', () => {
    const nul = createRedactor([], ['S3cr\u0000etTokenValue123']);
    expect(scrub("Received '--api-key=S3cr\\x00etTokenValue123'", nul)).toBe(`Received '--api-key=${REDACTED}'`);
    expect(nul.values.has('S3cr\\x00etTokenValue123')).toBe(true);
  });

  it('other text is left alone, and a short secret still needs word bounds', () => {
    expect(scrub('SYNTH/key+BBBB2223= and synth%2Fkey', r)).toBe('SYNTH/key+BBBB2223= and synth%2Fkey');
    const short = createRedactor([], ['p/ss']);
    expect(scrub('a p%2Fss b', short)).toBe(`a ${REDACTED} b`);
    expect(scrub('xp%2Fss', short)).toBe('xp%2Fss');
    // A short secret keeps its case: "P/SS" is another word.
    expect(scrub('a P/SS b', short)).toBe('a P/SS b');
  });

  it('a fully escaped secret across the snippet cut is still masked', () => {
    const escaped = [...SECRET].map((c) => (/[A-Za-z0-9]/.test(c) ? c : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)).join('');
    // The escaped secret is longer than any literal form: the scrubbed prefix must reach past its end.
    for (let pad = 4040; pad <= 4090; pad += 5) {
      const s = snippetOf(`${'a'.repeat(pad)}${escaped}${'b'.repeat(200)}`, r);
      expect(s, String(pad)).not.toContain('SYNTH');
      expect(`${REDACTED}${'b'.repeat(200)}`.startsWith(s.slice(pad)), String(pad)).toBe(true);
    }
  });
});

describe('A07-04: report words under a plain --env name', () => {
  it('claude, chatgpt and the format and transport words are not secrets; a token-like value still is', () => {
    for (const v of ['claude', 'ChatGPT', 'all', 'spec', 'stdio', 'http', 'sse', 'json', 'sarif', 'junit', 'markdown']) {
      expect(buildRedactor({ env: { MODE: v } }).values.has(v), v).toBe(false);
    }
    expect(buildRedactor({ env: { MODE: 'claude-SYNTH0001' } }).values.has('claude-SYNTH0001')).toBe(true);
    expect(buildRedactor({ env: { API_KEY: 'claude' } }).values.has('claude'), 'under a secret name it is masked').toBe(true);
  });

  it('a finding keeps its catalog title and docs and the --target value; fix, messages and the target object are scrubbed', () => {
    const word = 'notesvault'; // a plain --env value that happens to appear in report text
    const r = createRedactor([], [word]);
    const s = snap();
    s.target = { kind: 'stdio', command: 'node', args: ['server.js', `--vault=${word}`] };
    const f: Finding = { ruleId: 'TOOL-006', title: `Tool ${word} title`, severity: 'error', platforms: ['claude'], message: `no title in ${word}`, fix: `fix ${word}`, docs: [`https://docs.test/${word}`], tool: word };
    const out = redactDeep(buildReport(s, { findings: [f], ignored: [], skipped: [], rulesRun: 1 }, [], 'error', new Date(0), 1), r);
    const g = out.findings[0];
    expect(g.title).toBe(`Tool ${word} title`);
    expect(g.docs).toEqual([`https://docs.test/${word}`]);
    expect(g.message).toBe(`no title in ${REDACTED}`);
    expect(g.fix).toBe(`fix ${REDACTED}`);
    expect(g.tool).toBe(REDACTED);
    expect(out.snap.options.target).toBe('all');
    expect((out.snap.target as { args: string[] }).args[1]).toBe(`--vault=${REDACTED}`);
    // Server data keeps no own vocabulary: a server tool's "title" is scrubbed.
    const t = snap({ tools: [{ name: 'a', title: word, inputSchema: { type: 'object' } }] });
    expect((redactDeep(t, r).tools[0] as { title: string }).title).toBe(REDACTED);
  });
});

describe('review fixes of P7', () => {
  it('catalog title and docs are kept by position (findings, ignored, manual), not by a ruleId anywhere', () => {
    const word = 'notesvault';
    const r = createRedactor([], [word]);
    const report = buildReport(snap(), { findings: [], ignored: [], skipped: [], rulesRun: 1 }, [], 'error', new Date(0), 1);
    // A server-supplied object with a string ruleId outside SERVER_DATA (under transport).
    (report.snap.transport as unknown as Record<string, unknown>).observedErrors = [{ ruleId: 'x', code: word, title: word, docs: [word] }];
    const out = redactDeep(report, r);
    expect((out.snap.transport as unknown as { observedErrors: Array<Record<string, unknown>> }).observedErrors[0]).toEqual({ ruleId: 'x', code: REDACTED, title: REDACTED, docs: [REDACTED] });
  });

  it('a secret with a run of 40 backslashes scrubs in linear time', () => {
    const r = createRedactor([], [`k${'\\'.repeat(40)}z`]);
    const text = `k${'\\'.repeat(40)}y and more`;
    const t0 = performance.now();
    expect(scrub(text, r)).toBe(text);
    expect(scrub(`[k${'\\'.repeat(40)}z]`, r)).toBe(`[${REDACTED}]`);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

describe('I-A09-6: readBody keeps one copy of the body', () => {
  const body = (parts: Uint8Array[]) => new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(p); c.close(); } }));

  it('the same text from split multi-byte chunks, with no per-chunk Buffer.from copy', async () => {
    const bytes = Buffer.from('{"t":"\u00e9\u20ac\u{1F600} done"}', 'utf8');
    const parts = [bytes.subarray(0, 7), bytes.subarray(7, 9), bytes.subarray(9)].map((b) => new Uint8Array(b));
    const from = vi.spyOn(Buffer, 'from');
    const concat = vi.spyOn(Buffer, 'concat');
    try {
      const read = await readBody(body(parts), 5000);
      expect(read.text).toBe(bytes.toString('utf8'));
      expect(read.bytes).toBe(bytes.length);
      // No chunk is copied on its own (Node itself may call Buffer.from with strings meanwhile).
      expect(from.mock.calls.filter(([x]) => x instanceof Uint8Array)).toEqual([]);
      expect(concat.mock.calls[0][0].every((c, i) => c === parts[i])).toBe(true);
      expect(concat).toHaveBeenCalledTimes(1);
      expect(concat.mock.calls[0][1]).toBe(bytes.length);
    } finally {
      from.mockRestore();
      concat.mockRestore();
    }
  });

  it('past the cap only the kept chunks are joined, without zero padding', async () => {
    const parts = [new Uint8Array(8).fill(97), new Uint8Array(8).fill(98), new Uint8Array(8).fill(99)];
    const read = await readBody(body(parts), 5000, 10, undefined, 100);
    expect(read.truncated).toBe(true);
    expect(read.bytes).toBe(24);
    expect(read.text).toBe('aaaaaaaabbbbbbbb');
  });
});
