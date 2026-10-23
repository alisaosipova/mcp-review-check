import { describe, expect, it } from 'vitest';
import { MANUAL_ITEMS, RULES } from '../src/rules/index.js';

const range = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-${String(i + 1).padStart(3, '0')}`);

/** Frozen ID list: IDs are never reused after removal. Append only. */
const FROZEN = [
  ...range('SRV', 20), ...range('SPEC', 20), ...range('TOOL', 32), ...range('INJ', 10), ...range('DATA', 5),
  ...range('POL', 5), ...range('APPS', 19), ...range('AUTH', 21), ...range('RT', 12), ...range('MAN', 31),
];

describe('rule catalog', () => {
  const ids = [...RULES.map((r) => r.id), ...MANUAL_ITEMS.map((m) => m.id)];

  it('IDs are unique and well-formed', () => {
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^(SRV|SPEC|TOOL|INJ|DATA|POL|APPS|AUTH|RT|MAN)-\d{3}$/);
  });

  it('IDs match the frozen list', () => {
    expect([...ids].sort()).toEqual([...FROZEN].sort());
  });

  it('every rule has a platform, a severity per platform, a source URL, rationale and fix', () => {
    for (const r of RULES) {
      expect(Object.keys(r.severity).length, r.id).toBeGreaterThan(0);
      for (const s of Object.values(r.severity)) expect(['error', 'warning', 'info']).toContain(s);
      expect(r.sources.length, r.id).toBeGreaterThan(0);
      for (const src of r.sources) expect(src, r.id).toMatch(/^https:\/\//);
      expect(r.title && r.rationale && r.fix, r.id).toBeTruthy();
    }
    for (const m of MANUAL_ITEMS) {
      expect(m.platforms.length).toBeGreaterThan(0);
      expect(m.docs[0]).toMatch(/^https:\/\//);
    }
  });
});
