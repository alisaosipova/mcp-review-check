// Unit tests for src/rules/manual.ts: which manual checklist items a run shows (F156).
import { describe, expect, it } from 'vitest';
import { MANUAL_ITEMS, manualChecklist } from '../src/rules/manual.js';
import type { AuthProbe } from '../src/snapshot.js';
import { snap, tool } from './helpers.js';

const ids = (s: Parameters<typeof manualChecklist>[0]) => manualChecklist(s).map((i) => i.id);
const oauth: AuthProbe = { trigger: 'preflight-401', prmAttempts: [], prm: { url: 'https://a.test/.well-known/oauth-protected-resource', via: 'header', json: {} }, as: [], timings: {} };
const uiTool = tool({ name: 'show_map', _meta: { ui: { resourceUri: 'ui://map' } } });

describe('MANUAL_ITEMS', () => {
  it('has unique MAN-### ids and an https source for each item', () => {
    expect(new Set(MANUAL_ITEMS.map((i) => i.id)).size).toBe(MANUAL_ITEMS.length);
    for (const i of MANUAL_ITEMS) {
      expect(i.id).toMatch(/^MAN-\d{3}$/);
      expect(i.docs.length, i.id).toBeGreaterThan(0);
      for (const d of i.docs) expect(d, i.id).toMatch(/^https:\/\//);
    }
  });
});

describe('manualChecklist', () => {
  it('--target claude shows Claude and spec items only, without the UI and OAuth ones when neither is found', () => {
    const got = manualChecklist(snap({ target: 'claude' }));
    expect(got.every((i) => i.platforms.every((p) => p === 'claude' || p === 'spec'))).toBe(true);
    expect(got.some((i) => i.feature)).toBe(false);
    expect(got.map((i) => i.id)).toContain('MAN-031');
  });

  it('a UI tool adds the UI items and an OAuth PRM or legacy discovery adds the OAuth items', () => {
    expect(ids(snap({ target: 'claude', tools: [uiTool] }))).toEqual(expect.arrayContaining(['MAN-005', 'MAN-006']));
    expect(ids(snap({ target: 'claude', set: (s) => { s.authProbe = oauth; } }))).toEqual(expect.arrayContaining(['MAN-007', 'MAN-008', 'MAN-013']));
    const legacy = ids(snap({ target: 'chatgpt', set: (s) => { s.authProbe = { ...oauth, prm: undefined, legacyDiscovery: true }; } }));
    expect(legacy).toEqual(expect.arrayContaining(['MAN-026', 'MAN-028']));
    expect(legacy).not.toContain('MAN-001');
  });

  it('a 401 without any OAuth discovery does not count as OAuth', () => {
    expect(ids(snap({ set: (s) => { s.authProbe = { ...oauth, prm: undefined }; } }))).not.toContain('MAN-007');
  });

  it('MAN-031 names the checked URL over HTTP, without the credentials, and keeps <url> for stdio', () => {
    const http = manualChecklist(snap({ url: 'https://user:pw@mcp.acme.test/mcp' })).find((i) => i.id === 'MAN-031')!;
    expect(http.text).toContain('--url https://mcp.acme.test/mcp');
    expect(http.text).not.toContain('pw@');
    expect(manualChecklist(snap()).find((i) => i.id === 'MAN-031')!.text).toContain('--url <url>');
    expect(MANUAL_ITEMS.find((i) => i.id === 'MAN-031')!.text).toContain('<url>'); // the catalog entry is not changed
  });
});
