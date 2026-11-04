#!/usr/bin/env node
// Turn a captured ANSI run (SGR codes 0, 1, 2, 31, 33, 36 only, as src/report/text.ts emits) into a static SVG
// terminal mock that reads the same in every renderer (GitHub, browsers, librsvg, ImageMagick).
//  - One <text> per styled run, placed at its column, with textLength set to its column width: the layout no
//    longer depends on the viewer's monospace font (a wider fallback font is squeezed to fit, not pushed into
//    the next run), and renderers without <tspan> flow (ImageMagick) still place every run correctly.
//  - Leading spaces become the x offset, not whitespace, so no renderer can collapse the indent.
//  - Lines longer than --cols wrap at a space, continuing under the text after the line's marker.
//  - Non-ASCII characters are written as XML character references, so the file is pure ASCII.
// Usage: node docs/launch/render-svg.mjs <in.ansi> <out.svg> [--title "$ command"] [--lines N] [--cols N]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { title: { type: 'string', default: '' }, lines: { type: 'string' }, cols: { type: 'string', default: '100' } },
});
const [inFile, outFile] = positionals;
if (!inFile || !outFile) {
  console.error('usage: render-svg.mjs <in.ansi> <out.svg> [--title "$ command"] [--lines N] [--cols N]');
  process.exit(2);
}
let src = readFileSync(inFile, 'utf8').replace(/\n+$/, '').split('\n');
if (values.lines) src = src.slice(0, Number(values.lines));
while (src.length && !src[src.length - 1].replace(/\x1b\[[0-9;]*m/g, '').trim()) src.pop();
const MAXCOLS = Number(values.cols);

const FONT = 15, LH = 21, CW = FONT * 0.6, PAD = 20, BAR = 34;
const FG = '#d4d4d4', BG = '#1e1e1e', DIM = '#8b8b8b';
const SGR = { 31: '#f14c4c', 33: '#e5c07b', 36: '#4fc1d9' };
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace";
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  .replace(/[^\x20-\x7e]/gu, (c) => `&#${c.codePointAt(0)};`);

// Parse one ANSI line into styled characters.
function parse(line) {
  let st = { bold: false, dim: false, color: null };
  const chars = [];
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
    for (const ch of part) chars.push({ ch, st });
  }
  return chars;
}

// Split into rows of at most MAXCOLS columns; continuation rows are indented under the text after the marker.
function wrap(chars) {
  const indent = chars.findIndex((c) => c.ch !== ' ');
  if (indent < 0) return [{ indent: 0, chars: [] }];
  let body = chars.slice(indent);
  const text = body.map((c) => c.ch).join('');
  const hang = indent + (/^([xi!]|fix |docs) +/.exec(text)?.[0].length ?? 0);
  const rows = [];
  let at = indent;
  while (at + body.length > MAXCOLS) {
    const room = MAXCOLS - at;
    let cut = body.slice(0, room + 1).map((c) => c.ch).join('').lastIndexOf(' ');
    if (cut <= 0) cut = room;
    rows.push({ indent: at, chars: body.slice(0, cut) });
    body = body.slice(cut);
    while (body.length && body[0].ch === ' ') body = body.slice(1);
    at = hang;
  }
  rows.push({ indent: at, chars: body });
  return rows;
}

function row({ indent, chars }, y) {
  const runs = [];
  chars.forEach((c, i) => {
    const last = runs[runs.length - 1];
    if (last && last.st === c.st) last.text += c.ch; else runs.push({ st: c.st, text: c.ch, col: indent + i });
  });
  return runs.map(({ st, text, col }) => {
    const lead = text.length - text.trimStart().length;
    const t = text.trim();
    if (!t) return '';
    const a = [`x="${(PAD + (col + lead) * CW).toFixed(1)}"`, `y="${y}"`, `textLength="${(t.length * CW).toFixed(1)}"`, 'lengthAdjust="spacingAndGlyphs"'];
    if (st.color) a.push(`fill="${st.color}"`); else if (st.dim) a.push(`fill="${DIM}"`);
    if (st.bold) a.push('font-weight="bold"');
    return `<text ${a.join(' ')}>${esc(t)}</text>`;
  }).join('');
}

const rows = src.flatMap((l) => wrap(parse(l)));
const cols = Math.max(...rows.map((r) => r.indent + r.chars.length));
const W = Math.ceil((cols + 2) * CW + 2 * PAD), H = BAR + PAD + rows.length * LH + PAD - 4;
const body = rows.map((r, i) => (r.chars.length ? row(r, BAR + PAD + (i + 1) * LH - 5) : '')).filter(Boolean).join('\n');
const title = values.title ? `\n<text x="${W / 2}" y="22" text-anchor="middle" fill="#9a9a9a" font-size="13">${esc(values.title)}</text>` : '';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="mcp-review-check text report: an error and a warning with how to fix them, a fix snippet, a score and a verdict per directory">
<title>mcp-review-check report for a small demo server</title>
<g font-family="${MONO}" xml:space="preserve" style="white-space:pre">
<rect width="${W}" height="${H}" rx="10" fill="${BG}"/>
<rect width="${W}" height="${BAR}" rx="10" fill="#2d2d2d"/><rect y="${BAR - 10}" width="${W}" height="10" fill="#2d2d2d"/>
<circle cx="20" cy="17" r="6" fill="#ff5f56"/><circle cx="40" cy="17" r="6" fill="#ffbd2e"/><circle cx="60" cy="17" r="6" fill="#27c93f"/>${title}
<g font-size="${FONT}" fill="${FG}">
${body}
</g>
</g>
</svg>
`;
writeFileSync(outFile, svg);
console.log(`${outFile}: ${src.length} lines -> ${rows.length} rows, ${cols} columns, ${W}x${H}, ${Buffer.byteLength(svg)} bytes`);
