import type { Io } from '../src/io.ts';

// A fake Actions runtime: inputs from a map, everything the action reports recorded.
export function fakeIo(inputs: Record<string, string>, env: Record<string, string> = {}, overrides: Partial<Io> = {}) {
  const calls = { failed: [] as string[], warnings: [] as Array<{ message: string; props: unknown }>, notices: [] as string[], outputs: {} as Record<string, unknown>, summary: '' };
  const io: Io = {
    core: {
      getInput: (name: string) => inputs[name] ?? '',
      setFailed: (message: string | Error) => void calls.failed.push(String(message)),
      warning: (message: string | Error, props?: unknown) => void calls.warnings.push({ message: String(message), props }),
      notice: (message: string | Error) => void calls.notices.push(String(message)),
      info: () => {},
      setOutput: (name: string, value: unknown) => void (calls.outputs[name] = value),
      summary: {
        addRaw(text: string, addEol = false) {
          calls.summary += text + (addEol ? '\n' : '');
          return this;
        },
        async write() {
          return this;
        },
      },
    },
    env: { GITHUB_REPOSITORY: 'acme/api', GITHUB_SHA: 'abc123', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'push', ...env },
    fetch: (async () => {
      throw new Error('fetch must not be called');
    }) as typeof fetch,
    git: async () => {
      throw new Error('no base');
    },
    event: {},
    ...overrides,
  };
  return { io, calls };
}
