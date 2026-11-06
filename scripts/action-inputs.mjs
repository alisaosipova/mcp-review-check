#!/usr/bin/env node
// The Action input table in docs/guide/ci.md, generated from action.yml so the two cannot drift (review round 4
// A12-06: the guide said the `version` default was 1.0 while action.yml had 1.1). test/docs.test.ts compares the
// table between the ACTION-INPUTS markers with actionInputsTable().
//
//   node scripts/action-inputs.mjs          print the table
//   node scripts/action-inputs.mjs --write  replace the table in docs/guide/ci.md
//   node scripts/action-inputs.mjs --check  exit 1 when docs/guide/ci.md is stale
//
// action.yml is read line by line (no YAML dependency): every input is a two-space key under `inputs:` with one-line
// `description:` and `default:` values, plain, 'single' or "double" quoted.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const ACTION = `${ROOT}action.yml`;
export const GUIDE = `${ROOT}docs/guide/ci.md`;
export const START = '<!-- ACTION-INPUTS:START -->';
export const END = '<!-- ACTION-INPUTS:END -->';

/** A one-line YAML scalar: 'x''y' -> x'y, "x" -> x, plain -> trimmed. */
function scalar(raw) {
  const v = raw.trim();
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) return v.slice(1, -1).replace(/''/g, "'");
  if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) return JSON.parse(v);
  return v;
}

/** The inputs of action.yml, in file order: { name, description, default }. */
export function actionInputs(text = readFileSync(ACTION, 'utf8')) {
  const lines = text.split(/\r?\n/);
  const at = lines.indexOf('inputs:');
  if (at < 0) throw new Error('action.yml has no inputs: block');
  const inputs = [];
  for (const line of lines.slice(at + 1)) {
    if (/^\S/.test(line)) break;
    const name = line.match(/^ {2}([a-z][a-z0-9-]*):\s*$/);
    if (name) {
      inputs.push({ name: name[1], description: '', default: '' });
      continue;
    }
    const field = line.match(/^ {4}(description|default):\s?(.*)$/);
    if (field && inputs.length) inputs[inputs.length - 1][field[1]] = scalar(field[2]);
  }
  if (!inputs.length) throw new Error('action.yml lists no inputs');
  return inputs;
}

const cell = (s) => s.replace(/\|/g, '\\|');

/** The markdown table: Input, Default, Description. */
export function actionInputsTable(inputs = actionInputs()) {
  return ['| Input | Default | Description |', '|---|---|---|',
    ...inputs.map((i) => `| \`${i.name}\` |${i.default ? ` \`${cell(i.default)}\` ` : ' '}| ${cell(i.description)} |`)].join('\n');
}

/** The guide with the table between the markers replaced. Throws when the markers are missing. */
export function withTable(guide, table = actionInputsTable()) {
  const a = guide.indexOf(START);
  const b = guide.indexOf(END);
  if (a < 0 || b < a) throw new Error(`docs/guide/ci.md has no ${START} ... ${END} markers`);
  return `${guide.slice(0, a + START.length)}\n${table}\n${guide.slice(b)}`;
}

if (/action-inputs\.mjs$/.test(process.argv[1] ?? '')) {
  const mode = process.argv[2];
  if (mode === '--write' || mode === '--check') {
    const guide = readFileSync(GUIDE, 'utf8');
    const next = withTable(guide);
    if (mode === '--write') {
      if (next !== guide) writeFileSync(GUIDE, next);
    } else if (next !== guide) {
      console.error('docs/guide/ci.md: the Action input table is stale; run node scripts/action-inputs.mjs --write');
      process.exit(1);
    }
  } else if (mode === undefined) {
    console.log(actionInputsTable());
  } else {
    console.error('usage: node scripts/action-inputs.mjs [--write | --check]');
    process.exit(2);
  }
}
