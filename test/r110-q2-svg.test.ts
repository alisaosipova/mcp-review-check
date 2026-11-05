// 1.1.0, package Q2: A06-06 a text file that mentions <svg is not an SVG.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';
import { imageInfo, sniffFormat } from '../src/listing/image.js';
const run = (args: string[]) => runCli(args, {}, false);
type F = { ruleId: string; severity: string; message: string; path?: string };
const findings = (stdout: string): F[] => JSON.parse(stdout).findings;

let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mrc-r110q2-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('A06-06 a text file that only mentions <svg is not an SVG image', () => {
  it('a .png that is text with an <svg tag in its first 4 KiB has no format', () => {
    const notes = Buffer.from('Icon notes: export the logo with <svg width="512"> and save it as PNG.\n');
    expect(sniffFormat(notes)).toBeUndefined();
    expect(imageInfo(notes)).toEqual({});
    expect(sniffFormat(Buffer.from('<!-- <svg width="4" height="4"> -->'))).toBeUndefined();
    expect(sniffFormat(Buffer.from('<html><body><svg width="4" height="4"></svg></body></html>'))).toBeUndefined();
    expect(imageInfo(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>'))).toEqual({ format: 'svg', size: { width: 64, height: 64 } });
  });

  it('LST-027 reports that .png as not an image', async () => {
    const root = join(dir, 'pkg');
    mkdirSync(join(root, 'assets'), { recursive: true });
    writeFileSync(join(root, 'assets', 'logo.png'), 'Icon notes: export the logo with <svg width="512"> later.\n');
    const manifest = join(root, 'plugin.json');
    writeFileSync(manifest, JSON.stringify({ name: 'acme', version: '1.0.0', extensions: { 'com.openai': { interface: { displayName: 'Acme', logo: './assets/logo.png', composerIcon: './assets/logo.png' } } } }));
    const f = findings((await run(['--openai-manifest', manifest, '--target', 'chatgpt', '--format', 'json'])).stdout).filter((x) => x.ruleId === 'LST-027');
    expect(f.map((x) => x.message).join('\n')).toMatch(/is not a PNG, JPEG, WebP or SVG image/);
  });
});
