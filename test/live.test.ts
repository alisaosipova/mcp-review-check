// Network smoke tests against public servers. Opt-in: MCP_REVIEW_CHECK_LIVE=1 (excluded from CI).
import { describe, expect, it } from 'vitest';
import { cli } from './cli-runner.js';

const LIVE = !!process.env.MCP_REVIEW_CHECK_LIVE;

describe.skipIf(!LIVE)('live smoke tests', () => {
  it('DeepWiki (public, no auth)', async () => {
    const r = await cli(['https://mcp.deepwiki.com/mcp', '--format', 'json']);
    expect([0, 1]).toContain(r.code);
    expect(r.json.coverage.toolLevel).toBe('ok');
    expect(r.json.server.era).not.toBe('unknown');
  });

  it('Cloudflare docs (public)', async () => {
    const r = await cli(['https://docs.mcp.cloudflare.com/mcp', '--format', 'json']);
    expect([0, 1]).toContain(r.code);
  });

  it.each(['https://mcp.linear.app/mcp', 'https://mcp.notion.com/mcp'])('%s (OAuth probe only)', async (url) => {
    const r = await cli([url, '--format', 'json']);
    expect(r.json.coverage.toolLevel).toBe('auth-required');
    expect(r.json.server.auth).toMatch(/^OAuth/);
    expect(r.json.skipped.some((x: any) => x.ruleId === 'AUTH-004')).toBe(false);
  });
});
