import { type Node, isSeq, parseDocument } from 'yaml';
import { type PatchOp, applyPatch } from './shared/json-patch.ts';

const unescape = (segment: string) => segment.replace(/~1/g, '/').replace(/~0/g, '~');

// The registry's JSON Patch applied to the customer's own file. YAML goes
// through the yaml package's document, so comments, key order and quoting
// survive; JSON keeps its indentation and trailing newline.
export function applyToSource(source: string, format: 'yaml' | 'json', ops: PatchOp[]): string {
  if (format === 'json') {
    const indent = /\n([ \t]+)"/.exec(source)?.[1] ?? '  ';
    const out = JSON.stringify(applyPatch(JSON.parse(source), ops), null, indent);
    return source.endsWith('\n') ? `${out}\n` : out;
  }
  const doc = parseDocument(source);
  for (const op of ops) {
    const segments = op.path.split('/').slice(1).map(unescape);
    const parentPath: Array<string | number> = [];
    for (const segment of segments.slice(0, -1)) {
      const parent = parentPath.length ? doc.getIn(parentPath, true) : doc.contents;
      parentPath.push(isSeq(parent) && /^\d+$/.test(segment) ? Number(segment) : segment);
    }
    const last = segments[segments.length - 1]!;
    const parent = parentPath.length ? doc.getIn(parentPath, true) : doc.contents;
    if (op.op === 'remove') {
      doc.deleteIn([...parentPath, isSeq(parent) ? Number(last) : last]);
      continue;
    }
    const node = doc.createNode(op.value) as Node;
    if (isSeq(parent)) {
      const index = last === '-' ? parent.items.length : Number(last);
      if (op.op === 'add') parent.items.splice(index, 0, node);
      else parent.items[index] = node;
    } else {
      doc.setIn([...parentPath, last], node);
    }
  }
  return doc.toString();
}
