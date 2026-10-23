// Print the README rule table from the built catalog: node scripts/rules-table.mjs
// With --write, replaces the block between the RULES markers in README.md and every
// <!-- CATALOG_DATE -->…<!-- /CATALOG_DATE --> span with the catalog date (src/catalog.ts).
import { readFileSync, writeFileSync } from 'node:fs';
const { RULES, MANUAL_ITEMS, CATALOG_DATE } = await import('../dist/rules/index.js');
const { rulesMarkdown } = await import('../dist/explain.js');

const table = rulesMarkdown(); // src/explain.ts: one generator for the README and --list-rules --format markdown

if (process.argv.includes('--write')) {
  const file = new URL('../README.md', import.meta.url);
  const readme = readFileSync(file, 'utf8');
  const start = '<!-- RULES:START -->';
  const end = '<!-- RULES:END -->';
  const next = readme
    .replace(new RegExp(`${start}[\\s\\S]*${end}`), `${start}\n${table}\n${end}`)
    .replace(/<!-- CATALOG_DATE -->[^<]*<!-- \/CATALOG_DATE -->/g, `<!-- CATALOG_DATE -->${CATALOG_DATE}<!-- /CATALOG_DATE -->`);
  writeFileSync(file, next);
  console.error(`README.md updated with ${RULES.length} rules, ${MANUAL_ITEMS.length} manual items and catalog date ${CATALOG_DATE}.`);
} else {
  console.log(table);
}
