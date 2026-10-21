// What changed between two versions of one OpenAPI document, for people and
// for the CI gate. Pure: no I/O and no imports, so it copies as is.
// MIT, copied into jorgeortega/latitude10-action with its fixtures.
// Spec: docs/superpowers/specs/2026-10-19-api-platform-registry.md (decision 7)

export type Level = 'breaking' | 'warning' | 'info';
export type Change = { kind: string; level: Level; pointer: string; message: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
type Found = { pointer: string; message: string };
type Op = { key: string; label: string; path: string; pointer: string; op: Json; item: Json };
type Param = { key: string; label: string; pointer: string; p: Json };
type Ctx = {
  before: Json;
  after: Json;
  removed: Op[];
  added: Op[];
  moved: Array<[Op, Op]>;
  matched: Array<[Op, Op]>;
  walked: Array<Found & { kind: string }>;
  seen: Set<string>;
  budget: { left: number };
  params: (doc: Json, op: Op) => Map<string, Param>;
};

const METHODS = ['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace'];
const MAX_DEPTH = 8;
// Schema comparisons per diff: far above any real API, far below the Worker's CPU limit.
const MAX_WALKS = 20_000;
const RANK: Record<Level, number> = { breaking: 0, warning: 1, info: 2 };

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const esc = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1');
const unesc = (s: string) => s.replace(/~1/g, '/').replace(/~0/g, '~');
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

// Follows local $refs only ("#/…"); anything else stays as it is.
function resolve(doc: Json, node: unknown): { node: unknown; ref?: string } {
  let ref: string | undefined;
  for (let hops = 0; isObj(node) && typeof node.$ref === 'string' && hops < 20; hops++) {
    if (!node.$ref.startsWith('#/')) return { node, ref };
    ref = node.$ref;
    node = node.$ref
      .slice(2)
      .split('/')
      .map(unesc)
      .reduce<unknown>((at, part) => (isObj(at) || Array.isArray(at) ? (at as Json)[part] : undefined), doc);
  }
  return { node, ref };
}

// Operations by method and path, with path template names blanked so a
// renamed path parameter is still the same operation.
function operations(doc: Json): Map<string, Op> {
  const ops = new Map<string, Op>();
  for (const [path, raw] of Object.entries(isObj(doc.paths) ? doc.paths : {})) {
    const item = resolve(doc, raw).node;
    if (!isObj(item)) continue;
    for (const method of METHODS) {
      if (!isObj(item[method])) continue;
      const key = `${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, '{}')}`;
      if (!ops.has(key)) ops.set(key, { key, label: `${method.toUpperCase()} ${path}`, path, pointer: `/paths/${esc(path)}/${method}`, op: item[method], item });
    }
  }
  return ops;
}

// Path-level and operation-level parameters (the operation's win), keyed by
// location and name; path parameters by their place in the template.
function parameters(doc: Json, op: Op): Map<string, Param> {
  const template = [...op.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  const found = new Map<string, Param>();
  const take = (list: unknown, pointer: string) => {
    if (!Array.isArray(list)) return;
    list.forEach((raw, i) => {
      const p = resolve(doc, raw).node;
      if (!isObj(p) || typeof p.name !== 'string' || typeof p.in !== 'string') return;
      const name = p.in === 'header' ? p.name.toLowerCase() : p.name;
      const key = p.in === 'path' ? `path#${template.indexOf(p.name)}` : `${p.in}:${name}`;
      found.set(key, { key, label: `${p.in}:${name}`, pointer: `${pointer}/${i}`, p });
    });
  };
  take(op.item.parameters, `/paths/${esc(op.path)}/parameters`);
  take(op.op.parameters, `${op.pointer}/parameters`);
  return found;
}

function jsonMedia(doc: Json, holder: unknown): [string, unknown] | null {
  const content = isObj(holder) ? resolve(doc, holder).node : null;
  const media = isObj(content) && isObj(content.content) ? content.content : null;
  if (!media) return null;
  const type = 'application/json' in media ? 'application/json' : Object.keys(media).find((k) => k.includes('json'));
  return type && isObj(media[type]) ? [type, media[type].schema] : null;
}

const successCodes = (responses: unknown) => (isObj(responses) ? Object.keys(responses).filter((code) => /^2(\d\d|XX)$/i.test(code)) : []);
const typeName = (t: unknown) => (Array.isArray(t) ? [...t].sort().join('|') : typeof t === 'string' ? t : undefined);

// One level of allOf folded into the schema, which is how most specs compose
// objects. Each property keeps the pointer of the place that defines it.
type Prop = { node: unknown; pointer: string };
function merged(doc: Json, schema: Json, pointer: string): { schema: Json; props: Map<string, Prop>; itemsPointer: string } {
  const props = new Map<string, Prop>();
  const take = (holder: Json, at: string) => {
    if (isObj(holder.properties)) for (const [name, node] of Object.entries(holder.properties)) props.set(name, { node, pointer: `${at}/properties/${esc(name)}` });
  };
  if (!Array.isArray(schema.allOf)) {
    take(schema, pointer);
    return { schema, props, itemsPointer: `${pointer}/items` };
  }
  const out: Json = { ...schema };
  let itemsPointer = `${pointer}/items`;
  schema.allOf.forEach((member: unknown, i: number) => {
    const r = resolve(doc, member);
    if (!isObj(r.node)) return;
    const at = r.ref ? r.ref.slice(1) : `${pointer}/allOf/${i}`;
    take(r.node, at);
    out.type ??= r.node.type;
    out.enum ??= r.node.enum;
    if (out.items === undefined && r.node.items !== undefined) {
      out.items = r.node.items;
      itemsPointer = `${at}/items`;
    }
  });
  take(schema, pointer);
  return { schema: out, props, itemsPointer };
}

type Walk = { ctx: Pick<Ctx, 'before' | 'after' | 'walked' | 'seen' | 'budget'>; mode: 'response' | 'request'; where: (prop: string) => string };

// Compares two schemas along the same path. A schema reached through a $ref
// is reported where it's defined (its components pointer), and each pair of
// places is compared once per diff, so shared schemas cost one walk however
// many operations use them. A budget stops pathological documents.
function walk(w: Walk, b: unknown, a: unknown, prop: string, ptrB: string, ptrA: string, depth: number) {
  const rb = resolve(w.ctx.before, b);
  const ra = resolve(w.ctx.after, a);
  if (depth > MAX_DEPTH || !isObj(rb.node) || !isObj(ra.node) || w.ctx.budget.left <= 0) return;
  if (rb.ref) ptrB = rb.ref.slice(1);
  if (ra.ref) ptrA = ra.ref.slice(1);
  const pair = `${w.mode}|${ptrB}|${ptrA}`;
  if (w.ctx.seen.has(pair)) return;
  w.ctx.seen.add(pair);
  w.ctx.budget.left--;
  const mb = merged(w.ctx.before, rb.node, ptrB);
  const ma = merged(w.ctx.after, ra.node, ptrA);
  const sb = mb.schema;
  const sa = ma.schema;
  const push = (kind: string, pointer: string, message: string) => w.ctx.walked.push({ kind, pointer, message });
  const join = (name: string) => (prop ? `${prop}.${name}` : name);

  const tb = typeName(sb.type);
  const ta = typeName(sa.type);
  if (tb && ta && tb !== ta) {
    if (w.mode === 'response') push('response-property-type-changed', ptrA, `The type of ${w.where(prop)} changed from ${tb} to ${ta}`);
    return;
  }
  if (Array.isArray(sb.enum) && Array.isArray(sa.enum)) {
    const [from, to] = w.mode === 'response' ? [sb.enum, sa.enum] : [sa.enum, sb.enum];
    const known = new Set(from.map(stable));
    for (const value of to.filter((v: unknown) => !known.has(stable(v)))) {
      if (w.mode === 'response') push('response-enum-value-added', ptrA, `Enum value ${JSON.stringify(value)} was added to ${w.where(prop)}`);
      else push('request-enum-value-removed', ptrA, `Enum value ${JSON.stringify(value)} was removed from ${w.where(prop)}`);
    }
  }
  for (const [name, pb] of mb.props) {
    const pa = ma.props.get(name);
    if (!pa) {
      if (w.mode === 'response') push('response-property-removed', pb.pointer, `Property ${join(name)} was removed from ${w.where('')}`);
    } else walk(w, pb.node, pa.node, join(name), pb.pointer, pa.pointer, depth + 1);
  }
  if (w.mode === 'response') {
    for (const [name, pa] of ma.props) if (!mb.props.has(name)) push('response-property-added', pa.pointer, `Property ${join(name)} was added to ${w.where('')}`);
  }
  if (sb.items !== undefined && sa.items !== undefined) walk(w, sb.items, sa.items, prop ? `${prop}[]` : '[]', mb.itemsPointer, ma.itemsPointer, depth + 1);
}

function walkOperation(ctx: Ctx, b: Op, a: Op) {
  const label = a.label;
  for (const [key, pa] of ctx.params(ctx.after, a)) {
    const pb = ctx.params(ctx.before, b).get(key);
    if (!pb) continue;
    const where = (prop: string) => (prop ? `${prop} in parameter ${pa.label} of ${label}` : `parameter ${pa.label} of ${label}`);
    walk({ ctx, mode: 'request', where }, pb.p.schema, pa.p.schema, '', `${pb.pointer}/schema`, `${pa.pointer}/schema`, 0);
  }
  const bodyB = jsonMedia(ctx.before, b.op.requestBody);
  const bodyA = jsonMedia(ctx.after, a.op.requestBody);
  if (bodyB && bodyA) {
    const where = (prop: string) => (prop ? `${prop} in the request body of ${label}` : `the request body of ${label}`);
    walk({ ctx, mode: 'request', where }, bodyB[1], bodyA[1], '', `${b.pointer}/requestBody/content/${esc(bodyB[0])}/schema`, `${a.pointer}/requestBody/content/${esc(bodyA[0])}/schema`, 0);
  }
  const responsesA = isObj(a.op.responses) ? a.op.responses : {};
  for (const code of successCodes(b.op.responses).filter((c) => c in responsesA)) {
    const mb = jsonMedia(ctx.before, b.op.responses[code]);
    const ma = jsonMedia(ctx.after, responsesA[code]);
    if (!mb || !ma) continue;
    const where = (prop: string) => (prop ? `${prop} in the ${code} response of ${label}` : `the ${code} response of ${label}`);
    walk({ ctx, mode: 'response', where }, mb[1], ma[1], '', `${b.pointer}/responses/${code}/content/${esc(mb[0])}/schema`, `${a.pointer}/responses/${code}/content/${esc(ma[0])}/schema`, 0);
  }
}

// The effective requirement as alternatives (OR) of scheme sets (AND); none is one empty set.
const requirementSets = (doc: Json, op: Op): Array<Set<string>> => {
  const requirements = Array.isArray(op.op.security) ? op.op.security : Array.isArray(doc.security) ? doc.security : [];
  return requirements.length ? requirements.map((r: unknown) => new Set(isObj(r) ? Object.keys(r) : [])) : [new Set()];
};
const schemeNames = (doc: Json, op: Op) => {
  const requirements = Array.isArray(op.op.security) ? op.op.security : Array.isArray(doc.security) ? doc.security : [];
  return new Set<string>(requirements.flatMap((r: unknown) => (isObj(r) ? Object.keys(r) : [])));
};
const schemeFacts = (doc: Json, name: string) => {
  const s = resolve(doc, doc.components?.securitySchemes?.[name]).node;
  return isObj(s) ? stable({ type: s.type, in: s.in, name: s.name, scheme: s.scheme, bearerFormat: s.bearerFormat, flows: s.flows }) : null;
};

const onMatched = (ctx: Ctx, each: (b: Op, a: Op) => Found[]) => ctx.matched.flatMap(([b, a]) => each(b, a));
const onParams = (ctx: Ctx, each: (pb: Param | undefined, pa: Param | undefined, a: Op) => Found[]) =>
  onMatched(ctx, (b, a) => {
    const before = ctx.params(ctx.before, b);
    const after = ctx.params(ctx.after, a);
    return [...new Set([...before.keys(), ...after.keys()])].flatMap((key) => each(before.get(key), after.get(key), a));
  });
const walked = (kind: string) => (ctx: Ctx) => ctx.walked.filter((w) => w.kind === kind).map(({ pointer, message }) => ({ pointer, message }));

const RULES: Array<{ kind: string; level: Level; check: (ctx: Ctx) => Found[] }> = [
  { kind: 'operation-removed', level: 'breaking', check: (ctx) => ctx.removed.map((b) => ({ pointer: b.pointer, message: `${b.label} was removed` })) },
  {
    kind: 'operation-moved',
    level: 'breaking',
    check: (ctx) => ctx.moved.map(([b, a]) => ({ pointer: a.pointer, message: `${b.label} moved to ${a.label} (operationId ${a.op.operationId})` })),
  },
  {
    kind: 'parameter-removed',
    level: 'breaking',
    check: (ctx) => onParams(ctx, (pb, pa, a) => (pb && !pa ? [{ pointer: pb.pointer, message: `Parameter ${pb.label} of ${a.label} was removed` }] : [])),
  },
  {
    kind: 'parameter-became-required',
    level: 'breaking',
    check: (ctx) =>
      onParams(ctx, (pb, pa, a) => (pb && pa && pb.p.required !== true && pa.p.required === true ? [{ pointer: pa.pointer, message: `Parameter ${pa.label} of ${a.label} is now required` }] : [])),
  },
  {
    kind: 'required-parameter-added',
    level: 'breaking',
    check: (ctx) => onParams(ctx, (pb, pa, a) => (!pb && pa && pa.p.required === true ? [{ pointer: pa.pointer, message: `${a.label} has a new required parameter ${pa.label}` }] : [])),
  },
  {
    kind: 'request-body-became-required',
    level: 'breaking',
    check: (ctx) =>
      onMatched(ctx, (b, a) => {
        const was = resolve(ctx.before, b.op.requestBody).node;
        const now = resolve(ctx.after, a.op.requestBody).node;
        return isObj(now) && now.required === true && !(isObj(was) && was.required === true)
          ? [{ pointer: `${a.pointer}/requestBody`, message: `The request body of ${a.label} is now required` }]
          : [];
      }),
  },
  { kind: 'response-property-removed', level: 'breaking', check: walked('response-property-removed') },
  { kind: 'response-property-type-changed', level: 'breaking', check: walked('response-property-type-changed') },
  { kind: 'response-enum-value-added', level: 'breaking', check: walked('response-enum-value-added') },
  { kind: 'request-enum-value-removed', level: 'breaking', check: walked('request-enum-value-removed') },
  {
    kind: 'success-response-removed',
    level: 'breaking',
    check: (ctx) =>
      onMatched(ctx, (b, a) =>
        successCodes(b.op.responses)
          .filter((code) => !isObj(a.op.responses) || !(code in a.op.responses))
          .map((code) => ({ pointer: `${b.pointer}/responses/${code}`, message: `The ${code} response of ${a.label} was removed` })),
      ),
  },
  {
    // Breaking when a client that met an old requirement meets none of the
    // new ones; a new alternative (OR) breaks nobody.
    kind: 'security-requirement-added',
    level: 'breaking',
    check: (ctx) =>
      onMatched(ctx, (b, a) => {
        const was = requirementSets(ctx.before, b);
        const now = requirementSets(ctx.after, a);
        const stillWorks = (old: Set<string>) => now.some((set) => [...set].every((name) => old.has(name)));
        if (was.every(stillWorks)) return [];
        const pointer = Array.isArray(a.op.security) ? `${a.pointer}/security` : '/security';
        const before = new Set(was.flatMap((set) => [...set]));
        const added = [...new Set(now.flatMap((set) => [...set]))].filter((name) => !before.has(name));
        return added.length
          ? added.map((name) => ({ pointer, message: `${a.label} now requires security scheme ${name}` }))
          : [{ pointer, message: `${a.label} no longer accepts the security it did` }];
      }),
  },
  {
    kind: 'security-scheme-changed',
    level: 'breaking',
    check: (ctx) => {
      const used = new Set([...ctx.matched.map(([, a]) => a), ...ctx.added].flatMap((a) => [...schemeNames(ctx.after, a)]));
      return [...used]
        .sort()
        .filter((name) => {
          const was = schemeFacts(ctx.before, name);
          const now = schemeFacts(ctx.after, name);
          return was !== null && now !== null && was !== now;
        })
        .map((name) => ({ pointer: `/components/securitySchemes/${esc(name)}`, message: `Security scheme ${name} changed` }));
    },
  },
  {
    kind: 'server-url-removed',
    level: 'breaking',
    check: (ctx) => {
      const now = new Set((Array.isArray(ctx.after.servers) ? ctx.after.servers : []).map((s: Json) => s?.url));
      return (Array.isArray(ctx.before.servers) ? ctx.before.servers : []).flatMap((s: Json, i: number) =>
        typeof s?.url === 'string' && !now.has(s.url) ? [{ pointer: `/servers/${i}`, message: `Server ${s.url} was removed` }] : [],
      );
    },
  },
  {
    kind: 'operation-id-changed',
    level: 'warning',
    check: (ctx) =>
      onMatched(ctx, (b, a) =>
        typeof b.op.operationId === 'string' && typeof a.op.operationId === 'string' && b.op.operationId !== a.op.operationId
          ? [{ pointer: `${a.pointer}/operationId`, message: `The operationId of ${a.label} changed from ${b.op.operationId} to ${a.op.operationId}, so agents see a new tool name` }]
          : [],
      ),
  },
  {
    kind: 'description-removed',
    level: 'warning',
    check: (ctx) => [
      ...onMatched(ctx, (b, a) => (text(b.op.description) && !text(a.op.description) ? [{ pointer: `${b.pointer}/description`, message: `The description of ${a.label} was removed` }] : [])),
      ...onParams(ctx, (pb, pa, a) =>
        pb && pa && text(pb.p.description) && !text(pa.p.description) ? [{ pointer: `${pb.pointer}/description`, message: `The description of parameter ${pa.label} of ${a.label} was removed` }] : [],
      ),
    ],
  },
  {
    kind: 'operation-deprecated',
    level: 'warning',
    check: (ctx) => onMatched(ctx, (b, a) => (b.op.deprecated !== true && a.op.deprecated === true ? [{ pointer: `${a.pointer}/deprecated`, message: `${a.label} is now deprecated` }] : [])),
  },
  { kind: 'operation-added', level: 'info', check: (ctx) => ctx.added.map((a) => ({ pointer: a.pointer, message: `${a.label} was added` })) },
  {
    kind: 'optional-parameter-added',
    level: 'info',
    check: (ctx) => onParams(ctx, (pb, pa, a) => (!pb && pa && pa.p.required !== true ? [{ pointer: pa.pointer, message: `${a.label} has a new optional parameter ${pa.label}` }] : [])),
  },
  { kind: 'response-property-added', level: 'info', check: walked('response-property-added') },
];

export const DIFF_KINDS = RULES.map((rule) => rule.kind);

export function diff(before: Json, after: Json): Change[] {
  const opsB = operations(before);
  const opsA = operations(after);
  let removed = [...opsB.values()].filter((op) => !opsA.has(op.key));
  let added = [...opsA.values()].filter((op) => !opsB.has(op.key));
  const moved: Array<[Op, Op]> = [];
  for (const b of removed) {
    const a = typeof b.op.operationId === 'string' ? added.find((op) => op.op.operationId === b.op.operationId) : undefined;
    if (a) {
      moved.push([b, a]);
      added = added.filter((op) => op !== a);
    }
  }
  removed = removed.filter((b) => !moved.some(([m]) => m === b));
  const cache = new Map<Op, Map<string, Param>>();
  const ctx: Ctx = {
    before,
    after,
    removed,
    added,
    moved,
    matched: [...opsB.values()].filter((op) => opsA.has(op.key)).map((b) => [b, opsA.get(b.key)!]),
    walked: [],
    seen: new Set(),
    budget: { left: MAX_WALKS },
    params: (doc, op) => cache.get(op) ?? cache.set(op, parameters(doc, op)).get(op)!,
  };
  for (const [b, a] of ctx.matched) walkOperation(ctx, b, a);
  return RULES.flatMap((rule) => rule.check(ctx).map((found) => ({ kind: rule.kind, level: rule.level, ...found }))).sort(
    (x, y) => RANK[x.level] - RANK[y.level] || (x.pointer < y.pointer ? -1 : x.pointer > y.pointer ? 1 : 0) || (x.message < y.message ? -1 : x.message > y.message ? 1 : 0),
  );
}

export function summarize(changes: Change[]): { breaking: number; warnings: number } {
  return { breaking: changes.filter((c) => c.level === 'breaking').length, warnings: changes.filter((c) => c.level === 'warning').length };
}
