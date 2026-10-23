// Rule catalog date: the single source for the CLI header, DISCLAIMER, JSON report and README (scripts/rules-table.mjs).
export const CATALOG_DATE = '2026-10-22';

/** Older than this, a check run warns on stderr that the directory requirements may have moved on. */
export const CATALOG_STALE_DAYS = 90;

/** Whole days between CATALOG_DATE (UTC midnight) and `now`; never negative. */
export function catalogAgeDays(now: Date = new Date(), date: string = CATALOG_DATE): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000));
}

/** The stderr line for a stale catalog, or undefined while it is fresh. */
export function staleCatalogWarning(now: Date = new Date(), date: string = CATALOG_DATE): string | undefined {
  const age = catalogAgeDays(now, date);
  if (age <= CATALOG_STALE_DAYS) return undefined;
  return `warning: the rule catalog is ${age} days old (rules ${date}); directory requirements may have changed since. Check for a newer mcp-review-check release.\n`;
}
