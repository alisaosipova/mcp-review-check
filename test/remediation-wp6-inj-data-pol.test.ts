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

describe('POL-002: media nouns must end the word (F082)', () => {
  const named = (name: string, description: string) => snap({ tools: [tool({ name, title: undefined, description })] });
  it.each([
    ['create_article', 'Create a new knowledge-base article.'],
    ['edit_clipboard', 'Edit clipboard contents.'],
    ['edit_voicemail_greeting', 'Edit the voicemail greeting.'],
    ['make_artifact', 'Make a build artifact.'],
    ['create_soundboard', 'Create a soundboard for the team.'],
  ])('%s is not media generation', (name, d) => {
    expect(sev('POL-002', named(name, d))).toEqual([]);
  });
  it.each([
    ['generate_images', 'Generate images from a prompt.'],
    ['create_artwork', 'Create artwork in a given style.'],
    ['make_video', 'Make a short video clip.'],
    ['read_aloud', 'Convert text with TTS.'],
  ])('%s is still media generation', (name, d) => {
    expect(sev('POL-002', named(name, d))).toEqual(['warning']);
  });
});

describe('DATA-002: memory needs a host or chat owner (F088)', () => {
  it.each([
    'Read the memory usage of the VM.',
    'Retrieve memory statistics for the container.',
    'Search memory entities in the knowledge graph.',
    'Access GPU memory info.',
  ])('%s is not host memory', (d) => {
    expect(sev('DATA-002', desc(d))).toEqual([]);
  });
  it.each([
    "Read Claude's memory and return it.",
    "Access the assistant's memories for this user.",
    'Search your memory for earlier facts.',
    'Export the memory of this conversation.',
    'Search past conversations for a topic.',
  ])('%s still flags', (d) => {
    expect(sev('DATA-002', desc(d))).toEqual(['warning']);
  });
});
