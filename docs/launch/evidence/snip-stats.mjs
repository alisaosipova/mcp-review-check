// Aggregate-only stats over test/fixtures/real (no server names printed).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { brotliDecompressSync } from 'node:zlib';
const R = new URL('../../../', import.meta.url).pathname; // repository root
const { runRules } = await import(R + 'dist/rules/engine.js');
const { RULES } = await import(R + 'dist/rules/index.js');
const { emptySnapshot } = await import(R + 'dist/snapshot.js');
const { fixSnippets } = await import(R + 'dist/report/text.js');
const { toolKind } = await import(R + 'dist/rules/util/text.js');
const names = [...new Set(readdirSync(R + 'test/fixtures/real').filter((f) => /\.json(\.br)?$/.test(f) && !f.startsWith('baseline-')).map((f) => f.replace(/\.json(\.br)?$/, '')))];
let guessReadAuthorWrite=0, guessWriteAuthorRead=0, declaredTrue=0, servers=0, tools=0, withSnippet=0, serversWithSnippet=0, declared=0, agree=0, disagree=0, unknownGuess=0, snippetUnknown=0, snippetRead=0, snippetWrite=0, declaredAll3=0;
for (const n of names) {
  const base = R + `test/fixtures/real/${n}.json`;
  const text = existsSync(base) ? readFileSync(base,'utf8') : brotliDecompressSync(readFileSync(base+'.br')).toString('utf8');
  const raw = JSON.parse(text);
  const snap = emptySnapshot({ kind:'http', urlAsEntered: raw.source, url: new URL(raw.source) }, { target:'all', active:false, activeAuth:false });
  const { capturedAt, source, ...rest } = raw; Object.assign(snap, rest);
  const { findings } = runRules(snap, RULES);
  const sn = fixSnippets({ findings, snap });
  servers++; tools += snap.tools.length; withSnippet += sn.length; if (sn.length) serversWithSnippet++;
  const snNames = new Set(sn.map((s) => s.slice(0, s.indexOf(': '))));
  for (const t of snap.tools) {
    const a = t.annotations ?? {};
    const stripped = { ...t, annotations: Object.fromEntries(Object.entries(a).filter(([k]) => !['readOnlyHint','destructiveHint','openWorldHint'].includes(k))) };
    const k = toolKind(stripped);
    if (snNames.has(t.name)) { if (k==='read') snippetRead++; else if (k==='write') snippetWrite++; else snippetUnknown++; }
    if (['readOnlyHint','destructiveHint','openWorldHint'].every((h) => typeof a[h]==='boolean')) declaredAll3++;
    if (typeof a.readOnlyHint === 'boolean') {
      declared++; if (a.readOnlyHint) declaredTrue++;
      if (k === 'unknown') unknownGuess++;
      const guessRead = k === 'read';
      if (guessRead === a.readOnlyHint) agree++; else { disagree++; if (guessRead) guessReadAuthorWrite++; else guessWriteAuthorRead++; }
    }
  }
}
console.log(JSON.stringify({ servers, tools, toolsWithSnippet: withSnippet, serversWithSnippet, snippetGuessKind: { read: snippetRead, write: snippetWrite, unknown: snippetUnknown }, toolsWithAll3HintsDeclared: declaredAll3, toolsDeclaringReadOnlyHint: declared, nameHeuristicAgreesWithDeclaredReadOnly: agree, disagrees: disagree, ofWhichHeuristicUnknown: unknownGuess, guessReadAuthorWrite, guessWriteAuthorRead, declaredReadOnlyTrue: declaredTrue }, null, 1));
