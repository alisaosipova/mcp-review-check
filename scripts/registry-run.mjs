#!/usr/bin/env node
// Drive the pre-registered registry sample: attempt each chosen row once, in shuffled order, one at a time.
// Usage: npm run build && node scripts/registry-run.mjs [--dir .captures/registry-2026-11-04] [--limit <k>]
// Reads the "Selection rule" section of <dir>/SAMPLE.md (seed and n), recomputes the rows with registry-sample.mjs,
// skips rows whose Outcome is no longer "pending" (resume), and runs capture-to.mjs per row with a 2 s pause,
// a 45 s hard kill per child and one retry only on timeout. Writes only the outcome class back into SAMPLE.md
// (auth-required, token-rejected, connect-failed, list-failed, timeout, error, captured); no response bodies.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pick } from './registry-sample.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const dir = resolve(arg('--dir') ?? fileURLToPath(new URL('../.captures/registry-2026-11-04', import.meta.url)));
const limit = arg('--limit') ? Number(arg('--limit')) : Infinity;
const samplePath = `${dir}/SAMPLE.md`;
const captureTo = fileURLToPath(new URL('./capture-to.mjs', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const text = readFileSync(samplePath, 'utf8');
const seed = /Seed string: "([^"]+)"/.exec(text)?.[1];
const n = Number(/^- Sample: (\d+) candidates/m.exec(text)?.[1]);
if (!seed || !n) { console.error('no Selection rule (seed, sample size) in SAMPLE.md'); process.exit(2); }
const rowRe = /^\| (\d+) \| ([^|]*) \| ([^|]*) \| ([^|]*) \| ([^|]*) \|$/;
const table = new Map();
for (const l of text.split('\n')) { const m = rowRe.exec(l); if (m) table.set(Number(m[1]), { url: m[4].trim(), outcome: m[5].trim() }); }
const order = pick(table.size, n, seed);

function setOutcome(row, outcome) {
  const lines = readFileSync(samplePath, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.startsWith(`| ${row} |`));
  if (i < 0) throw new Error(`row ${row} missing`);
  lines[i] = lines[i].replace(/\| [^|]* \|$/, `| ${outcome} |`);
  writeFileSync(samplePath, lines.join('\n'));
}

function runOnce(slug, url) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [captureTo, dir, slug, url], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', killed = false;
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const t = setTimeout(() => { killed = true; child.kill('SIGKILL'); }, 45000);
    child.on('close', (code) => {
      clearTimeout(t);
      if (killed) return done('timeout');
      if (code === 0) return done('captured');
      if (code !== 1) return done('error');
      const level = /^([a-z-]+):/.exec(err.trim())?.[1];
      const reason = err.slice(level ? level.length + 1 : 0);
      if (/time[d ]?\s?out|timeout|aborted due to timeout/i.test(reason)) return done('timeout');
      if (['auth-required', 'token-rejected', 'connect-failed', 'list-failed'].includes(level)) return done(level);
      return done('error');
    });
    child.on('error', () => { clearTimeout(t); done('error'); });
  });
}

let done = 0, first = true;
for (const [pos, row] of order.entries()) {
  const entry = table.get(row);
  if (!entry) { console.error(`hard failure: row ${row} not in table (position ${pos + 1})`); process.exit(3); }
  if (entry.outcome !== 'pending') continue;
  if (done >= limit) break;
  if (!first) await sleep(2000);
  first = false;
  let outcome = await runOnce(`r${row}`, entry.url);
  if (outcome === 'timeout') { await sleep(2000); outcome = await runOnce(`r${row}`, entry.url); }
  setOutcome(row, outcome);
  done++;
  console.log(`${pos + 1}/${order.length} row ${row}: ${outcome}`);
}
const final = readFileSync(samplePath, 'utf8').split('\n').map((l) => rowRe.exec(l)).filter(Boolean);
const chosen = new Set(order);
const tally = {};
for (const m of final) if (chosen.has(Number(m[1]))) tally[m[5].trim()] = (tally[m[5].trim()] ?? 0) + 1;
console.log(JSON.stringify(tally));
