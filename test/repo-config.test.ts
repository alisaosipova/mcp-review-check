// .gitattributes keeps every text file LF on checkout in any OS (Git for Windows runners default to
// core.autocrlf=true, and a CRLF checkout breaks docs.test, output-modes and e2e-http) and marks *.br as binary.
// Asks git itself (git check-attr), so on a baseline without .gitattributes each check fails on an assertion.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const git = (args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

/** `git check-attr <attr>` for each file, as a map file -> value (`lf`, `set`, `unset`, `unspecified`). */
function checkAttr(attr: string, files: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of git(['check-attr', attr, '--', ...files]).split('\n')) {
    const m = line.match(/^(.*): [^:]+: (.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

describe.skipIf(!existsSync(join(ROOT, '.git')))('repository config', () => {
  it('every text file checks out with LF; *.br is binary', () => {
    const named = ['docs/RULES.md', 'test/fixtures/good-server.mjs', 'test/docs.test.ts'];
    expect(checkAttr('eol', named)).toEqual(Object.fromEntries(named.map((f) => [f, 'lf'])));
    const br = 'test/fixtures/real/openzeppelin.json.br';
    expect(checkAttr('binary', [br])).toEqual({ [br]: 'set' });
    // Every other tracked file too: text ones get eol=lf, binary ones are never converted.
    const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean);
    const brFiles = tracked.filter((f) => f.endsWith('.br'));
    const textFiles = tracked.filter((f) => !f.endsWith('.br'));
    expect(checkAttr('eol', textFiles)).toEqual(Object.fromEntries(textFiles.map((f) => [f, 'lf'])));
    expect(checkAttr('text', brFiles)).toEqual(Object.fromEntries(brFiles.map((f) => [f, 'unset'])));
  });
});
