// Recursive JSON Schema walker (§1.5).
import { isObj, type Obj } from './access.js';

export interface SchemaVisit {
  /** JSON pointer from the schema root. */
  path: string;
  /** Property name normalized to lowercase snake_case ('' for non-property nodes). */
  name: string;
  rawName: string;
  node: Obj;
  /** The node is the value of a `properties/<name>` entry. */
  viaProperty: boolean;
  /** Every step from the root is a `properties/<name>` step. */
  pure: boolean;
  depth: number;
}

export function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[\s\-.]+/g, '_')
    .toLowerCase();
}

const esc = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');

/** decodeURIComponent that keeps the raw segment on malformed escapes (e.g. a stray '%'). */
function safeDecode(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

function resolvePointer(root: unknown, ref: string): unknown {
  if (!ref.startsWith('#')) return undefined;
  const parts = ref.slice(1).split('/').filter((p, i) => !(i === 0 && p === ''));
  let cur: unknown = root;
  for (const raw of parts) {
    const p = safeDecode(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(cur)) cur = cur[Number(p)];
    else if (isObj(cur)) cur = cur[p];
    else return undefined;
  }
  return cur;
}

const MAX_DEPTH = 64;
const COMBINATORS = ['anyOf', 'oneOf', 'allOf'];
const SINGLE = ['not', 'if', 'then', 'else', 'additionalProperties', 'items', 'contains', 'propertyNames', 'unevaluatedItems', 'unevaluatedProperties'];

export function walkSchema(schema: unknown, visit: (v: SchemaVisit) => void): void {
  if (!isObj(schema)) return;
  const seen = new Set<Obj>();
  const go = (node: unknown, path: string, rawName: string, viaProperty: boolean, pure: boolean, depth: number) => {
    if (!isObj(node) || depth > MAX_DEPTH || seen.has(node)) return;
    seen.add(node);
    visit({ path: path || '/', name: rawName ? snakeCase(rawName) : '', rawName, node, viaProperty, pure, depth });
    if (isObj(node.properties)) {
      for (const [k, v] of Object.entries(node.properties)) go(v, `${path}/properties/${esc(k)}`, k, true, pure, depth + 1);
    }
    if (isObj(node.patternProperties)) {
      for (const [k, v] of Object.entries(node.patternProperties)) go(v, `${path}/patternProperties/${esc(k)}`, '', false, false, depth + 1);
    }
    for (const key of SINGLE) {
      const v = node[key];
      if (isObj(v)) go(v, `${path}/${key}`, '', false, false, depth + 1);
      else if (key === 'items' && Array.isArray(v)) v.forEach((s, i) => go(s, `${path}/items/${i}`, '', false, false, depth + 1));
    }
    if (Array.isArray(node.prefixItems)) node.prefixItems.forEach((s, i) => go(s, `${path}/prefixItems/${i}`, '', false, false, depth + 1));
    for (const key of COMBINATORS) {
      const v = node[key];
      if (Array.isArray(v)) v.forEach((s, i) => go(s, `${path}/${key}/${i}`, '', false, false, depth + 1));
    }
    for (const defs of ['$defs', 'definitions']) {
      const d = node[defs];
      if (isObj(d)) for (const [k, v] of Object.entries(d)) go(v, `${path}/${defs}/${esc(k)}`, '', false, false, depth + 1);
    }
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#')) {
      go(resolvePointer(schema, node.$ref), `${path}/$ref`, rawName, viaProperty, false, depth + 1);
    }
  };
  go(schema, '', '', false, true, 0);
}

/** Resolve a local `$ref` (one level) for property inspection. */
export function deref(root: unknown, node: unknown): unknown {
  if (isObj(node) && typeof node.$ref === 'string') return resolvePointer(root, node.$ref) ?? node;
  return node;
}

/** Structural metrics without following $ref (TOOL-020). */
export function schemaMetrics(schema: unknown): { depth: number; count: number } {
  let count = 0;
  let maxDepth = 0;
  const go = (node: unknown, depth: number) => {
    if (!isObj(node) || depth > MAX_DEPTH) return;
    count++;
    maxDepth = Math.max(maxDepth, depth);
    for (const [k, v] of Object.entries(node)) {
      if (k === 'properties' || k === 'patternProperties' || k === '$defs' || k === 'definitions') {
        if (isObj(v)) for (const s of Object.values(v)) go(s, depth + 1);
      } else if (COMBINATORS.includes(k) || k === 'prefixItems' || (k === 'items' && Array.isArray(v))) {
        if (Array.isArray(v)) for (const s of v) go(s, depth + 1);
      } else if (SINGLE.includes(k)) {
        go(v, depth + 1);
      }
    }
  };
  go(schema, 0);
  return { depth: maxDepth, count };
}
