import { describe, expect, it } from 'vitest';
import type { Listing, OpenAiListing, PluginListing } from '../../src/listing/types.js';
import { listingRules } from '../../src/rules/listing.js';
import type { Snapshot } from '../../src/snapshot.js';
import { checkCase, snap, tool, type Case } from '../helpers.js';

type Obj = Record<string, any>;
const URL_ = 'https://mcp.acme.test/mcp';

/** A plugin folder that passes every LST plugin rule (the shape of test/fixtures/listing/plugin-valid). */
function goodPlugin(): PluginListing {
  return {
    manifest: {
      path: '.claude-plugin/plugin.json',
      json: {
        name: 'acme-notes', version: '1.2.0', description: 'Search and summarize notes from your Acme workspace.', author: { name: 'Acme' }, license: 'MIT',
        icon: './assets/icon.svg', documentationUrl: 'https://acme.test/docs', supportUrl: 'https://acme.test/support', privacyPolicyUrl: 'https://acme.test/privacy',
      },
    },
    mcp: {
      path: '.mcp.json',
      json: { mcpServers: {
        acme: { type: 'http', url: URL_, headers: { Authorization: 'Bearer ${user_config.api_token}' } },
        local: { command: 'npx', args: ['-y', '@acme/notes-mcp@1.4.2'], env: { ACME_TOKEN: '${user_config.api_token}' } },
      } },
    },
    readme: { path: 'README.md', text: `# Acme Notes\n\n${'Acme Notes searches and summarizes the notes in your workspace. '.repeat(6)}` },
    license: 'LICENSE',
    packageConfigs: [],
    files: [
      { path: '.claude-plugin', size: 0, kind: 'dir' }, { path: '.claude-plugin/plugin.json', size: 300, kind: 'file' },
      { path: '.mcp.json', size: 200, kind: 'file' }, { path: 'LICENSE', size: 40, kind: 'file' }, { path: 'README.md', size: 400, kind: 'file' },
      { path: 'assets', size: 0, kind: 'dir' }, { path: 'assets/icon.svg', size: 120, kind: 'file' },
    ],
  };
}

const POS = Array.from({ length: 5 }, (_, i) => ({ description: `Case ${i}`, prompt: `Find my notes ${i}.`, tools_triggered: 'search_notes, read_note', expected_behavior: 'Return the notes.' }));
const NEG = Array.from({ length: 3 }, (_, i) => ({ description: `No ${i}`, prompt: `Delete everything ${i}.` }));

/** A ChatGPT package (Agent Plugins format) that passes every LST ChatGPT rule. */
function goodOpenAi(): OpenAiListing {
  return {
    format: 'agent-plugins',
    manifest: {
      path: 'plugin.json',
      json: { name: 'acme-notes', version: '1.0.0', extensions: { 'com.openai': {
        interface: {
          displayName: 'Acme Notes', shortDescription: 'Find and summarize your notes', longDescription: 'Search notes in your Acme workspace.',
          developerName: 'Acme', category: 'Productivity', capabilities: ['Search notes'],
          websiteURL: 'https://acme.test/notes', supportURL: 'https://acme.test/support', privacyPolicyURL: 'https://acme.test/privacy', termsOfServiceURL: 'https://acme.test/terms',
          defaultPrompt: ['Find my notes about the launch.', 'Summarize my launch notes.'], brandColor: '#2357C6', brandColorDark: '#8CB4FF',
          composerIcon: './assets/icon.png', logo: './assets/logo.png',
        },
        review: { test_cases: { positive: structuredClone(POS), negative: structuredClone(NEG) }, demo_recording_url: 'https://acme.test/demo' },
        publication: { release_notes: 'Initial release.' },
      } } },
    },
    mcp: { path: 'mcp.json', json: { mcpServers: { notes: { type: 'streamable-http', url: URL_ } } } },
    files: [{ path: 'plugin.json', size: 900, kind: 'file' }, { path: 'mcp.json', size: 90, kind: 'file' }, { path: 'assets', size: 0, kind: 'dir' }],
  };
}

const TOOLS = [tool(), tool({ name: 'read_note', title: 'Read note', description: 'Read one note by id from the Acme Notes API.' })];

