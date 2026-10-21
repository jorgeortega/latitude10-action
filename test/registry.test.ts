import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RegistryError, registryClient } from '../src/registry.ts';
import { VERSION } from '../src/version.ts';
import { run } from '../src/main.ts';
import { fakeIo } from './helpers.ts';

const spec = new URL('./fixtures/petstore.yaml', import.meta.url).pathname;
const text = readFileSync(spec, 'utf8');
const KEY = 'l10p_testkey';
const API = 'https://latitude10.tech';

type Call = { method: string; url: string; headers: Headers; body: string | null };

function stubFetch(routes: Record<string, (call: Call) => Response>) {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { method: init?.method ?? 'GET', url: String(input), headers: new Headers(init?.headers), body: (init?.body as string) ?? null };
    calls.push(call);
    const route = Object.entries(routes).find(([key]) => `${call.method} ${call.url.split('?')[0]}` === key);
    return route ? route[1](call) : Response.json({ error: 'not found' }, { status: 404 });
  }) as typeof fetch;
  return { fetcher, calls };
}

const version = (seq: number) => ({ seq, score: 49, breaking: 0, warnings: 0, url: `${API}/workspace/acme/pets/versions/${seq}` });

describe('registryClient', () => {
  it('sends the key and user agent to api-url only', async () => {
    const { fetcher, calls } = stubFetch({ [`GET ${API}/api/registry/v1/versions/latest`]: () => Response.json(version(3)) });
    expect(await registryClient(API, KEY, fetcher).latest()).toMatchObject({ seq: 3 });
    expect(calls[0]!.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(calls[0]!.headers.get('user-agent')).toBe(`latitude10-action/${VERSION}`);
    expect(calls.every((c) => c.url.startsWith(`${API}/api/registry/v1/`))).toBe(true);
  });

  it('answers null when the project has no versions, and a clear error for a refused key', async () => {
    const { fetcher } = stubFetch({ [`GET ${API}/api/registry/v1/versions/latest`]: () => Response.json({ error: 'none' }, { status: 404 }) });
    expect(await registryClient(API, KEY, fetcher).latest()).toBeNull();
    const refused = stubFetch({ [`GET ${API}/api/registry/v1/versions/latest`]: () => Response.json({ error: 'bad' }, { status: 401 }) });
    await expect(registryClient(API, KEY, refused.fetcher).latest()).rejects.toThrow(/LATITUDE10_KEY was refused/);
  });

  it('pushes with the git sha, ref and label', async () => {
    const { fetcher, calls } = stubFetch({ [`POST ${API}/api/registry/v1/versions`]: () => Response.json(version(4), { status: 201 }) });
    const pushed = await registryClient(API, KEY, fetcher).push(text, { label: '1.4.0', gitSha: 'abc123', gitRef: 'refs/heads/main', format: 'yaml' });
    expect(pushed).toMatchObject({ status: 201, seq: 4 });
    const url = new URL(calls[0]!.url);
    expect(Object.fromEntries(url.searchParams)).toEqual({ label: '1.4.0', git_sha: 'abc123', git_ref: 'refs/heads/main' });
    expect(calls[0]!.body).toBe(text);
  });

  it('turns a quota into a RegistryError with when it resets', async () => {
    const { fetcher } = stubFetch({ [`POST ${API}/api/registry/v1/versions`]: () => Response.json({ error: 'Quota reached', resetsAt: '2026-10-22T00:00:00.000Z' }, { status: 429 }) });
    const error = await registryClient(API, KEY, fetcher).push(text, { label: '', gitSha: '', gitRef: '', format: 'yaml' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RegistryError);
    expect((error as RegistryError).status).toBe(429);
    expect((error as RegistryError).message).toContain('2026-10-22T00:00:00.000Z');
  });
});

describe('main, with a key', () => {
  const env = { LATITUDE10_KEY: KEY, GITHUB_SHA: 'abc123', GITHUB_REF: 'refs/heads/main' };

  it('diffs against the registry and pushes after the gate passes', async () => {
    const before = text.replace('  /pets:\n', '  /legacy:\n    get:\n      operationId: legacy\n      responses:\n        "200":\n          description: OK\n  /pets:\n');
    const { fetcher, calls: requests } = stubFetch({
      [`GET ${API}/api/registry/v1/versions/latest`]: () => Response.json(version(3)),
      [`GET ${API}/api/registry/v1/versions/3/source`]: () => new Response(before),
      [`POST ${API}/api/registry/v1/versions`]: () => Response.json(version(4), { status: 201 }),
    });
    const { io, calls } = fakeIo({ spec, 'max-tools': '40', push: 'true' }, env, { fetch: fetcher });
    await run(io);
    expect(calls.failed).toEqual([]);
    expect(calls.outputs.breaking).toBe(1);
    expect(calls.outputs['version-url']).toBe(`${API}/workspace/acme/pets/versions/4`);
    const push = requests.find((r) => r.method === 'POST')!;
    expect(new URL(push.url).searchParams.get('label')).toBe('1.4.0');
    expect(push.body).toBe(text);
    expect(calls.summary).toContain('versions/4');
  });

  it('falls back to the base branch when the registry has no version', async () => {
    let shown = false;
    const { fetcher } = stubFetch({ [`GET ${API}/api/registry/v1/versions/latest`]: () => Response.json({ error: 'none' }, { status: 404 }) });
    const { io, calls } = fakeIo({ spec, 'max-tools': '40' }, { ...env, GITHUB_BASE_REF: 'main' }, {
      fetch: fetcher,
      git: async (args) => {
        if (args[0] === 'show') shown = true;
        return args[0] === 'show' ? text : '';
      },
    });
    await run(io);
    expect(shown).toBe(true);
    expect(calls.failed).toEqual([]);
  });

  it("doesn't push when the gate fails", async () => {
    const { fetcher, calls: requests } = stubFetch({ [`GET ${API}/api/registry/v1/versions/latest`]: () => Response.json({ error: 'none' }, { status: 404 }) });
    const { io, calls } = fakeIo({ spec, 'min-score': '90', 'max-tools': '40', push: 'true' }, env, { fetch: fetcher });
    await run(io);
    expect(calls.failed[0]).toMatch(/below min-score 90/);
    expect(requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('fails clearly when the key is refused, and only notes a quota', async () => {
    const refused = stubFetch({ [`GET ${API}/api/registry/v1/versions/latest`]: () => Response.json({ error: 'no' }, { status: 401 }) });
    const a = fakeIo({ spec, 'max-tools': '40' }, env, { fetch: refused.fetcher });
    await run(a.io);
    expect(a.calls.failed[0]).toMatch(/LATITUDE10_KEY was refused/);

    const quota = stubFetch({
      [`GET ${API}/api/registry/v1/versions/latest`]: () => Response.json({ error: 'none' }, { status: 404 }),
      [`POST ${API}/api/registry/v1/versions`]: () => Response.json({ error: 'Quota reached', resetsAt: '2026-10-22T00:00:00.000Z' }, { status: 429 }),
    });
    const b = fakeIo({ spec, 'max-tools': '40', push: 'true' }, env, { fetch: quota.fetcher });
    await run(b.io);
    expect(b.calls.failed).toEqual([]);
    expect(b.calls.notices.join(' ')).toMatch(/2026-10-22/);
  });

  it('skips push on a pull request from a fork, with one notice', async () => {
    const { fetcher, calls: requests } = stubFetch({});
    const { io, calls } = fakeIo({ spec, 'max-tools': '40', push: 'true', 'suggest-fixes': 'true' }, { ...env, GITHUB_EVENT_NAME: 'pull_request' }, {
      fetch: fetcher,
      event: { pull_request: { head: { repo: { full_name: 'someone/api' } } } },
    });
    await run(io);
    expect(requests).toEqual([]);
    expect(calls.failed).toEqual([]);
    expect(calls.notices).toHaveLength(1);
  });
});
