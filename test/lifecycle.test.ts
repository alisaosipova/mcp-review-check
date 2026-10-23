// Release lifecycle: single-source version.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { initializeBody } from '../src/probe/network.js';
import { CLIENT_INFO } from '../src/protocol/modern.js';
import { VERSION } from '../src/version.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** Every .ts file under src/, relative to src/. */
function sourceFiles(dir = SRC, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(join(dir, e.name), `${prefix}${e.name}/`) : e.name.endsWith('.ts') ? [`${prefix}${e.name}`] : []);
}

describe('version', () => {
  it('comes from package.json everywhere it is sent', () => {
    expect(VERSION).toBe(pkg.version);
    expect(CLIENT_INFO.version).toBe(VERSION);
    expect(initializeBody().params.clientInfo.version).toBe(VERSION);
  });

  it('R-2: no version literal in src/', () => {
    const literal = new RegExp(`(['"\`])${pkg.version.replace(/\./g, '\\.')}\\1`);
    const files = sourceFiles();
    expect(files).toContain('version.ts');
    expect(files.filter((f) => literal.test(readFileSync(join(SRC, f), 'utf8')))).toEqual([]);
  });
});
