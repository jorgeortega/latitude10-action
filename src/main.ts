import { annotate } from './annotate.ts';
import { baseWithoutKey } from './base.ts';
import { type Json, bundleSpec } from './bundle.ts';
import { gate } from './gate.ts';
import { type Io, defaultIo } from './io.ts';
import { applyToSource } from './patch.ts';
import { openFixesPullRequest } from './pull-request.ts';
import { fixableOperations, scoreSpec } from './score.ts';
import { RegistryError, registryClient } from './registry.ts';
import { type Change, diff, summarize } from './shared/diff.ts';
import { parse } from 'yaml';

// The readiness gate: bundle, score, annotate, diff against a base, gate,
// and with LATITUDE10_KEY push the version and suggest fixes. With no key,
// nothing leaves the runner.

export type Inputs = {
  spec: string;
  minScore: number | null;
  maxTools: number;
  failOnBreaking: boolean;
  push: boolean;
  suggestFixes: boolean;
  label: string;
  apiUrl: string;
};

const bool = (value: string) => value.trim().toLowerCase() === 'true';

function number(name: string, value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, not "${value}"`);
  return n;
}

export function readInputs(io: Io): Inputs {
  const get = (name: string) => io.core.getInput(name);
  const spec = get('spec').trim();
  if (!spec) throw new Error('Set the spec input to your OpenAPI file, for example spec: openapi.yaml');
  return {
    spec,
    minScore: number('min-score', get('min-score')),
    maxTools: number('max-tools', get('max-tools')) ?? 40,
    failOnBreaking: bool(get('fail-on-breaking')),
    push: bool(get('push')),
    suggestFixes: bool(get('suggest-fixes')),
    label: get('label').trim(),
    apiUrl: (get('api-url').trim() || 'https://latitude10.tech').replace(/\/+$/, ''),
  };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export async function run(io: Io): Promise<void> {
  const { core, env } = io;
  try {
    const inputs = readInputs(io);
    const bundled = await bundleSpec(inputs.spec);
    const result = scoreSpec(bundled.doc);
    const overflow = annotate(inputs.spec, bundled.source, result.findings, core);

    // A pull request from a fork never gets the key, a push or a fixes PR.
    const headRepo = io.event.pull_request?.head?.repo?.full_name;
    const fork = !!headRepo && headRepo !== env.GITHUB_REPOSITORY;
    const key = fork ? '' : (env.LATITUDE10_KEY ?? '').trim();
    if (fork && (inputs.push || inputs.suggestFixes || env.LATITUDE10_KEY)) core.notice('This pull request comes from a fork: the registry, push and suggested fixes are skipped.');
    const registry = key ? registryClient(inputs.apiUrl, key, io.fetch) : null;

    // The base: with a key, the registry's latest version; else (or when the
    // registry has none) the spec on the pull request's base branch.
    let base: Json | null = null;
    let baseName = '';
    if (registry) {
      const latest = await registry.latest();
      if (latest) {
        base = parse(await registry.source(latest.seq)) as Json;
        baseName = `registry version #${latest.seq}`;
      }
    }
    const baseRef = env.GITHUB_BASE_REF;
    if (!base && baseRef && !bundled.multiFile) {
      base = await baseWithoutKey(io.git, inputs.spec, baseRef);
      baseName = `${baseRef} branch`;
    }
    const changes: Change[] = base ? diff(base, bundled.doc) : [];
    const { breaking, warnings } = summarize(changes);

    core.setOutput('score', result.score);
    core.setOutput('operations', result.operations);
    core.setOutput('breaking', breaking);

    const reasons = gate(inputs, { score: result.score, operations: result.operations, breaking });

    const lines = [
      `## Agent readiness: ${inputs.spec}`,
      '',
      '| | |',
      '|---|---|',
      `| Score | ${result.score} |`,
      `| Rules version | ${result.rulesVersion} |`,
      `| Operations | ${result.operations} |`,
      base ? `| Against ${baseName} | ${plural(breaking, 'breaking change')}, ${plural(warnings, 'warning')} |` : '| Against a base | none found |',
      '',
      '| Rule | Passing |',
      '|---|---|',
      ...result.rules.map((rule) => `| ${rule.title} | ${rule.passing} / ${rule.applicable} |`),
    ];
    if (overflow) lines.push('', `${plural(overflow, 'more finding')} not annotated.`);
    for (const change of changes.filter((c) => c.level === 'breaking')) lines.push(`- **Breaking:** ${change.message} (\`${change.pointer}\`)`);
    // With a key and push, upload the version, only when the gate passed.
    if (registry && inputs.push && !reasons.length) {
      try {
        const pushed = await registry.push(bundled.multiFile ? bundled.text : bundled.source, {
          label: inputs.label || String(bundled.doc.info?.version ?? ''),
          gitSha: env.GITHUB_SHA ?? '',
          gitRef: env.GITHUB_REF ?? '',
          format: bundled.format,
        });
        core.setOutput('version-url', pushed.url);
        lines.push('', pushed.status === 201 ? `Pushed as [version #${pushed.seq}](${pushed.url}).` : `Same as [version #${pushed.seq}](${pushed.url}); nothing new pushed.`);
      } catch (error) {
        if (error instanceof RegistryError && error.status === 429) core.notice(error.message);
        else throw error;
      }
    }

    const fixable = fixableOperations(result.findings);
    const haveFix = (n: number) => (n === 1 ? '1 operation has' : `${n} operations have`);
    if (registry && inputs.suggestFixes && fixable) {
      const fixes = await registry.fixes(bundled.multiFile ? bundled.text : bundled.source, bundled.format);
      if (fixes.status !== 200) {
        lines.push('', `${haveFix(fixable)} a suggested fix.`);
        core.notice(fixes.error);
      } else if (bundled.multiFile) lines.push('', `${haveFix(fixes.operations)} a suggested fix. The spec spans several files, so no pull request was opened.`);
      else if (fixes.patch.length) {
        const token = core.getInput('github-token') || env.GITHUB_TOKEN || '';
        const [owner, repo] = (env.GITHUB_REPOSITORY ?? '').split('/');
        const base = env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || '';
        if (!token || !io.octokit || !owner || !repo || !base) {
          core.notice('Suggested fixes need the workflow token with contents: write and pull-requests: write.');
        } else {
          const pr = await openFixesPullRequest({
            octokit: io.octokit(token),
            owner,
            repo,
            base,
            path: inputs.spec.replace(/^\.\//, ''),
            content: applyToSource(bundled.source, bundled.format, fixes.patch),
            summary: `Score ${fixes.scoreBefore} → ${fixes.scoreAfter}, ${plural(fixes.operations, 'operation')} improved.`,
          });
          lines.push('', `Suggested fixes: [pull request](${pr.url}) (score ${fixes.scoreBefore} → ${fixes.scoreAfter}).`);
        }
      }
    } else if (fixable) {
      lines.push('', `${haveFix(fixable)} a suggested fix with a Latitude 10 project key, on any plan.`);
    }
    lines.push('', reasons.length ? `**Failed:** ${reasons.join('; ')}` : '**Passed.**');
    core.summary.addRaw(lines.join('\n'), true);
    await core.summary.write();

    if (reasons.length) core.setFailed(`Readiness gate failed: ${reasons.join('; ')}`);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

if (!process.env.VITEST) await run(await defaultIo());
