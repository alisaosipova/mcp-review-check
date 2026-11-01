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

describe('INJ-007: self references and the server\'s own brand are exempt (F093, F097)', () => {
  const slack = (d: string) => snap({ tools: [tool({ name: 'post_message', description: d })], set: (s) => { s.serverInfo = { name: 'slack-mcp', title: 'Slack', version: '1.0.0' }; } });
  it.each(['Use this app to track your workouts and meals.', 'Use our app to see more.'])('%s is the app describing itself', (d) => {
    expect(sev('INJ-007', desc(d))).toEqual([]);
  });
  it('the Slack server may name its own Slack connector', () => {
    expect(sev('INJ-007', slack('Post a message via the Slack connector.'))).toEqual([]);
    expect(sev('INJ-007', slack('Call the Slack connector to post a message.'))).toEqual([]);
  });
  it('the server may name its own product; another product of the same vendor is still flagged', () => {
    expect(sev('INJ-007', desc('Use our Acme Notes app to keep notes.'))).toEqual([]);
    expect(sev('INJ-007', desc('Use the Acme Billing app to pay.'))).toEqual(['warning']);
  });
  it('another server naming Slack or Gmail is still flagged', () => {
    expect(sev('INJ-007', desc('Post a message via the Slack connector.'))).toEqual(['warning']);
    expect(sev('INJ-007', desc('Call the Slack connector to post.'))).toEqual(['warning']);
    expect(sev('INJ-007', slack('Then call the Gmail connector to send it.'))).toEqual(['warning']);
  });
});

describe('POL-001: money verbs are whole name tokens (F083)', () => {
  const t = (name: string, description: string) => snap({ tools: [tool({ name, description, annotations: { readOnlyHint: false } })] });
  it.each([
    ['get_bestsellers', 'List bestselling products currently in stock.'],
    ['list_stakeholders', 'List project stakeholders and their shares of the budget.'],
    ['send_email', 'Send an email; mention the bank holiday if relevant.'],
    ['update_wireframe', 'Update the wireframe on the bank landing page.'],
    ['register_trademark', 'Register a trademark for a bank.'],
  ])('%s is not a transfer', (name, d) => {
    expect(sev('POL-001', t(name, d))).toEqual([]);
  });
  it.each([
    ['transfer_funds', 'Transfer money between accounts.'],
    ['sendMoney', 'Send money to a contact.'],
    ['buy_stock', 'Buy a stock at market price.'],
    ['place_order', 'Place a buy order for shares.'],
    ['create_payment', 'Create a payment from the bank account.'],
    ['executeTrade', 'Execute a crypto trade.'],
  ])('%s is still a transfer', (name, d) => {
    expect(sev('POL-001', t(name, d))).toEqual(['warning']);
  });
});
