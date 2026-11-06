// Image headers for the package icons and screenshots (MAN-019, MAN-024): PNG, JPEG, WebP and SVG sizes read from
// the first bytes of a file, without a dependency and without decoding pixels. Bounded: at most IMAGE_HEADER_BYTES
// of a file are read and a file over IMAGE_FILE_CAP is not opened. Never follows a link or leaves the package root.
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import type { ImageFormat, ListingImage } from './types.js';

/** Bytes read from the start of an image (a JPEG with a large EXIF block can put its frame header late). */
export const IMAGE_HEADER_BYTES = 256 * 1024;
/** A file over this is reported by its size and not opened (the vendor limit for an icon is 5 MiB). */
export const IMAGE_FILE_CAP = 64 * 1024 * 1024;
/** Images examined per package. */
export const IMAGE_COUNT_CAP = 32;

export interface Dimensions { width: number; height: number }

/** The format by signature (not by file name), or undefined. */
export function sniffFormat(b: Buffer): ImageFormat | undefined {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  // SVG is text: the root element is <svg, after an optional BOM, XML declaration, processing instructions, comments
  // and doctype (a licence header may be long, so the whole header read is searched).
  if (svgRootAt(b.toString('utf8')) !== undefined) return 'svg';
  // An <svg tag that is not the root element (inside a comment, or in a text file) is not an SVG image (A06-06).
  return undefined;
}

/** The offset of the root `<svg` element after the prologue (BOM, whitespace, `<?...?>`, `<!--...-->`, `<!DOCTYPE ...>`
 *  with its internal subset), or undefined when the first element is not svg. */
export function svgRootAt(text: string): number | undefined {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text.startsWith('<?', i)) { const e = text.indexOf('?>', i + 2); if (e < 0) return undefined; i = e + 2; continue; }
    if (text.startsWith('<!--', i)) { const e = text.indexOf('-->', i + 4); if (e < 0) return undefined; i = e + 3; continue; }
    if (text.slice(i, i + 9).toUpperCase() === '<!DOCTYPE') {
      // Up to the closing '>' outside quotes and outside the [internal subset] (which may hold '>' in its declarations).
      let j = i + 9;
      let quote = '';
      let depth = 0;
      for (; j < text.length; j++) {
        const c = text[j];
        if (quote) { if (c === quote) quote = ''; continue; }
        if (text.startsWith('<!--', j)) { const e = text.indexOf('-->', j + 4); if (e < 0) return undefined; j = e + 2; continue; }
        if (c === '"' || c === "'") quote = c;
        else if (c === '[') depth++;
        else if (c === ']') depth = Math.max(0, depth - 1);
        else if (c === '>' && depth === 0) break;
      }
      if (j >= text.length) return undefined;
      i = j + 1;
      continue;
    }
    return /^<svg[\s>/]/i.test(text.slice(i, i + 5)) ? i : undefined;
  }
}

function pngSize(b: Buffer): Dimensions | undefined {
  // The IHDR chunk comes first: length(4) "IHDR"(4) width(4) height(4).
  if (b.length < 24 || b.toString('latin1', 12, 16) !== 'IHDR') return undefined;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function jpegSize(b: Buffer): Dimensions | undefined {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; } // fill byte
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; } // markers without a length
    if (m === 0xd9 || m === 0xda) return undefined; // end of image / start of scan before a frame header
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return undefined;
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (i + 9 > b.length) return undefined;
      return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return undefined;
}

