// Rule catalog output: `explain <ID>`, --list-rules as text, JSON or markdown; rulesMarkdown also
// writes the rule table in docs/RULES.md (scripts/rules-table.mjs), not in the README.
import { CATALOG_DATE } from './catalog.js';
import { MANUAL_ITEMS, RULES } from './rules/index.js';
import type { ManualItem } from './rules/manual.js';
import type { Need, RuleMeta } from './rules/types.js';

/** What a rule's need asks of the run, as a user reads it (the engine's skip reasons name the same conditions). */
const NEED_LABEL: Record<Need, string> = {
  tools: 'tools/list works', resources: 'resources/list works', prompts: 'prompts/list works', ui: 'the server has UI resources',
  http: 'a <url> target', stdio: 'a --stdio target', auth: 'the server asks for OAuth', legacy: 'a 2025-11-25 (or earlier) server',
  modern: 'a 2026-07-28 server', active: '--active', 'active-auth': '--active-auth (<url> only)',
};
const needsText = (needs: Need[]) => needs.map((n) => NEED_LABEL[n]).join(', ');
const FEATURE_LABEL = { ui: 'the server has UI resources', oauth: 'the server asks for OAuth' } as const;

/** Severity by platform, when it runs (needs), rationale, sources, fix and the --ignore hint; undefined for an unknown ID. */
export function explainRule(id: string): string | undefined {
  const key = id.toUpperCase();
  const r = RULES.find((x) => x.id === key);
  const m = MANUAL_ITEMS.find((x) => x.id === key);
  if (m) {
    return [`${m.id}  manual checklist item (never scored) for ${m.platforms.join(', ')}`, '', m.text, '',
      ...(m.feature ? [`Shown when ${FEATURE_LABEL[m.feature]}`, ''] : []),
      'Sources', ...m.docs.map((d) => `  ${d}`), '', `To hide it: --ignore ${m.id}`].join('\n') + '\n';
  }
  if (!r) return undefined;
  const sev = Object.entries(r.severity).map(([p, s]) => `${p}=${s}`).join(', ');
  return [`${r.id}  ${r.title}`, '', `Severity  ${sev}`, ...(r.needs.length ? [`Needs     ${needsText(r.needs)}`] : []), `Why       ${r.rationale}`, `Fix       ${r.fix}`, 'Sources', ...r.sources.map((s) => `  ${s}`), '',
    `To suppress it: --ignore ${r.id}`].join('\n') + '\n';
}

/** The --list-rules table (base format); with verbose, each rule's rationale and needs on the next lines. */
export function listRulesText(rules: RuleMeta[], manual: ManualItem[], verbose = false): string {
  const lines = [`${'ID'.padEnd(9)} ${'SEVERITY BY PLATFORM'.padEnd(46)} TITLE  (SOURCE)`];
  for (const r of rules) {
    const plats = Object.entries(r.severity).map(([p, s]) => `${p}=${s}`).join(', ');
    lines.push(`${r.id.padEnd(9)} ${plats.padEnd(46)} ${r.title}  (${r.sources[0]})`);
    if (verbose) lines.push(`${''.padEnd(10)}${r.rationale}`);
    if (verbose && r.needs.length) lines.push(`${''.padEnd(10)}Needs: ${needsText(r.needs)}`);
  }
  for (const m of manual) lines.push(`${m.id.padEnd(9)} ${`${m.platforms[0]}=manual${m.feature ? ` [${m.feature}]` : ''}`.padEnd(46)} ${m.text}  (${m.docs[0]})`);
  return lines.join('\n') + '\n';
}

/** The catalog as JSON: rule metadata (no check functions) and manual items. */
export function listRulesJson(rules: RuleMeta[], manual: ManualItem[]): string {
  return JSON.stringify({ catalogDate: CATALOG_DATE, rules, manual }, null, 2) + '\n'; // JSON drops each rule's check()
}

/** The markdown rule table and manual checklist (docs/RULES.md, --list-rules --format markdown). */
export function rulesMarkdown(rules: RuleMeta[] = RULES, manual: ManualItem[] = MANUAL_ITEMS): string {
  // A prefix that matches only rules or only MAN items (--list-rules MAN) prints no empty table.
  const lines: string[] = [];
  if (rules.length) lines.push('| ID | Title | Severity by platform | Source |', '|---|---|---|---|');
  for (const r of rules) lines.push(`| ${r.id} | ${r.title.replace(/\|/g, '\\|')} | ${Object.entries(r.severity).map(([p, s]) => `${p}: ${s}`).join(', ')} | [link](${r.sources[0]}) |`);
  if (manual.length) lines.push(...(rules.length ? [''] : []), '**Manual checklist** (printed as reminders; never scored):', '', '| ID | Platform | Reminder |', '|---|---|---|');
  for (const m of manual) lines.push(`| ${m.id} | ${m.platforms.join(', ')}${m.feature ? ` [${m.feature}]` : ''} | ${m.text.replace(/\|/g, '\\|')} |`);
  return lines.join('\n');
}
