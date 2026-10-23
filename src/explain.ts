// Rule catalog output: `explain <ID>` (R-38), --list-rules as text, JSON or markdown (R-39); rulesMarkdown also
// writes the rule table in docs/RULES.md (scripts/rules-table.mjs), not in the README.
import { CATALOG_DATE } from './catalog.js';
import { MANUAL_ITEMS, RULES } from './rules/index.js';
import type { ManualItem } from './rules/manual.js';
import type { RuleMeta } from './rules/types.js';

/** Severity by platform, rationale, sources, fix and the --ignore hint; undefined for an unknown ID. */
export function explainRule(id: string): string | undefined {
  const key = id.toUpperCase();
  const r = RULES.find((x) => x.id === key);
  const m = MANUAL_ITEMS.find((x) => x.id === key);
  if (m) return `${m.id}  manual checklist item (never scored) for ${m.platforms.join(', ')}\n\n${m.text}\n\nSources\n${m.docs.map((d) => `  ${d}`).join('\n')}\n`;
  if (!r) return undefined;
  const sev = Object.entries(r.severity).map(([p, s]) => `${p}=${s}`).join(', ');
  return [`${r.id}  ${r.title}`, '', `Severity  ${sev}`, `Why       ${r.rationale}`, `Fix       ${r.fix}`, 'Sources', ...r.sources.map((s) => `  ${s}`), '',
    `To suppress it: --ignore ${r.id}`].join('\n') + '\n';
}

/** The --list-rules table (base format); with verbose, each rule's rationale on the next line. */
export function listRulesText(rules: RuleMeta[], manual: ManualItem[], verbose = false): string {
  const lines = [`${'ID'.padEnd(9)} ${'SEVERITY BY PLATFORM'.padEnd(46)} TITLE  (SOURCE)`];
  for (const r of rules) {
    const plats = Object.entries(r.severity).map(([p, s]) => `${p}=${s}`).join(', ');
    lines.push(`${r.id.padEnd(9)} ${plats.padEnd(46)} ${r.title}  (${r.sources[0]})`);
    if (verbose) lines.push(`${''.padEnd(10)}${r.rationale}`);
  }
  for (const m of manual) lines.push(`${m.id.padEnd(9)} ${`${m.platforms[0]}=manual`.padEnd(46)} ${m.text}  (${m.docs[0]})`);
  return lines.join('\n') + '\n';
}

/** The catalog as JSON: rule metadata (no check functions) and manual items. */
export function listRulesJson(rules: RuleMeta[], manual: ManualItem[]): string {
  return JSON.stringify({ catalogDate: CATALOG_DATE, rules, manual }, null, 2) + '\n'; // JSON drops each rule's check()
}

/** The markdown rule table and manual checklist (docs/RULES.md, --list-rules --format markdown). */
export function rulesMarkdown(rules: RuleMeta[] = RULES, manual: ManualItem[] = MANUAL_ITEMS): string {
  const lines = ['| ID | Title | Severity by platform | Source |', '|---|---|---|---|'];
  for (const r of rules) lines.push(`| ${r.id} | ${r.title.replace(/\|/g, '\\|')} | ${Object.entries(r.severity).map(([p, s]) => `${p}: ${s}`).join(', ')} | [link](${r.sources[0]}) |`);
  lines.push('', '**Manual checklist** (printed as reminders; never scored):', '', '| ID | Platform | Reminder |', '|---|---|---|');
  for (const m of manual) lines.push(`| ${m.id} | ${m.platforms.join(', ')}${m.feature ? ` [${m.feature}]` : ''} | ${m.text.replace(/\|/g, '\\|')} |`);
  return lines.join('\n');
}