function withListing(l: Partial<Listing>, url: string | undefined = URL_): Snapshot {
  return snap({ url, tools: TOOLS, set: (s) => { s.listing = { errors: [], truncated: [], ...l }; } });
}
const P = (edit: (p: PluginListing & Obj) => void = () => {}, url?: string) => () => { const p = goodPlugin(); edit(p as PluginListing & Obj); return withListing({ plugin: p }, url ?? URL_); };
const O = (edit: (o: OpenAiListing & Obj, i: Obj, ext: Obj) => void = () => {}, url?: string) => () => {
  const o = goodOpenAi();
  const ext = (o.manifest.json as Obj).extensions['com.openai'];
  edit(o as OpenAiListing & Obj, ext.interface, ext);
  return withListing({ openai: o }, url ?? URL_);
};
const man = (p: PluginListing & Obj) => p.manifest!.json as Obj;
const servers = (p: { mcp?: { json?: unknown } }) => (p.mcp!.json as Obj).mcpServers;

const cases: Record<string, Case> = {
  'LST-001': { pos: P((p) => { delete p.manifest; }), neg: P(), severity: 'error' },
  // a kebab-case name that merely contains "claude" as a word is not reserved here
  'LST-002': { pos: P((p) => { man(p).name = 'claude-tools'; }), neg: P((p) => { man(p).name = 'notes-for-teams2'; }), severity: 'error', match: /reserved/ },
  'LST-003': { pos: P((p) => { delete man(p).version; }), neg: P(), severity: 'warning', match: /version/ },
  // 40 words of prose plus a code block passes
  'LST-004': { pos: P((p) => { delete p.readme; }), neg: P((p) => { p.readme!.text = `${'word '.repeat(40)}\n\n\`\`\`\nnpm i\n\`\`\`\n`; }), severity: 'error' },
  // the license field alone is enough
  'LST-005': { pos: P((p) => { delete p.license; delete man(p).license; }), neg: P((p) => { delete p.license; }), severity: 'error' },
  'LST-006': { pos: P((p) => { p.mcp = { path: '.mcp.json', error: 'is not valid JSON: Unexpected token' }; }), neg: P(), severity: 'error', match: /can't be parsed/ },
  // a ${user_config.KEY} endpoint is accepted
  'LST-007': { pos: P((p) => { servers(p).acme.url = 'http://mcp.acme.test/mcp'; }), neg: P((p) => { servers(p).acme.url = '${user_config.endpoint}'; }), severity: 'error', match: /not https/ },
  // uvx pkg==x.y.z is pinned
  'LST-008': { pos: P((p) => { servers(p).local.args = ['-y', '@acme/notes-mcp@latest']; }), neg: P((p) => { servers(p).local = { command: 'uvx', args: ['--python', '3.12', 'acme-notes-mcp==2.0.1'] }; }), severity: 'error' },
  // an .npmrc that only sets save-exact sets no package source
  'LST-009': {
    pos: P((p) => { p.packageConfigs = [{ path: '.npmrc', text: '@acme:registry=https://npm.acme.test/\n' }]; }),
    neg: P((p) => { p.packageConfigs = [{ path: '.npmrc', text: 'save-exact=true\nfund=false\n' }]; }), severity: 'error',
  },
  'LST-010': { pos: P((p) => { p.files.push({ path: 'server.mcpb', size: 10, kind: 'file' }); }), neg: P(), severity: 'warning' },
  // Bearer ${user_config.KEY} is the documented form
  'LST-011': { pos: P((p) => { servers(p).acme.headers = { Authorization: 'Bearer ghp_SYNTH0123456789abcdefghijklmnopqrstu' }; }), neg: P(), severity: 'error', match: /value not shown/ },
  // .gitignore and a nested .github folder are not system files
  'LST-012': { pos: P((p) => { p.files.push({ path: 'assets/Thumbs.db', size: 10, kind: 'file' }); }), neg: P((p) => { p.files.push({ path: '.gitignore', size: 10, kind: 'file' }); }), severity: 'error' },
  // a large image is fine
  'LST-013': { pos: P((p) => { p.files.push({ path: 'dist/server.js', size: 300 * 1024, kind: 'file' }); }), neg: P((p) => { p.files.push({ path: 'assets/hero.png', size: 900 * 1024, kind: 'file' }); }), severity: 'warning', match: /256 KiB/ },
  'LST-014': { pos: P((p) => { man(p).supportUrl = 'http://acme.test/support'; }), neg: P(), severity: 'warning', match: /MAN-002/ },
  // one of several remote servers matching the target is enough
  'LST-015': { pos: P((p) => { servers(p).acme.url = 'https://mcp.other.test/mcp'; }), neg: P((p) => { servers(p).docs = { type: 'http', url: 'https://docs.acme.test/mcp' }; }), severity: 'warning' },
  // a Codex manifest with a root interface has listing fields
  'LST-016': {
    pos: O((o) => { o.format = 'mcp-config'; o.manifest = { path: 'mcp.json', json: { mcpServers: {} } }; }),
    neg: O((o, i) => { o.format = 'codex'; (o.manifest.json as Obj).interface = i; }), severity: 'warning', match: /MAN-015/,
  },
  // exactly 30 characters is allowed
  'LST-017': { pos: O((_, i) => { i.displayName = 'Acme Notes for Teams and Enterprises'; }), neg: O((_, i) => { i.displayName = 'A'.repeat(30); }), severity: 'error', match: /MAN-015/ },
  'LST-018': { pos: O((_, i) => { i.supportURL = 'https://user:SYNTHpass@acme.test/support'; }), neg: O(), severity: 'error', match: /embeds credentials.*MAN-016/ },
  // an e-mail address is not an @mention
  'LST-019': { pos: O((_, i) => { i.defaultPrompt = ['a', 'b', 'c', 'd']; }), neg: O((_, i) => { i.defaultPrompt = 'Email my notes to team@acme.test'; }), severity: 'error', match: /MAN-017/ },
  'LST-020': { pos: O((_, i) => { i.brandColor = '#EEEEEE'; }), neg: O((_, i) => { i.brandColor = '#767676'; }), severity: 'error', match: /contrast.*MAN-018/ },
  'LST-021': { pos: O((_, i) => { i.logo = './assets/logo.gif'; }), neg: O((_, i) => { i.logoDark = './assets/logo-dark.webp'; }), severity: 'error', match: /MAN-019/ },
  // a skills-only package (no MCP server) needs no review cases
  'LST-022': { pos: O((_, __, ext) => { ext.review.test_cases.negative.pop(); }), neg: O((o, __, ext) => { delete o.mcp; delete ext.review; }), severity: 'error', match: /exactly 3.*MAN-020/ },
  // clientId alone is the documented provided-client declaration
  'LST-023': {
    pos: O((o) => { servers(o).notes.auth = { type: 'oauth', clientId: 'acme', clientSecret: 'SYNTH-client-secret' }; }),
    neg: O((o) => { servers(o).notes.auth = { type: 'oauth', clientId: 'acme', tokenEndpointAuthMethod: 'none' }; servers(o).notes.headers = {}; }), severity: 'error', match: /value not shown/,
  },
  'LST-024': { pos: O((o) => { servers(o).local = { command: 'node', args: ['server.js'] }; }), neg: O(), severity: 'warning' },
  // tools_triggered as an array of names is read too
  'LST-025': {
    pos: O((_, __, ext) => { ext.review.test_cases.positive[0].tools_triggered = 'search_notes, delete_everything'; }),
    neg: O((_, __, ext) => { ext.review.test_cases.positive[0].tools_triggered = ['search_notes', 'read_note']; }), severity: 'warning', match: /delete_everything/,
  },
  'LST-026': { pos: O(() => {}, 'https://staging.acme.test/mcp'), neg: O(), severity: 'warning' },
};

describe('LST rules', () => {
  it('has a case for every rule', () => expect(Object.keys(cases).sort()).toEqual(listingRules.map((r) => r.id).sort()));
  for (const rule of listingRules) it(`${rule.id} ${rule.title}`, () => checkCase(rule, cases[rule.id]));
});
