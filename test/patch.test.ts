import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { applyToSource } from '../src/patch.ts';
import { scoreSpec } from '../src/score.ts';

const fixtures = new URL('./fixtures/', import.meta.url).pathname;
const yamlText = readFileSync(`${fixtures}petstore.yaml`, 'utf8');
const fixes = JSON.parse(readFileSync(`${fixtures}petstore.fixes.json`, 'utf8'));

describe('applyToSource', () => {
  it('keeps every comment and the key order in YAML, and reaches scoreAfter', () => {
    const out = applyToSource(yamlText, 'yaml', fixes.patch);
    for (const comment of yamlText.split('\n').filter((line) => line.trim().startsWith('#'))) expect(out).toContain(comment.trim());
    const keys = (text: string) => Object.keys(parse(text).paths['/pets'].get);
    expect(keys(out).slice(0, keys(yamlText).length)).toEqual(keys(yamlText));
    expect(scoreSpec(parse(out)).score).toBe(fixes.scoreAfter);
  });

  it('keeps a JSON file’s 4-space indentation and trailing newline', () => {
    const json = `${JSON.stringify(parse(yamlText), null, 4)}\n`;
    const out = applyToSource(json, 'json', fixes.patch);
    expect(out.split('\n')[1]).toMatch(/^ {4}"/);
    expect(out.endsWith('}\n')).toBe(true);
    expect(scoreSpec(JSON.parse(out)).score).toBe(fixes.scoreAfter);
  });

  it('adds to the end of a list, inserts, replaces and removes', () => {
    const out = applyToSource('a:\n  - 1\n  - 3\nb: x # keep\nc: 1\n', 'yaml', [
      { op: 'add', path: '/a/-', value: 4 },
      { op: 'add', path: '/a/1', value: 2 },
      { op: 'replace', path: '/b', value: 'y' },
      { op: 'remove', path: '/c' },
    ]);
    expect(parse(out)).toEqual({ a: [1, 2, 3, 4], b: 'y' });
  });
});
