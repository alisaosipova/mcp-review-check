#!/usr/bin/env node
// Turn a captured ANSI run (SGR codes 0, 1, 2, 31, 33, 36 only, as src/report/text.ts emits) into a static SVG
// terminal mock. Non-ASCII characters are written as XML character references, so the SVG file is pure ASCII.
// Usage: node docs/launch/render-svg.mjs <in.ansi> <out.svg>
import { readFileSync, writeFileSync } from 'node:fs';

const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) { console.error('usage: render-svg.mjs <in.ansi> <out.svg>'); process.exit(2); }
const lines = readFileSync(inFile, 'utf8').replace(/\n$/, '').split('\n');

const FONT = 13, LH = 17, CW = FONT * 0.602, PAD = 18, BAR = 30;
const FG = '#d4d4d4', BG = '#1e1e1e';
const SGR = { 31: '#f14c4c', 33: '#e5c07b', 36: '#4fc1d9' };
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  .replace(/[^\x20-\x7e]/gu, (c) => `&#${c.codePointAt(0)};`);
const cols = Math.max(...lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').length));
const W = Math.ceil(cols * CW * 1.03 + 2 * PAD), H = BAR + PAD + lines.length * LH + PAD;

// One <text> per styled run, placed at its column: renderers differ on whitespace and tspan advance, so no run
// depends on the width of the one before it.
const body = lines.map((line, i) => {
  let st = { bold: false, dim: false, color: null };
  let col = 0;
  const runs = [];
  const y = BAR + PAD + (i + 1) * LH - 4;
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    const m = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (m) {
      for (const code of m[1].split(';').map(Number)) {
        if (code === 0) st = { bold: false, dim: false, color: null };
        else if (code === 1) st = { ...st, bold: true };
        else if (code === 2) st = { ...st, dim: true };
        else if (SGR[code]) st = { ...st, color: SGR[code] };
      }
      continue;
    }
    const lead = part.length - part.trimStart().length;
    const text = part.trim();
    if (text) {
      const a = [`x="${(PAD + (col + lead) * CW).toFixed(1)}"`, `y="${y}"`];
      if (st.color) a.push(`fill="${st.color}"`);
      if (st.bold) a.push('font-weight="bold"');
      if (st.dim) a.push('fill-opacity="0.6"');
      runs.push(`<text ${a.join(' ')}>${esc(text)}</text>`);
    }
    col += part.length;
  }
  return runs.join('');
}).join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xml:space="preserve" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="mcp-review-check text report: findings, fix snippets, score and per-directory verdicts">
<title>mcp-review-check sample output (captured listing replayed offline; server and tool names redacted)</title>
<rect width="${W}" height="${H}" rx="8" fill="${BG}"/>
<rect width="${W}" height="${BAR}" rx="8" fill="#2d2d2d"/><rect y="${BAR - 8}" width="${W}" height="8" fill="#2d2d2d"/>
<circle cx="18" cy="15" r="6" fill="#ff5f56"/><circle cx="38" cy="15" r="6" fill="#ffbd2e"/><circle cx="58" cy="15" r="6" fill="#27c93f"/>
<text x="${W / 2}" y="19" text-anchor="middle" fill="#9a9a9a" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace" font-size="12">$ mcp-review-check --stdio -- node docs/launch/replay-fixture.mjs &lt;fixture&gt;</text>
<g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace" font-size="${FONT}" fill="${FG}" xml:space="preserve">
${body}
</g>
</svg>
`;
writeFileSync(outFile, svg);
console.log(`${outFile}: ${lines.length} lines, ${cols} columns, ${W}x${H}, ${Buffer.byteLength(svg)} bytes`);