function webpSize(b: Buffer): Dimensions | undefined {
  if (b.length < 30) return undefined;
  const kind = b.toString('latin1', 12, 16);
  if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  if (kind === 'VP8L') {
    if (b[20] !== 0x2f) return undefined;
    const bits = b.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  if (kind === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return undefined;
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  return undefined;
}

/** A pixel length: a number or a number with "px"; any other unit (%, em, pt, ...) is not a pixel size. */
function px(v: string | undefined): number | undefined {
  const m = v === undefined ? null : /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(v);
  return m ? Number(m[1]) : undefined;
}

/** The attribute text of the root <svg start tag (after "<svg", before its '>'), read up to the first '>' outside a
 *  quoted value, which XML allows inside one (1.3.0, A06-04). An <svg tag in a comment or the doctype is never the
 *  root; only text without a root svg element falls back to the first tag. Undefined when there is no tag or it is not
 *  closed in the text read. */
export function svgStartTag(text: string): string | undefined {
  let at = svgRootAt(text);
  if (at === undefined) at = /<svg(?=[\s>/])/i.exec(text)?.index;
  if (at === undefined) return undefined;
  let quote = '';
  for (let j = at + 4; j < text.length; j++) {
    const c = text[j];
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '>') return text.slice(at + 4, j);
  }
  return undefined;
}

/** Why an SVG has no size: its start tag was not read (`no-start-tag`: none, or not closed within the bytes read), or
 *  width and height carry a non-pixel unit (`units`: 2em, 1in) and there is no viewBox. Neither means the file breaks
 *  the documented rule; an SVG with neither reason has no numeric width/height or viewBox at all. */
export type SvgUnmeasured = 'no-start-tag' | 'units';

const LENGTH_UNIT = /^\s*(?:\d+(?:\.\d+)?|\.\d+)\s*(em|ex|ch|rem|pt|pc|cm|mm|in|q|vw|vh|vmin|vmax)\s*$/i;

/** The size of an SVG (width and height of the root <svg>, else the viewBox size) or why it has none. */
export function svgMeasure(text: string): { size?: Dimensions; why?: SvgUnmeasured } {
  const tag = svgStartTag(text);
  if (tag === undefined) return { why: 'no-start-tag' };
  const attr = (name: string) => new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag)?.slice(1).find((x) => x !== undefined);
  const w = px(attr('width'));
  const h = px(attr('height'));
  if (w !== undefined && h !== undefined) return { size: { width: w, height: h } };
  const vb = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) return { size: { width: vb[2], height: vb[3] } };
  const unit = (v: string | undefined) => v !== undefined && (px(v) !== undefined || LENGTH_UNIT.test(v));
  return unit(attr('width')) && unit(attr('height')) ? { why: 'units' } : {};
}

/** width and height of the root <svg>, else the viewBox size; undefined when neither gives numbers. */
export function svgSize(text: string): Dimensions | undefined {
  return svgMeasure(text).size;
}

/** Format and size from the first bytes of a file. */
export function imageInfo(b: Buffer): { format?: ImageFormat; size?: Dimensions; svgWhy?: SvgUnmeasured } {
  const format = sniffFormat(b);
  if (!format) return {};
  const svg = format === 'svg' ? svgMeasure(b.toString('utf8').replace(/^﻿/, '')) : undefined;
  const size = format === 'png' ? pngSize(b) : format === 'jpeg' ? jpegSize(b) : format === 'webp' ? webpSize(b) : svg!.size;
  if (size && size.width > 0 && size.height > 0) return { format, size };
  return { format, ...(svg?.why ? { svgWhy: svg.why } : {}) };
}

const codeOf = (err: unknown) => String((err as NodeJS.ErrnoException)?.code ?? (err as Error)?.name ?? 'error');

/** Examine the image a manifest names. `ref` is the manifest value; only `./`-relative paths without ".." inside the
 *  package root are read. The result never holds an absolute path or file content. */
export function examineImage(root: string, source: ListingImage['source'], key: string, ref: unknown): ListingImage {
  const base: ListingImage = { source, key, ref: typeof ref === 'string' ? ref : '' };
  if (typeof ref !== 'string' || !ref) return { ...base, problem: 'not-a-path' };
  const rel = ref.replace(/^\.\//, '');
  if (/^([a-z][a-z0-9+.-]*:|[\\/])/i.test(rel) || rel.split(/[\\/]/).includes('..')) return { ...base, problem: 'outside' };
  const abs = join(root, rel);
  let fd: number | undefined;
  try {
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) return { ...base, problem: 'link' };
    if (!st.isFile()) return { ...base, problem: 'not-file' };
    // A folder on the way may be a link: the real path must stay inside the real root.
    const real = realpathSync(abs);
    const realRoot = realpathSync(root);
    if (real !== realRoot && !real.startsWith(realRoot.endsWith(sep) ? realRoot : realRoot + sep)) return { ...base, problem: 'outside' };
    if (st.size > IMAGE_FILE_CAP) return { ...base, bytes: st.size, problem: 'too-large' };
    fd = openSync(abs, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const fst = fstatSync(fd);
    if (!fst.isFile()) return { ...base, problem: 'not-file' };
    const buf = Buffer.alloc(Math.min(fst.size, IMAGE_HEADER_BYTES));
    let off = 0;
    while (off < buf.length) {
      const n = readSync(fd, buf, off, buf.length - off, off);
      if (n === 0) break;
      off += n;
    }
    const { format, size, svgWhy } = imageInfo(buf.subarray(0, off));
    if (!format) return { ...base, bytes: fst.size, problem: 'unknown-format' };
    if (!size) return { ...base, bytes: fst.size, format, problem: 'no-dimensions', ...(svgWhy ? { detail: svgWhy } : {}) };
    return { ...base, bytes: fst.size, format, width: size.width, height: size.height };
  } catch (err) {
    const code = codeOf(err);
    return { ...base, problem: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable', detail: code };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
