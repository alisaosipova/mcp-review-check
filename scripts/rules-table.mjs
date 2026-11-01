// Print the rule table from the built catalog: node scripts/rules-table.mjs
// With --write, updates the generated parts of docs/RULES.md, README.md and docs/design/spec.md:
// - the block between the RULES markers (docs/RULES.md);
// - every <!-- CATALOG_DATE -->…<!-- /CATALOG_DATE --> span (the catalog date, src/catalog.ts);
// - every <!-- RULE_COUNT -->…<!-- /RULE_COUNT --> and <!-- MANUAL_COUNT -->…<!-- /MANUAL_COUNT --> span
//   (the number of automated rules and of manual checklist items);
// - the example report header `mcp-review-check <version> · rules <date>` (version from package.json).
// CI runs it and fails on a diff, so none of these can drift from the code.
import { readFileSync, writeFileSync } from 'node:fs';
const { RULES, MANUAL_ITEMS, CATALOG_DATE } = await import('../dist/rules/index.js');
const { rulesMarkdown } = await import('../dist/explain.js');
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const table = rulesMarkdown(); // src/explain.ts: one generator for docs/RULES.md and --list-rules --format markdown

/** Replaces the content of every `<!-- NAME -->…<!-- /NAME -->` span with `value`. */
const span = (text, name, value) =>
  text.replace(new RegExp(`<!-- ${name} -->[^<]*<!-- /${name} -->`, 'g'), `<!-- ${name} -->${value}<!-- /${name} -->`);

if (process.argv.includes('--write')) {
  const start = '<!-- RULES:START -->';
  const end = '<!-- RULES:END -->';
  const files = ['docs/RULES.md', 'README.md', 'docs/design/spec.md'];
  for (const name of files) {
    const file = new URL(`../${name}`, import.meta.url);
    let text = readFileSync(file, 'utf8')
      .replace(new RegExp(`${start}[\\s\\S]*${end}`), `${start}\n${table}\n${end}`)
      .replace(/^mcp-review-check \S+ · rules \d{4}-\d{2}-\d{2}/gm, `mcp-review-check ${version} · rules ${CATALOG_DATE}`);
    text = span(text, 'CATALOG_DATE', CATALOG_DATE);
    text = span(text, 'RULE_COUNT', RULES.length);
    text = span(text, 'MANUAL_COUNT', MANUAL_ITEMS.length);
    writeFileSync(file, text);
  }
  console.error(`${files.join(', ')} updated: ${RULES.length} rules, ${MANUAL_ITEMS.length} manual items, catalog date ${CATALOG_DATE}, version ${version}.`);
} else {
  console.log(table);
}
