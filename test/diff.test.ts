import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { DIFF_KINDS, diff } from '../src/shared/diff.ts';

// The site's loop (tests/registry-diff.test.ts), over the same copied pairs.
const DIR = join(import.meta.dirname, 'fixtures/diff');
const EDGE_CASES = ['identical', 'reordered-keys', 'path-param-renamed', 'recursive-schema', 'security-alternative-added'];
const cases = readdirSync(DIR).sort();
const load = (name: string, file: string) => readFileSync(join(DIR, name, file), 'utf8');

describe('diff fixtures', () => {
  it.each(cases)('%s', (name) => {
    expect(diff(parse(load(name, 'before.yaml')), parse(load(name, 'after.yaml')))).toEqual(JSON.parse(load(name, 'expected.json')));
  });

  it('has a fixture folder for every rule and a rule for every folder', () => {
    expect([...DIFF_KINDS].sort()).toEqual(cases.filter((name) => !EDGE_CASES.includes(name)));
  });
});
