import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { bundleSpec } from '../src/bundle.ts';
import { findingLine } from '../src/annotate.ts';
import { scoreSpec } from '../src/score.ts';

const fixtures = new URL('./fixtures/', import.meta.url).pathname;

describe('bundleSpec', () => {
  it('bundles local $refs into one document, and says it used other files', async () => {
    const bundled = await bundleSpec(`${fixtures}multi/openapi.yaml`);
    expect(JSON.stringify(bundled.doc)).not.toMatch(/"\$ref":"\.\//);
    expect(bundled.format).toBe('yaml');
    expect(bundled.multiFile).toBe(true);
    expect(bundled.text).toContain('Multi-file');
  });

  it('refuses a remote $ref with a clear message', async () => {
    await expect(bundleSpec(`${fixtures}remote.yaml`)).rejects.toThrow(/https:\/\/example\.com.*only local/);
  });

  it('keeps a single-file spec as one file', async () => {
    expect((await bundleSpec(`${fixtures}petstore.yaml`)).multiFile).toBe(false);
  });
});

describe('scoreSpec', () => {
  it('scores the pet store as the registry does', async () => {
    const { doc } = await bundleSpec(`${fixtures}petstore.yaml`);
    const expected = JSON.parse(readFileSync(`${fixtures}petstore.fixes.json`, 'utf8')).scoreBefore;
    expect(scoreSpec(doc).score).toBe(expected);
  });
});

describe('findingLine', () => {
  const yamlText = readFileSync(`${fixtures}petstore.yaml`, 'utf8');
  const lineOf = (text: string, needle: string, from = 0) => text.split('\n').findIndex((line, i) => i >= from && line.includes(needle)) + 1;

  it('lands on the operation in YAML and in JSON', async () => {
    const pets = lineOf(yamlText, '/pets:');
    expect(findingLine(yamlText, 'GET /pets')).toBe(lineOf(yamlText, 'get:', pets - 1));
    const { doc } = await bundleSpec(`${fixtures}petstore.yaml`);
    const json = JSON.stringify(doc, null, 2);
    expect(findingLine(json, 'GET /pets')).toBe(lineOf(json, '"get"', lineOf(json, '"/pets"') - 1));
  });

  it('lands on a parameter, and on line 1 for the whole spec', () => {
    expect(findingLine(yamlText, 'GET /pets query:limit')).toBe(lineOf(yamlText, '- name: limit'));
    expect(findingLine(yamlText, 'spec')).toBe(1);
    expect(findingLine(stringify({ a: 1 }), 'GET /nowhere')).toBe(1);
  });
});
