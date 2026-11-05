// 1.1.0 integration: the integrator notes and open low findings of the Q3, Q4 and Q5 packages that only docs,
// workflows or the wiring between modules can show.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const flat = (p: string) => read(p).replace(/\s+/g, ' ');

describe('Q3 note 4: the pinning advice mentions the shrinkwrap', () => {
  it.each(['README.md', 'docs/guide/ci.md'])('%s says the package fixes its tree but the version input still floats', (file) => {
    const text = flat(file);
    expect(text).toMatch(/pin a full (release )?tag.{0,30}? or a commit SHA\. .{0,40}?npm-shrinkwrap\.json/i);
    expect(text).toMatch(/npm-shrinkwrap\.json.{0,120}?`version` input.{0,60}?patch/i);
  });
});
