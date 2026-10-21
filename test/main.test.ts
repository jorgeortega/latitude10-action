import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { run } from '../src/main.ts';
import { fakeIo } from './helpers.ts';

const spec = new URL('./fixtures/petstore.yaml', import.meta.url).pathname;
const text = readFileSync(spec, 'utf8');

describe('main, with no key', () => {
  it('fails below min-score and never calls the network', async () => {
    let fetched = false;
    const { io, calls } = fakeIo({ spec, 'min-score': '90', 'max-tools': '40' }, {}, {
      fetch: (async () => {
        fetched = true;
        throw new Error('no');
      }) as typeof fetch,
    });
    await run(io);
    expect(calls.failed).toEqual(['Readiness gate failed: score 49 is below min-score 90']);
    expect(fetched).toBe(false);
    expect(calls.outputs.score).toBe(49);
    expect(calls.warnings.length).toBeGreaterThan(0);
    expect(calls.summary).toContain('| Score | 49 |');
    expect(calls.summary).toMatch(/operations have a suggested fix/);
  });

  it('reports only when no threshold is set', async () => {
    const { io, calls } = fakeIo({ spec, 'max-tools': '40' });
    await run(io);
    expect(calls.failed).toEqual([]);
  });

  it('fails on a breaking change against the base branch', async () => {
    const before = parse(text);
    before.paths['/legacy'] = { get: { operationId: 'legacy', responses: { '200': { description: 'OK' } } } };
    const { io, calls } = fakeIo({ spec, 'max-tools': '40', 'fail-on-breaking': 'true' }, { GITHUB_EVENT_NAME: 'pull_request', GITHUB_BASE_REF: 'main' }, {
      git: async (args) => (args[0] === 'show' ? JSON.stringify(before) : ''),
    });
    await run(io);
    expect(calls.failed[0]).toMatch(/1 breaking change/);
    expect(calls.outputs.breaking).toBe(1);
  });
});
