import { describe, expect, it } from 'vitest';
import { gate } from '../src/gate.ts';
import { FIXABLE_RULES, fixableOperations } from '../src/score.ts';

describe('gate', () => {
  it('says why it fails', () => {
    expect(gate({ minScore: 70, maxTools: 40, failOnBreaking: true }, { score: 62, operations: 48, breaking: 3 })).toEqual([
      'score 62 is below min-score 70',
      '48 operations is above max-tools 40',
      '3 breaking changes',
    ]);
  });

  it('passes with no thresholds, or within them', () => {
    expect(gate({ minScore: null, maxTools: 40, failOnBreaking: false }, { score: 10, operations: 40, breaking: 9 })).toEqual([]);
    expect(gate({ minScore: 70, maxTools: 40, failOnBreaking: true }, { score: 70, operations: 3, breaking: 0 })).toEqual([]);
    expect(gate({ minScore: null, maxTools: 40, failOnBreaking: true }, { score: 70, operations: 3, breaking: 1 })).toEqual(['1 breaking change']);
  });
});

describe('fixableOperations', () => {
  it('counts operations with a finding a rules-only fix covers', () => {
    expect(FIXABLE_RULES).toEqual(['operation-ids', 'summaries', 'descriptions', 'parameter-descriptions', 'examples', 'idempotency']);
    expect(
      fixableOperations([
        { rule: 'summaries', where: 'GET /pets', message: '' },
        { rule: 'parameter-descriptions', where: 'GET /pets query:limit', message: '' },
        { rule: 'descriptions', where: 'POST /pets', message: '' },
        { rule: 'security', where: 'spec', message: '' },
      ]),
    ).toBe(2);
  });
});
