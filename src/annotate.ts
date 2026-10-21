import { LineCounter, isMap, isSeq, parseDocument } from 'yaml';
import type { Core } from './io.ts';
import type { Finding } from './score.ts';

const MAX_ANNOTATIONS = 50;

// The line of a finding's "where" ("GET /pets", "GET /pets query:limit",
// "spec") in the spec file; JSON parses as YAML, so one path covers both.
export function findingLine(source: string, where: string): number {
  const lineCounter = new LineCounter();
  const doc = parseDocument(source, { lineCounter });
  const match = /^([A-Z]+) (\S+)(?: (\w+):(.+))?$/.exec(where);
  if (!match) return 1;
  const [, method, path, location, name] = match;
  const op = doc.getIn(['paths', path, method!.toLowerCase()], true);
  if (!isMap(op)) return 1;
  let node: { range?: [number, number, number] | null } = op;
  if (location && name) {
    const params = op.get('parameters', true);
    if (isSeq(params)) {
      const param = params.items.find((item) => isMap(item) && item.get('in') === location && item.get('name') === name);
      if (param) node = param as typeof node;
    }
  }
  // A map's range starts at its first key; the key that opens it is the line before for YAML blocks.
  const pair = doc.getIn(['paths', path], true);
  if (node === op && isMap(pair)) {
    const key = pair.items.find((item) => (item.key as { value?: unknown })?.value === method!.toLowerCase())?.key as { range?: [number, number, number] } | undefined;
    if (key?.range) return lineCounter.linePos(key.range[0]).line;
  }
  return node.range ? lineCounter.linePos(node.range[0]).line : 1;
}

export function annotate(file: string, source: string, findings: Finding[], core: Core): number {
  for (const finding of findings.slice(0, MAX_ANNOTATIONS)) {
    core.warning(`${finding.where}: ${finding.message}`, { title: finding.rule, file, startLine: findingLine(source, finding.where) });
  }
  return Math.max(0, findings.length - MAX_ANNOTATIONS);
}
