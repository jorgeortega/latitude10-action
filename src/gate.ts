export type GateInputs = { minScore: number | null; maxTools: number; failOnBreaking: boolean };

// The reasons to fail the job; none means it passes.
export function gate(inputs: GateInputs, result: { score: number; operations: number; breaking: number }): string[] {
  const reasons: string[] = [];
  if (inputs.minScore !== null && result.score < inputs.minScore) reasons.push(`score ${result.score} is below min-score ${inputs.minScore}`);
  if (result.operations > inputs.maxTools) reasons.push(`${result.operations} operations is above max-tools ${inputs.maxTools}`);
  if (inputs.failOnBreaking && result.breaking > 0) reasons.push(`${result.breaking} breaking change${result.breaking === 1 ? '' : 's'}`);
  return reasons;
}
