/**
 * Arm selection for the effort-budget experiment
 * (docs/superpowers/specs/2026-11-20-effort-budget-experiment-design.md). Arms 0, 1 and 2 send
 * errors and warnings plus 0, 1 or 2 repairable info findings; arm S sends VR-018 alone first.
 */
import type { Finding } from '@cloudarchitect/domain';
import { repairMessageFor } from '@cloudarchitect/generator';
import { armFindings, INFO_RULES_TO_REPAIR } from './info-repair-arms.js';
import { rng, shuffle } from './packets.js';

export type EbArm = '0' | '1' | '2' | 'S';
export const EB_ARMS: readonly EbArm[] = ['0', '1', '2', 'S'];

/** Stable per-job seed: FNV-1a over `${scenarioId}#${repeat}`, unsigned 32-bit. */
export function seedFor(scenarioId: string, repeat: number): number {
  const s = `${scenarioId}#${repeat}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Info findings of the five repairable rules, in validator order. */
export const eligibleInfo = (findings: Finding[]): Finding[] =>
  findings.filter(
    (f) =>
      f.severity === 'info' &&
      f.ruleId !== undefined &&
      (INFO_RULES_TO_REPAIR as readonly string[]).includes(f.ruleId),
  );

/** The first k of a seeded shuffle, so a larger k always extends a smaller one (same seed). */
export const pickInfo = (findings: Finding[], k: number, seed: number): Finding[] =>
  shuffle(eligibleInfo(findings), rng(seed)).slice(0, k);

/** Errors and warnings (validator order), then k picked info findings. */
export const doseFindings = (findings: Finding[], k: 0 | 1 | 2, seed: number): Finding[] => [
  ...armFindings(findings, 'W'),
  ...pickInfo(findings, k, seed),
];

export const vr018Only = (findings: Finding[]): Finding[] =>
  findings.filter((f) => f.ruleId === 'VR-018');

export const hasVr018 = (findings: Finding[]): boolean => vr018Only(findings).length > 0;

/** Plain repair message for a dose arm, or undefined when the arm has nothing to send. */
export function doseMessage(findings: Finding[], k: 0 | 1 | 2, seed: number): string | undefined {
  const sent = doseFindings(findings, k, seed);
  return sent.length ? repairMessageFor(sent) : undefined;
}
