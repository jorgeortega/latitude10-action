import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import * as core from '@actions/core';

// Everything the action touches outside its own code, so tests can fake it.

export type Core = {
  getInput(name: string): string;
  setFailed(message: string | Error): void;
  warning(message: string | Error, properties?: { title?: string; file?: string; startLine?: number }): void;
  notice(message: string | Error): void;
  info(message: string): void;
  setOutput(name: string, value: unknown): void;
  summary: { addRaw(text: string, addEol?: boolean): unknown; write(): Promise<unknown> };
};

export type Io = {
  core: Core;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  git: (args: string[]) => Promise<string>;
  // The workflow's event payload (GITHUB_EVENT_PATH), for fork detection.
  event: { pull_request?: { head?: { repo?: { full_name?: string } } } };
  // Only for suggest-fixes; made from GITHUB_TOKEN.
  octokit?: (token: string) => Octokit;
};

// The few GitHub REST calls the fixes pull request needs.
export type Octokit = {
  rest: {
    git: {
      getRef(p: { owner: string; repo: string; ref: string }): Promise<{ data: { object: { sha: string } } }>;
      createRef(p: { owner: string; repo: string; ref: string; sha: string }): Promise<unknown>;
      updateRef(p: { owner: string; repo: string; ref: string; sha: string; force: boolean }): Promise<unknown>;
    };
    repos: {
      getContent(p: { owner: string; repo: string; path: string; ref: string }): Promise<{ data: unknown }>;
      createOrUpdateFileContents(p: { owner: string; repo: string; path: string; message: string; content: string; branch: string; sha?: string }): Promise<unknown>;
    };
    pulls: {
      list(p: { owner: string; repo: string; head: string; state: 'open' }): Promise<{ data: Array<{ number: number; html_url: string }> }>;
      create(p: { owner: string; repo: string; head: string; base: string; title: string; body: string }): Promise<{ data: { html_url: string } }>;
      update(p: { owner: string; repo: string; pull_number: number; body: string }): Promise<unknown>;
    };
  };
};

const run = promisify(execFile);

export async function defaultIo(): Promise<Io> {
  const { getOctokit } = await import('@actions/github');
  let event = {};
  try {
    if (process.env.GITHUB_EVENT_PATH) event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  } catch {
    // No event file outside Actions.
  }
  return {
    core,
    env: process.env,
    fetch: globalThis.fetch,
    git: async (args) => (await run('git', args, { maxBuffer: 10 * 1024 * 1024 })).stdout,
    event,
    octokit: (token) => getOctokit(token) as unknown as Octokit,
  };
}
