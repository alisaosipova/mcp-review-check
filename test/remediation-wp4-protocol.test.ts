// Regression tests for the WP4-protocol remediation pass (review 2026-11-01): src/protocol/{trace,modern,legacy}.ts.
import { describe, expect, it } from 'vitest';
import { buildRedactor, redactDeep } from '../src/redact.js';
import { createRedactor, scrub } from '../src/protocol/trace.js';

describe('scrub: short secrets and the marker (F119)', () => {
  it('masks a short secret only as a whole token, never inside a word or identifier', () => {
    const r = buildRedactor({ headers: { 'X-Api-Key': 'test' } });
    expect(scrub('sk-test-abc, test account, attestation, latest, run_tests', r)).toBe('sk-test-abc, «redacted» account, attestation, latest, run_tests');
    expect(scrub('key=test&x=1 "test" Bearer test', r)).toBe('key=«redacted»&x=1 "«redacted»" Bearer «redacted»');
  });

  it('keeps server data intact with a short --header value', () => {
    const s = redactDeep({ tools: [{ name: 'run_tests', description: 'Runs latest test suite' }] }, buildRedactor({ headers: { 'X-Api-Key': 'test' } }));
    expect(s.tools[0]).toEqual({ name: 'run_tests', description: 'Runs latest «redacted» suite' });
  });

  it('a long secret is still masked inside other text', () => {
    const r = createRedactor([], ['ABCDEFGHIJKLMNOP1']);
    expect(scrub('xxABCDEFGHIJKLMNOP1yy', r)).toBe('xx«redacted»yy');
  });

  it('a secret that is part of the marker does not break a marker put in for another secret', () => {
    const r = createRedactor([], ['ABCDEFGHIJKLMNOP1', 'redact']);
    expect(scrub('token=ABCDEFGHIJKLMNOP1 redact', r)).toBe('token=«redacted» «redacted»');
  });
});
