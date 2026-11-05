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
    // A lookahead, not /([A-Z]+)([A-Z][a-z])/: that form backtracks over a long uppercase run at every start (quadratic
    // on a 1 MB name of 'A's); this one gives the same output in linear time.
    .replace(/([A-Z])(?=[A-Z][a-z])/g, '$1_')
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

/** The node a local `#/...` JSON pointer names in `root`, or undefined. `#` is the root. */
export function resolvePointer(root: unknown, ref: string): unknown {
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
const SINGLE = ['not', 'if', 'then', 'else', 'additionalProperties', 'additionalItems', 'items', 'contains', 'propertyNames', 'unevaluatedItems', 'unevaluatedProperties'];
// name → subschema maps that are not properties. `dependencies` (draft-07) mixes subschemas with string arrays
// (the dependentRequired form); only the object values are schemas.
const SCHEMA_MAPS = ['$defs', 'definitions', 'dependentSchemas', 'dependencies'];

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
    for (const defs of SCHEMA_MAPS) {
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

/**
 * A property node seen through its local `$ref`: the target's keywords, overridden by the node's own (draft 2019-09+
 * lets siblings of `$ref` apply). The walker visits `{ $ref }` before its target, so rules that read a property's type,
 * enum or format must use this, or a pydantic/zod `$defs` enum reads as a free-form string. `unresolved` is set for a
 * `$ref` that does not resolve locally: its shape is unknown.
 */
export function resolvedNode(root: unknown, node: Obj): { node: Obj; unresolved: boolean } {
  let cur: Obj = node;
  const seen = new Set<Obj>([node]);
  const layers: Obj[] = [node];
  // Follow a short chain of local refs ($defs/A -> $defs/B), guarding against cycles.
  for (let i = 0; i < 8 && typeof cur.$ref === 'string'; i++) {
    const next = cur.$ref.startsWith('#') ? resolvePointer(root, cur.$ref) : undefined;
    if (!isObj(next)) return { node: Object.assign({}, ...layers.slice().reverse()), unresolved: true };
    if (seen.has(next)) break;
    seen.add(next);
    layers.push(next);
    cur = next;
  }
  return { node: Object.assign({}, ...layers.slice().reverse()), unresolved: false };
}

/**
 * The closed value list of a node: `enum`, `const`, or an anyOf/oneOf whose every branch is a `const`/`enum` branch (a
 * `{type: 'null'}` branch, as in an optional enum, adds no free value). One free branch such as `{type: 'string'}`
 * opens the list, so the node has no closed value list.
 *
 * `open: true` returns the listed values even when a free branch sits beside them: the values a mode or method switch
 * names ("GET" and "POST" next to `{type: 'string'}` still mix safe and unsafe methods, TOOL-023/024).
 */
export function enumValues(node: Obj, opts: { open?: boolean } = {}): unknown[] | undefined {
  if (Array.isArray(node.enum)) return node.enum;
  for (const k of ['oneOf', 'anyOf']) {
    const list = node[k];
    if (Array.isArray(list) && list.length) {
      const consts: unknown[] = [];
      let closed = true;
      for (const s of list) {
        if (isObj(s) && s.const !== undefined) consts.push(s.const);
        else if (isObj(s) && Array.isArray(s.enum)) consts.push(...s.enum);
        else if (isObj(s) && s.type === 'null' && Object.keys(s).every((x) => x === 'type' || x === 'title' || x === 'description')) continue;
        else closed = false;
      }
      if ((closed || opts.open) && consts.length) return consts;
    }
  }
  if (node.const !== undefined) return [node.const];
  return undefined;
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
      if (k === 'properties' || k === 'patternProperties' || SCHEMA_MAPS.includes(k)) {
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
