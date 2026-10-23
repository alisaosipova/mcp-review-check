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

export function extractOrigins(html: string): ExtractedOrigin[] {
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
  const tagRe = /<(script|link|img|source|video|audio|iframe|base)\b[^<>]*>/gi;
  for (const m of html.matchAll(tagRe)) {
    const tag = m[0];
    const name = m[1].toLowerCase();
    if (name === 'script') add('resource', attr(tag, 'src'), tag, 'tag');
    else if (name === 'link') {
      const rel = (attr(tag, 'rel') ?? '').toLowerCase();
      if (/\b(stylesheet|preload|icon|modulepreload)\b/.test(rel)) add('resource', attr(tag, 'href'), tag, 'tag');
    } else if (name === 'iframe') add('frame', attr(tag, 'src'), tag, 'tag');
    else if (name === 'base') add('base', attr(tag, 'href'), tag, 'tag');
    else {
      add('resource', attr(tag, 'src'), tag, 'tag');
      const srcset = attr(tag, 'srcset');
      if (srcset) for (const part of srcset.split(',')) add('resource', part.trim().split(/\s+/)[0], tag, 'tag');
    }
  }
  for (const m of html.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi)) add('resource', m[1], m[0], 'tag');
  for (const m of html.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)) add('resource', m[1], m[0], 'tag');

  const lit = `["'\`]((?:https?|wss?):\\/\\/[^"'\`\\s]+)["'\`]`;
  const jsPatterns: Array<[OriginKind, RegExp]> = [
    ['connect', new RegExp(`\\bfetch\\(\\s*${lit}`, 'g')],
    ['connect', new RegExp(`new\\s+WebSocket\\(\\s*${lit}`, 'g')],
    ['connect', new RegExp(`new\\s+EventSource\\(\\s*${lit}`, 'g')],
    ['connect', new RegExp(`\\.open\\(\\s*["']GET["']\\s*,\\s*${lit}`, 'gi')],
    ['connect', new RegExp(`\\baxios(?:\\.\\w+)?\\(\\s*${lit}`, 'g')],
    ['connect', new RegExp(`\\bky(?:\\.\\w+)?\\(\\s*${lit}`, 'g')],
    ['navigate', new RegExp(`\\bopenExternal\\(\\s*(?:\\{\\s*url\\s*:\\s*)?${lit}`, 'g')],
    ['navigate', new RegExp(`ui\\/open-link[\\s\\S]{0,200}?${lit}`, 'g')],
  ];
  for (const [kind, re] of jsPatterns) for (const m of html.matchAll(re)) add(kind, m[1], m[0], 'js');
  return out;
}

/** Exact scheme/host/port match, plus `https://*.example.com` wildcard subdomains. */
export function originMatches(origin: string, entry: string): boolean {
  const e = entry.trim().toLowerCase();
  const o = origin.toLowerCase();
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

/** All href targets in the HTML (POL-004). */
export function extractLinks(html: string): string[] {
  return [...html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
}
