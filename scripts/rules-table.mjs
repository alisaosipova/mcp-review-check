// Print the rule table from the built catalog: node scripts/rules-table.mjs
// With --write, replaces the block between the RULES markers in docs/RULES.md, and in docs/RULES.md and README.md
// every <!-- CATALOG_DATE -->…<!-- /CATALOG_DATE --> span and the `rules <date>` of the example report header
// with the catalog date (src/catalog.ts).
import { readFileSync, writeFileSync } from 'node:fs';
const { RULES, MANUAL_ITEMS, CATALOG_DATE } = await import('../dist/rules/index.js');
const { rulesMarkdown } = await import('../dist/explain.js');

const table = rulesMarkdown(); // src/explain.ts: one generator for docs/RULES.md and --list-rules --format markdown

if (process.argv.includes('--write')) {
  const start = '<!-- RULES:START -->';
  const end = '<!-- RULES:END -->';
  for (const name of ['../docs/RULES.md', '../README.md']) {
    const file = new URL(name, import.meta.url);
    writeFileSync(file, readFileSync(file, 'utf8')
      .replace(new RegExp(`${start}[\\s\\S]*${end}`), `${start}\n${table}\n${end}`)
      .replace(/<!-- CATALOG_DATE -->[^<]*<!-- \/CATALOG_DATE -->/g, `<!-- CATALOG_DATE -->${CATALOG_DATE}<!-- /CATALOG_DATE -->`)
      .replace(/^(mcp-review-check \S+ · rules )\d{4}-\d{2}-\d{2}/gm, `$1${CATALOG_DATE}`));
  }
  console.error(`docs/RULES.md updated with ${RULES.length} rules and ${MANUAL_ITEMS.length} manual items; catalog date ${CATALOG_DATE} in docs/RULES.md and README.md.`);
} else {
  console.log(table);
}
