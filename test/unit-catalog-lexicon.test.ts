// Unit tests for src/catalog.ts (catalog age and the stale warning) and src/rules/lexicon.ts (verb sets) (F156).
import { describe, expect, it } from 'vitest';
import { CATALOG_DATE, CATALOG_STALE_DAYS, catalogAgeDays, staleCatalogWarning } from '../src/catalog.js';
import { ALL_VERBS, HARD_DESTRUCTIVE, IRREVERSIBLE, READ_VERBS, WRITE_VERBS } from '../src/rules/lexicon.js';

describe('catalog', () => {
  const day = (d: string) => new Date(`${d}T12:00:00Z`);

  it('CATALOG_DATE is a real YYYY-MM-DD date', () => {
    expect(CATALOG_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${CATALOG_DATE}T00:00:00Z`).toISOString().slice(0, 10)).toBe(CATALOG_DATE);
  });

  it('counts whole UTC days and never goes negative', () => {
    expect(catalogAgeDays(day('2026-01-01'), '2026-01-01')).toBe(0);
    expect(catalogAgeDays(day('2026-01-31'), '2026-01-01')).toBe(30);
    expect(catalogAgeDays(day('2025-12-01'), '2026-01-01')).toBe(0);
  });

  it('warns only past CATALOG_STALE_DAYS, naming the age and the date', () => {
    const base = new Date('2026-01-01T00:00:00Z').getTime();
    const at = (days: number) => new Date(base + days * 86_400_000 + 3_600_000);
    expect(staleCatalogWarning(at(CATALOG_STALE_DAYS), '2026-01-01')).toBeUndefined();
    const w = staleCatalogWarning(at(CATALOG_STALE_DAYS + 1), '2026-01-01');
    expect(w).toBe(`warning: the rule catalog is ${CATALOG_STALE_DAYS + 1} days old (rules 2026-01-01); directory requirements may have changed since. Check for a newer mcp-review-check release.\n`);
  });
});

describe('lexicon', () => {
  it('read and write verbs do not overlap, and ALL_VERBS is their union', () => {
    expect([...READ_VERBS].filter((v) => WRITE_VERBS.has(v))).toEqual([]);
    expect(ALL_VERBS.size).toBe(READ_VERBS.size + WRITE_VERBS.size);
  });

  it('every hard-destructive verb is irreversible, and every irreversible verb is a write verb', () => {
    for (const v of HARD_DESTRUCTIVE) expect(IRREVERSIBLE.has(v), v).toBe(true);
    for (const v of IRREVERSIBLE) expect(WRITE_VERBS.has(v), v).toBe(true);
  });

  it('verbs are lowercase single words (tool names are matched after splitting and lower-casing)', () => {
    for (const v of ALL_VERBS) expect(v).toMatch(/^[a-z]+$/);
    expect(READ_VERBS.has('get') && WRITE_VERBS.has('delete') && HARD_DESTRUCTIVE.has('delete')).toBe(true);
    expect(HARD_DESTRUCTIVE.has('send')).toBe(false);
  });
});
