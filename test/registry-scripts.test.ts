// The registry sample scripts (scripts/registry-sample.mjs, registry-run.mjs, capture-to.mjs) read URLs from a
// public registry anyone can write to: the address filter and the capture refusal keep them off private networks.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript module without types
import { excluded, isPublicAddress, pick } from '../scripts/registry-sample.mjs';

const CAPTURE = fileURLToPath(new URL('../scripts/capture-to.mjs', import.meta.url));

describe('registry sample address filter', () => {
  it('treats loopback, private, link-local, CGNAT, reserved and IPv6 local ranges as non-public', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1',
      '::1', '::', 'fd00::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '[::1]', '2001:db8::1', 'not-an-ip']) expect(isPublicAddress(ip), ip).toBe(false);
    for (const ip of ['1.1.1.1', '8.8.8.8', '140.82.121.4', '2606:4700:4700::1111', '::ffff:1.1.1.1']) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it('excludes local, private-literal, reserved and template URLs by their text', () => {
    const why = (u: string) => excluded(new URL(u));
    expect(why('https://localhost/mcp')).toBe('local');
    expect(why('https://db.internal/mcp')).toBe('local');
    expect(why('https://10.0.0.5/mcp')).toBe('local');
    expect(why('https://[fd12::1]/mcp')).toBe('local');
    expect(why('https://100.64.1.1/mcp')).toBe('local');
    expect(why('https://mcp.example.com/mcp')).toBe('example');
    expect(why('https://{tenant}.acme.io/mcp')).toBe('template');
    expect(why('https://mcp.acme.io/mcp')).toBeUndefined();
  });
});

describe('registry sample selection', () => {
  it('is deterministic for a seed, unique, within range, and changes with the seed', () => {
    const a = pick(1000, 50, 'seed-a');
    expect(pick(1000, 50, 'seed-a')).toEqual(a);
    expect(new Set(a).size).toBe(50);
    expect(a.every((r: number) => r >= 1 && r <= 1000)).toBe(true);
    expect(pick(1000, 50, 'seed-b')).not.toEqual(a);
  });
});

describe('capture-to refuses non-public targets', () => {
  const run = (url: string) => spawnSync(process.execPath, [CAPTURE, fileURLToPath(new URL('../.captures/test-unused', import.meta.url)), 'x', url], { encoding: 'utf8', timeout: 30000 });
  it('a loopback literal and a name that resolves to loopback exit 1 as connect-failed without connecting', () => {
    for (const url of ['https://127.0.0.1:9/mcp', 'https://localhost:9/mcp']) {
      const r = run(url);
      expect(r.status, r.stderr).toBe(1);
      expect(r.stderr).toMatch(/^connect-failed: the host resolves to a non-public address/);
    }
  });
  it('a plain http URL is not captured', () => {
    const r = run('http://1.1.1.1/mcp');
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^connect-failed: only https URLs are captured/);
  });
});
