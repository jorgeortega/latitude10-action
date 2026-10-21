import { readFile } from 'node:fs/promises';
import { bundle } from '@apidevtools/json-schema-ref-parser';
import { parse, stringify } from 'yaml';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

function refs(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) refs(item, out);
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === '$ref' && typeof item === 'string') out.push(item);
      else refs(item, out);
    }
  }
  return out;
}

// Local $refs bundled into one document; remote ones are never fetched.
// multiFile: the document came from more than one file.
export async function bundleSpec(path: string): Promise<{ doc: Json; text: string; format: 'yaml' | 'json'; source: string; multiFile: boolean }> {
  const source = await readFile(path, 'utf8');
  const format = /^\s*[{[]/.test(source) ? 'json' : 'yaml';
  const remote = refs(parse(source)).find((ref) => /^[a-z][a-z0-9+.-]*:/i.test(ref));
  if (remote) throw new Error(`${path} has a $ref to ${remote}: only local files are bundled. Download it into the repository and point the $ref at the file.`);
  let doc: Json;
  try {
    doc = (await bundle(path, { resolve: { http: false } })) as Json;
  } catch (error) {
    throw new Error(`Could not bundle ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const multiFile = refs(parse(source)).some((ref) => !ref.startsWith('#'));
  const text = format === 'json' ? `${JSON.stringify(doc, null, 2)}\n` : stringify(doc);
  return { doc, text, format, source, multiFile };
}
