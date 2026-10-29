import type { PatchOp } from './shared/json-patch.ts';
import { VERSION } from './version.ts';

// The Latitude 10 registry's API for CI (project keys). Only called with
// LATITUDE10_KEY, and only on api-url.

export class RegistryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type PushedVersion = { status: 200 | 201; seq: number; score: number; breaking: number; url: string };
export type Fixes = { status: 200; patch: PatchOp[]; scoreBefore: number; scoreAfter: number; operations: number } | { status: 403 | 429; error: string };

export function registryClient(apiUrl: string, key: string, fetcher: typeof fetch = fetch) {
  const base = `${apiUrl.replace(/\/+$/, '')}/api/registry/v1`;

  async function call(method: 'GET' | 'POST', path: string, body?: { text: string; type: string }): Promise<Response> {
    const response = await fetcher(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, 'user-agent': `latitude10-action/${VERSION}`, ...(body ? { 'content-type': body.type } : {}) },
      body: body?.text,
    });
    if (response.status === 401) throw new RegistryError('LATITUDE10_KEY was refused. Create a project key on the project page and save it as the repository secret LATITUDE10_KEY.', 401);
    return response;
  }

  async function fail(response: Response): Promise<never> {
    const data = (await response.json().catch(() => ({}))) as { error?: string; resetsAt?: string };
    const message = response.status === 429 ? `Latitude 10 quota reached; it resets at ${data.resetsAt ?? 'the start of the next period'}.` : (data.error ?? `Latitude 10 answered ${response.status}.`);
    throw new RegistryError(message, response.status);
  }

  return {
    async latest(): Promise<{ seq: number } | null> {
      const response = await call('GET', '/versions/latest');
      if (response.status === 404) return null;
      if (!response.ok) return fail(response);
      return (await response.json()) as { seq: number };
    },
    async source(seq: number): Promise<string> {
      const response = await call('GET', `/versions/${seq}/source`);
      if (!response.ok) return fail(response);
      return response.text();
    },
    async push(text: string, meta: { label: string; gitSha: string; gitRef: string; format: 'yaml' | 'json' }): Promise<PushedVersion> {
      const query = new URLSearchParams();
      if (meta.label) query.set('label', meta.label);
      if (meta.gitSha) query.set('git_sha', meta.gitSha);
      if (meta.gitRef) query.set('git_ref', meta.gitRef);
      const response = await call('POST', `/versions${query.size ? `?${query}` : ''}`, { text, type: meta.format === 'json' ? 'application/json' : 'application/yaml' });
      if (!response.ok) return fail(response);
      const data = (await response.json()) as Omit<PushedVersion, 'status'>;
      return { ...data, status: response.status === 201 ? 201 : 200 };
    },
    async fixes(text: string, format: 'yaml' | 'json'): Promise<Fixes> {
      const response = await call('POST', '/fixes', { text, type: format === 'json' ? 'application/json' : 'application/yaml' });
      if (response.status === 403 || response.status === 429) {
        const data = (await response.json().catch(() => ({}))) as { error?: string; resetsAt?: string };
        return { status: response.status, error: response.status === 429 ? `Latitude 10 quota reached; it resets at ${data.resetsAt ?? 'the start of the next period'}.` : (data.error ?? 'Latitude 10 refused the fixes for this workspace.') };
      }
      if (!response.ok) return fail(response);
      return { status: 200, ...((await response.json()) as Omit<Extract<Fixes, { status: 200 }>, 'status'>) };
    },
  };
}
