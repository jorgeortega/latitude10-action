import { describe, expect, it } from 'vitest';
import { openFixesPullRequest } from '../src/pull-request.ts';
import type { Octokit } from '../src/io.ts';

function fakeOctokit() {
  const refs = new Map<string, string>([['heads/main', 'base-sha']]);
  const pulls: Array<{ number: number; head: string; base: string; title: string; body: string; html_url: string }> = [];
  const log: string[] = [];
  const octokit: Octokit = {
    rest: {
      git: {
        getRef: async ({ ref }) => {
          const sha = refs.get(ref);
          if (!sha) throw Object.assign(new Error('Not Found'), { status: 404 });
          return { data: { object: { sha } } };
        },
        createRef: async ({ ref, sha }) => void (log.push(`createRef ${ref}`), refs.set(ref.replace(/^refs\//, ''), sha)),
        updateRef: async ({ ref, sha, force }) => void (log.push(`updateRef ${ref} force=${force}`), refs.set(ref, sha)),
      },
      repos: {
        getContent: async () => ({ data: { sha: 'file-sha', type: 'file' } }),
        createOrUpdateFileContents: async ({ branch, sha }) => void log.push(`commit ${branch} ${sha}`),
      },
      pulls: {
        list: async ({ head }) => ({ data: pulls.filter((p) => `acme:${p.head}` === head).map((p) => ({ number: p.number, html_url: p.html_url })) }),
        create: async ({ head, base, title, body }) => {
          const pr = { number: pulls.length + 1, head, base, title, body, html_url: `https://github.com/acme/api/pull/${pulls.length + 1}` };
          pulls.push(pr);
          log.push('create');
          return { data: { html_url: pr.html_url } };
        },
        update: async ({ pull_number, body }) => void (log.push(`update ${pull_number}`), (pulls[pull_number - 1]!.body = body)),
      },
    },
  };
  return { octokit, pulls, log };
}

describe('openFixesPullRequest', () => {
  it('creates the branch and the pull request once, then updates them', async () => {
    const { octokit, pulls, log } = fakeOctokit();
    const args = { octokit, owner: 'acme', repo: 'api', base: 'main', path: 'openapi.yaml', content: 'openapi: 3.0.3\n', summary: 'Score 49 → 84' };
    expect(await openFixesPullRequest(args)).toEqual({ url: 'https://github.com/acme/api/pull/1', updated: false });
    expect(await openFixesPullRequest({ ...args, summary: 'Score 50 → 84' })).toEqual({ url: 'https://github.com/acme/api/pull/1', updated: true });
    expect(pulls).toHaveLength(1);
    expect(pulls[0]).toMatchObject({ head: 'latitude10/readiness-fixes', base: 'main', title: 'Readiness fixes for openapi.yaml' });
    expect(pulls[0]!.body).toContain('Score 50 → 84');
    expect(log).toEqual([
      'createRef refs/heads/latitude10/readiness-fixes',
      'commit latitude10/readiness-fixes file-sha',
      'create',
      'updateRef heads/latitude10/readiness-fixes force=true',
      'commit latitude10/readiness-fixes file-sha',
      'update 1',
    ]);
  });
});
