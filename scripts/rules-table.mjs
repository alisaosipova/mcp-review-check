// Print the README rule table from the built catalog: node scripts/rules-table.mjs
// With --write, replaces the block between the RULES markers in README.md.
import { readFileSync, writeFileSync } from 'node:fs';
const { RULES, MANUAL_ITEMS } = await import('../dist/rules/index.js');

const esc = (s) => String(s).replace(/\|/g, '\\|');
const sev = (r) => Object.entries(r.severity).map(([p, s]) => `${p}: ${s}`).join(', ');
const lines = ['| ID | Title | Severity by platform | Source |', '|---|---|---|---|'];
for (const r of RULES) lines.push(`| ${r.id} | ${esc(r.title)} | ${sev(r)} | [link](${r.sources[0]}) |`);
lines.push('', '**Manual checklist** (printed as reminders; never scored):', '', '| ID | Platform | Reminder |', '|---|---|---|');
for (const m of MANUAL_ITEMS) lines.push(`| ${m.id} | ${m.platforms.join(', ')}${m.feature ? ` [${m.feature}]` : ''} | ${esc(m.text)} |`);
const table = lines.join('\n');

if (process.argv.includes('--write')) {
  const file = new URL('../README.md', import.meta.url);
  const readme = readFileSync(file, 'utf8');
  const start = '<!-- RULES:START -->';
  const end = '<!-- RULES:END -->';
  const next = readme.replace(new RegExp(`${start}[\\s\\S]*${end}`), `${start}\n${table}\n${end}`);
  writeFileSync(file, next);
  console.error(`README.md updated with ${RULES.length} rules and ${MANUAL_ITEMS.length} manual items.`);
} else {
  console.log(table);
}
