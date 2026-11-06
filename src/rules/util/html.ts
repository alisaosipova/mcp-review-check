// Regex-based origin extraction from widget HTML (no DOM dependency, §1.5).

export type OriginKind = 'resource' | 'connect' | 'frame' | 'base' | 'navigate';

export interface ExtractedOrigin {
  kind: OriginKind;
  origin: string;
  evidence: string;
  confidence: 'tag' | 'js';
}

function originOf(raw: string): string | undefined {
  let u = raw.trim().replace(/&amp;/g, '&');
  if (u.startsWith('//')) u = 'https:' + u;
  if (!/^(https?|wss?):\/\//i.test(u)) return undefined; // data:, blob:, relative
  try {
    const url = new URL(u);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return undefined;
  }
}

const ATTR = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');

function attr(tag: string, name: string): string | undefined {
  const m = ATTR(name).exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
}

const CSS_URL_STOP = /["')\s]/;

/**
 * CSS `url(...)` values, exactly the matches of /(?<![\w$.]|\bnew\s+)url\(\s*["']?([^"')\s]+)["']?\s*\)/gi as
 * [value, match]. That regex is quadratic on 'url(url(url(...' with no ')': its value class admits '(', so every start
 * scans to the end of the input. The value cannot backtrack (the class excludes what may follow it), so the match is
 * decided by the end of the run of value characters, and every start inside one run shares that end.
 */
function cssUrls(html: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const starts = /(?<![\w$.]|\bnew\s+)url\(/gi;
  let runStart = -1;
  let runEnd = -1;
  let m: RegExpExecArray | null;
  while ((m = starts.exec(html))) {
    let i = m.index + m[0].length;
    while (i < html.length && /\s/.test(html[i])) i++;
    const q = html[i] === '"' || html[i] === "'" ? i + 1 : i;
    if (!(q > runStart && q <= runEnd)) {
      runStart = q;
      runEnd = q;
      while (runEnd < html.length && !CSS_URL_STOP.test(html[runEnd])) runEnd++;
    }
    let j = runEnd;
    if (j === q) continue; // empty value: no match at this start
    if (html[j] === '"' || html[j] === "'") j++;
    while (j < html.length && /\s/.test(html[j])) j++;
    if (html[j] !== ')') continue;
    out.push([html.slice(q, runEnd), html.slice(m.index, j + 1)]);
    starts.lastIndex = j + 1;
  }
  return out;
}

// APPS-007 and APPS-013 both extract the origins of every UI resource: a small cache keeps one scan per resource HTML.
// It is bounded, so a server with many UI resources costs a rescan, never unbounded memory.
const ORIGIN_CACHE_SIZE = 16;
const originCache = new Map<string, readonly ExtractedOrigin[]>();

export function extractOrigins(html: string): ExtractedOrigin[] {
  let origins = originCache.get(html);
  if (!origins) {
    origins = Object.freeze(scanOrigins(html).map((o) => Object.freeze(o)));
    if (originCache.size >= ORIGIN_CACHE_SIZE) originCache.delete(originCache.keys().next().value as string);
    originCache.set(html, origins);
  }
  return [...origins];
}

/** Elements whose content is raw text: a `<!--` inside them opens no comment. `plaintext` runs to the end. */
const RAW_TEXT = new Set(['script', 'style', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext']);
const TAG_NAME = /[A-Za-z][^\s/>]*/y;

/**
 * The HTML with its comments replaced by a space (A05-12): a commented-out `<script src>` is never loaded. A forward,
 * linear tokenizer, so only text a browser reads as a comment is removed:
 * - a `<!--` inside a tag (`<a title="<!--">`, quote-aware), inside a bogus comment (`<!x ...>`, `<?...>`) or inside
 *   a raw-text element (script, style, title, textarea, xmp, iframe, noembed, noframes, noscript; plaintext to the end)
 *   opens no comment;
 * - a comment ends at once on `<!-->` and `<!--->`, otherwise at the nearest `-->` or `--!>`;
 * - an unclosed comment, attribute value or raw-text element keeps the rest of the text as is (nothing is hidden).
 */
export function stripHtmlComments(html: string): string {
  if (!html.includes('<!--')) return html;
  let out = '';
  let copied = 0;
  let i = 0;
  // Cached next positions of the two comment closers, re-searched only once passed (linear on many comments).
  let dash = -2;
  let bang = -2;
  const after = (cache: number, needle: string, from: number): number => (cache === -1 || cache >= from ? cache : html.indexOf(needle, from));
  scan: while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) {
      const s = lt + 4;
      let end: number;
      if (html[s] === '>') end = s + 1;
      else if (html.startsWith('->', s)) end = s + 2;
      else {
        dash = after(dash, '-->', s);
        bang = after(bang, '--!>', s);
        const d = dash < 0 ? -1 : dash + 3;
        const b = bang < 0 ? -1 : bang + 4;
        end = d < 0 ? b : b < 0 ? d : Math.min(d, b);
      }
      if (end < 0) break; // unclosed: kept
      out += html.slice(copied, lt) + ' ';
      copied = i = end;
      continue;
    }
    const c = html[lt + 1] ?? '';
    const closing = c === '/';
    TAG_NAME.lastIndex = closing ? lt + 2 : lt + 1;
    const name = TAG_NAME.exec(html);
    if (!name) {
      if (c === '!' || c === '?' || closing) { // bogus comment: up to the next '>'
        const gt = html.indexOf('>', lt + 2);
        if (gt < 0) break;
        i = gt + 1;
      } else i = lt + 1;
      continue;
    }
    // Inside a tag: a quoted attribute value may hold '<!--' and '>'.
    let j = TAG_NAME.lastIndex;
    for (;;) {
      if (j >= html.length) break scan; // unterminated tag: kept
      const ch = html[j];
      if (ch === '>') break;
      if (ch === '=') {
        let k = j + 1;
        while (k < html.length && /\s/.test(html[k])) k++;
        const q = html[k];
        if (q === '"' || q === "'") {
          const close = html.indexOf(q, k + 1);
          if (close < 0) break scan;
          j = close + 1;
          continue;
        }
        j = k;
        continue;
      }
      j++;
    }
    i = j + 1;
    const tag = name[0].toLowerCase();
    if (closing || !RAW_TEXT.has(tag)) continue;
    if (tag === 'plaintext') break;
    const end = new RegExp(`</${tag}(?![^\\s/>])`, 'gi');
    end.lastIndex = i;
    const e = end.exec(html);
    if (!e) break; // unclosed raw text: kept
    i = e.index;
  }
  return out + html.slice(copied);
}

function scanOrigins(html: string): ExtractedOrigin[] {
  const out: ExtractedOrigin[] = [];
  const seen = new Set<string>();
  const add = (kind: OriginKind, raw: string | undefined, evidence: string, confidence: 'tag' | 'js') => {
    if (!raw) return;
    const origin = originOf(raw);
    if (!origin) return;
    const key = `${kind}|${origin}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, origin, evidence: evidence.slice(0, 160), confidence });
  };

  // [^<>] keeps the scan linear on unterminated tags ("<img<img<img..."); HTML allows '<' in attribute values, rarely used.
  const tagRe = /<(script|link|img|source|video|audio|iframe|base|embed|object)\b[^<>]*>/gi;
  // Markup inside an HTML comment is never loaded (A05-12); the JS patterns below still read the raw text.
  const markup = stripHtmlComments(html);
  for (const m of markup.matchAll(tagRe)) {
    const tag = m[0];
    const name = m[1].toLowerCase();
    if (name === 'script') add('resource', attr(tag, 'src'), tag, 'tag');
    else if (name === 'link') {
      const rel = (attr(tag, 'rel') ?? '').toLowerCase();
      if (/\b(stylesheet|preload|icon|modulepreload)\b/.test(rel)) add('resource', attr(tag, 'href'), tag, 'tag');
    } else if (name === 'iframe') add('frame', attr(tag, 'src'), tag, 'tag');
    else if (name === 'base') add('base', attr(tag, 'href'), tag, 'tag');
    else if (name === 'object') add('resource', attr(tag, 'data'), tag, 'tag'); // <embed src> takes the branch below
    else {
      if (name === 'video') add('resource', attr(tag, 'poster'), tag, 'tag');
      add('resource', attr(tag, 'src'), tag, 'tag');
      const srcset = attr(tag, 'srcset');
      if (srcset) for (const part of srcset.split(',')) add('resource', part.trim().split(/\s+/)[0], tag, 'tag');
    }
  }
  for (const m of markup.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) add('resource', m[1], m[0], 'tag');
  // CSS url() is case-insensitive, so the JS URL constructor (`new URL("https://...")`, `URL(...)`, `x.URL(...)`) must
  // not be read as one: it builds a value and loads nothing, and a fetch of it is a connect origin, not a resource.
  for (const [value, evidence] of cssUrls(markup)) add('resource', value, evidence, 'tag');

  const lit = `["'\`]((?:https?|wss?):\\/\\/[^"'\`\\s]+)["'\`]`;
  const jsPatterns: Array<[OriginKind, RegExp]> = [
    ['connect', new RegExp(`\\bfetch\\(\\s*${lit}`, 'g')],
    ['connect', new RegExp(`new\\s+WebSocket\\(\\s*${lit}`, 'g')],
    ['connect', new RegExp(`new\\s+EventSource\\(\\s*${lit}`, 'g')],
    // XMLHttpRequest.open with any method token (GET, POST, PROPFIND, ...): telemetry posts are the usual way a widget sends data out.
    ['connect', new RegExp(`\\.open\\(\\s*["'][A-Za-z][A-Za-z0-9_-]*["']\\s*,\\s*${lit}`, 'gi')],
    ['connect', new RegExp(`\\bnavigator\\.sendBeacon\\(\\s*${lit}`, 'g')],
    // A worker script is fetched like a script (worker-src falls back to script-src): a resource origin.
    ['resource', new RegExp(`\\bnew\\s+(?:Shared)?Worker\\(\\s*${lit}`, 'g')],
    ['connect', new RegExp(`\\baxios(?:\\.\\w+)?\\(\\s*${lit}`, 'g')],
    ['connect', new RegExp(`\\bky(?:\\.\\w+)?\\(\\s*${lit}`, 'g')],
    ['navigate', new RegExp(`\\bopenExternal\\(\\s*(?:\\{\\s*url\\s*:\\s*)?${lit}`, 'g')],
    ['navigate', new RegExp(`ui\\/open-link[\\s\\S]{0,200}?${lit}`, 'g')],
    // ES modules: `import x from "https://..."`, `import "https://..."`, `export * from "https://..."`, `import("https://...")`.
    ['resource', new RegExp(`\\b(?:import|export)\\b\\s*(?:[^;'"\`()]{0,200}?\\bfrom\\s*)?${lit}`, 'g')],
    ['resource', new RegExp(`\\bimport\\(\\s*${lit}`, 'g')],
  ];
  for (const [kind, re] of jsPatterns) for (const m of html.matchAll(re)) add(kind, m[1], m[0], 'js');
  for (const [specifier, url] of importMapUrls(html)) add('resource', url, `importmap "${specifier}": "${url}"`, 'js');
  return out;
}

/**
 * Targets of `<script type="importmap">` (imports and scopes). A mapped module is loaded only when imported, so the
 * caller treats these as js confidence. Unparseable maps are skipped: the browser rejects them too.
 * Linear (A09-01): an opener inside an earlier map body is script text, as in a browser, and is skipped; a map with no
 * `</script` runs to the end of the HTML, so it is parsed once and the scan stops.
 */
function importMapUrls(html: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let next = 0;
  // Every opener is matched first and tested for the type after: one regex with both [^<>]* runs and the type word
  // between them backtracks quadratically on a long opener without '>' (review of A09-01).
  for (const m of html.matchAll(/<script\b[^<>]*>/gi)) {
    if ((m.index ?? 0) < next || !/\btype\s*=\s*["']?importmap\b/i.test(m[0])) continue;
    const start = (m.index ?? 0) + m[0].length;
    const end = html.indexOf('</script', start);
    next = end < 0 ? html.length : end;
    let map: unknown;
    try { map = JSON.parse(html.slice(start, next)); } catch { if (end < 0) break; continue; }
    if (typeof map !== 'object' || map === null) continue;
    const { imports, scopes } = map as { imports?: unknown; scopes?: unknown };
    const take = (o: unknown) => {
      if (typeof o !== 'object' || o === null) return;
      for (const [k, v] of Object.entries(o)) if (typeof v === 'string') out.push([k, v]);
    };
    take(imports);
    if (typeof scopes === 'object' && scopes !== null) for (const s of Object.values(scopes)) take(s);
  }
  return out;
}

/**
 * Exact scheme/host/port match, plus `https://*.example.com` wildcard subdomains. A bare host (`api.example.com`,
 * `*.example.com`) is a CSP host-source: in the https widget sandbox it admits the host over https and wss.
 */
export function originMatches(origin: string, entry: string): boolean {
  let e = entry.trim().toLowerCase();
  const o = origin.toLowerCase();
  if (!e.includes('://') && /^(\*\.)?[a-z0-9.-]+(:\d+)?$/.test(e)) {
    const scheme = /^(https|wss):\/\//.exec(o);
    if (!scheme) return false;
    e = `${scheme[1]}://${e}`;
  }
  const wild = /^([a-z][a-z0-9+.-]*):\/\/\*\.(.+)$/.exec(e);
  try {
    const ou = new URL(o);
    if (wild) {
      const [, scheme, rest] = wild;
      const eu = new URL(`${scheme}://${rest}`);
      return ou.protocol === eu.protocol && ou.port === eu.port && ou.hostname.endsWith('.' + eu.hostname);
    }
    const eu = new URL(e);
    return ou.protocol === eu.protocol && ou.host === eu.host;
  } catch {
    return false;
  }
}

/** A URL built at runtime from a template: `${v}`, `{{v}}`, `<%= v %>` or a `$1` regex back-reference. */
export function isTemplated(url: string): boolean {
  return /\$\{|\{\{|<%|\$\d/.test(url);
}

/**
 * Literal href targets of `<a>` and `<area>` links in the HTML (POL-004). `<link>` and `<base>` hrefs load resources
 * or set the base URL, not links the user follows; templated URLs are not real links and are skipped.
 */
export function extractLinks(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<(?:a|area)\b[^<>]*>/gi)) {
    const href = attr(m[0], 'href');
    if (href && !isTemplated(href)) out.push(href);
  }
  return out;
}

/**
 * HTML and JS comments removed (block comments with indexOf, so unterminated openers stay linear). A `//` counts as
 * a line comment only at a line start or after whitespace or ;{}(),>, so URLs such as https://x keep their path.
 */
export function stripComments(text: string): string {
  let out = '';
  let i = 0;
  // Cached next positions of each opener (re-searched only once passed), so many comments stay linear.
  let block = text.indexOf('/*');
  let html = text.indexOf('<!--');
  while (i < text.length) {
    if (block >= 0 && block < i) block = text.indexOf('/*', i);
    if (html >= 0 && html < i) html = text.indexOf('<!--', i);
    const next = block < 0 ? html : html < 0 ? block : Math.min(block, html);
    if (next < 0) { out += text.slice(i); break; }
    out += text.slice(i, next);
    const close = next === block ? '*/' : '-->';
    const end = text.indexOf(close, next + 2);
    if (end < 0) { out += text.slice(next); break; }
    out += ' ';
    i = end + close.length;
  }
  return out.replace(/(^|[\s;{}(),>])\/\/[^\n]*/g, '$1');
}
