import { annotate } from './annotate.ts';
import { baseWithoutKey } from './base.ts';
import { type Json, bundleSpec } from './bundle.ts';
import { gate } from './gate.ts';
import { type Io, defaultIo } from './io.ts';
import { fixableOperations, scoreSpec } from './score.ts';
import { type Change, diff, summarize } from './shared/diff.ts';

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

    // The base: the spec on the pull request's base branch.
    let base: Json | null = null;
    let baseName = '';
    const baseRef = env.GITHUB_BASE_REF;
    if (baseRef && !bundled.multiFile) {
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
    const fixable = fixableOperations(result.findings);
    if (fixable) lines.push('', `${plural(fixable, 'operation')} have a suggested fix with a Latitude 10 project key on a paid plan.`.replace(/^1 operation have/, '1 operation has'));
    lines.push('', reasons.length ? `**Failed:** ${reasons.join('; ')}` : '**Passed.**');
    core.summary.addRaw(lines.join('\n'), true);
    await core.summary.write();

    if (reasons.length) core.setFailed(`Readiness gate failed: ${reasons.join('; ')}`);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

if (!process.env.VITEST) await run(await defaultIo());
