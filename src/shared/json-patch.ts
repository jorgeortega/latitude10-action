// RFC 6902 JSON Patch between two JSON documents, and applying one. Pure: no
// imports, so it copies as is. MIT, copied into jorgeortega/latitude10-action,
// which applies the registry's fixes to the customer's file.
// Spec: docs/superpowers/specs/2026-10-19-api-platform-registry.md (decision 10)

export type PatchOp = { op: 'add' | 'remove' | 'replace'; path: string; value?: unknown };

type Container = Record<string, unknown> | unknown[];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const esc = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');
const unesc = (s: string) => s.replace(/~1/g, '/').replace(/~0/g, '~');

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (isObj(a) && isObj(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => k in b && equal(a[k], b[k]));
  }
  return false;
}

function walk(before: unknown, after: unknown, path: string, out: PatchOp[]) {
  if (isObj(before) && isObj(after)) {
    for (const key of Object.keys(before)) if (!(key in after)) out.push({ op: 'remove', path: `${path}/${esc(key)}` });
    for (const key of Object.keys(after)) {
      if (!(key in before)) out.push({ op: 'add', path: `${path}/${esc(key)}`, value: after[key] });
      else walk(before[key], after[key], `${path}/${esc(key)}`, out);
    }
  } else if (Array.isArray(before) && Array.isArray(after)) {
    if (after.length > before.length && before.every((v, i) => equal(v, after[i]))) {
      for (let i = before.length; i < after.length; i++) out.push({ op: 'add', path: `${path}/${i}`, value: after[i] });
    } else if (after.length === before.length) {
      before.forEach((v, i) => walk(v, after[i], `${path}/${i}`, out));
    } else out.push({ op: 'replace', path, value: after });
  } else if (!equal(before, after)) out.push({ op: 'replace', path, value: after });
}

export function jsonPatch(before: unknown, after: unknown): PatchOp[] {
  const out: PatchOp[] = [];
  walk(before, after, '', out);
  return out;
}

export function applyPatch<T>(doc: T, ops: PatchOp[]): T {
  let root: unknown = structuredClone(doc);
  for (const { op, path, value } of ops) {
    if (path === '') {
      root = op === 'remove' ? undefined : structuredClone(value);
      continue;
    }
    const parts = path.slice(1).split('/').map(unesc);
    const last = parts.pop()!;
    const parent = parts.reduce<unknown>((at, part) => (at as Record<string, unknown>)?.[part], root) as Container | undefined;
    if (!parent || typeof parent !== 'object') throw new Error(`JSON Patch path not found: ${path}`);
    if (Array.isArray(parent)) {
      const index = last === '-' ? parent.length : Number(last);
      if (op === 'add') parent.splice(index, 0, structuredClone(value));
      else if (op === 'replace') parent[index] = structuredClone(value);
      else parent.splice(index, 1);
    } else if (op === 'remove') delete parent[last];
    else parent[last] = structuredClone(value);
  }
  return root as T;
}
