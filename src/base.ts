import { parse } from 'yaml';
import type { Json } from './bundle.ts';

// The spec as it is on the base branch, or null when it isn't there.
export async function baseWithoutKey(git: (args: string[]) => Promise<string>, spec: string, baseRef: string): Promise<Json | null> {
  const path = spec.replace(/^\.\//, '');
  try {
    await git(['fetch', '--no-tags', '--depth=1', 'origin', baseRef]);
  } catch {
    // Already fetched, or no remote: try what is there.
  }
  try {
    const doc = parse(await git(['show', `origin/${baseRef}:${path}`]));
    return doc && typeof doc === 'object' ? (doc as Json) : null;
  } catch {
    return null;
  }
}
