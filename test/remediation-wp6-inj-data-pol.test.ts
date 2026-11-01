// Regression tests for the WP6 remediation of the INJ, DATA and POL rules (review 2026-11-01).
import { describe, expect, it } from 'vitest';
import { dataRules } from '../src/rules/data.js';
import { injectionRules } from '../src/rules/injection.js';
import { policyRules } from '../src/rules/policy.js';
import type { Rule } from '../src/rules/types.js';
import type { Snapshot } from '../src/snapshot.js';
import { evaluate, snap, tool, toolWithProps } from './helpers.js';

const rule = (id: string): Rule => [...injectionRules, ...dataRules, ...policyRules].find((r) => r.id === id)!;
const desc = (d: string, over: Record<string, unknown> = {}) => snap({ tools: [tool({ description: d, ...over })] });
const str = (description = 'A parameter') => ({ type: 'string', description });
/** Severities of one rule's findings, in order. */
const sev = (id: string, s: Snapshot) => evaluate(rule(id), s, true).map((f) => f.severity);

describe('DATA-001: bare transcript is a weak name (F087)', () => {
  it('a meeting transcript parameter is a warning, not an error', () => {
    expect(sev('DATA-001', snap({ tools: [toolWithProps('summarize_meeting', { transcript: str('The meeting transcript text') })] }))).toEqual(['warning']);
  });
  it('a boolean transcript flag is not flagged', () => {
    expect(sev('DATA-001', snap({ tools: [toolWithProps('get_captions', { transcript: { type: 'boolean', description: 'Include the transcript' } })] }))).toEqual([]);
  });
  it('chat_transcript and conversation_transcript stay errors', () => {
    expect(sev('DATA-001', snap({ tools: [toolWithProps('a', { chat_transcript: str() }), toolWithProps('b', { conversation_transcript: str() })] }))).toEqual(['error', 'error']);
  });
});
