import { type Finding, RULES_VERSION, type RuleResult, readiness } from 'openapi-agent-check';
import type { Json } from './bundle.ts';

export type { Finding };

// The same rules the registry and openapi-agent-check run, on this runner.
export function scoreSpec(doc: Json): { score: number; rulesVersion: string; operations: number; findings: Finding[]; rules: RuleResult[] } {
  const report = readiness(doc);
  return { score: report.score, rulesVersion: RULES_VERSION, operations: report.operations, findings: report.rules.flatMap((rule) => rule.findings), rules: report.rules };
}

// What a rules-only fix covers (the registry's /fixes).
export const FIXABLE_RULES = ['operation-ids', 'summaries', 'descriptions', 'parameter-descriptions', 'examples', 'idempotency'];

export function fixableOperations(findings: Finding[]): number {
  const ops = new Set<string>();
  for (const finding of findings) {
    const match = /^([A-Z]+ \S+)/.exec(finding.where);
    if (match && FIXABLE_RULES.includes(finding.rule)) ops.add(match[1]!);
  }
  return ops.size;
}
