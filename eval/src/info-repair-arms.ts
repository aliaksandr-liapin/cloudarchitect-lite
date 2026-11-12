import type { Finding } from '@cloudarchitect/domain';
import { formatFindings, repairMessage } from '@cloudarchitect/generator';
import { rng, shuffle } from './packets.js';

export type Arm = 'W' | 'I';

export const INFO_RULES_TO_REPAIR = ['VR-005', 'VR-007', 'VR-008', 'VR-013', 'VR-024'] as const;

/** Findings an arm sends back to the model. W is today's app behavior; I adds five info rules. */
export function armFindings(findings: Finding[], arm: Arm): Finding[] {
  return findings.filter(
    (f) =>
      f.severity === 'error' ||
      f.severity === 'warning' ||
      (arm === 'I' &&
        f.severity === 'info' &&
        f.ruleId !== undefined &&
        (INFO_RULES_TO_REPAIR as readonly string[]).includes(f.ruleId)),
  );
}

export function infoRepairMessage(list: string): string {
  return `The deterministic validator reported these findings on your architecture:\n${list}\n\nReturn the complete corrected architecture. Fix every error. Fix each warning, or keep it only if it is intentional and say why in assumptions. Apply each info finding if it fits the requirements; otherwise leave it and say why in assumptions. Do not change anything else.`;
}

/** The repair message for an arm, or undefined when the arm has nothing to send. */
export function messageFor(arm: Arm, findings: Finding[]): string | undefined {
  const sent = armFindings(findings, arm);
  if (sent.length === 0) return undefined;
  const list = formatFindings(sent);
  // Arm I with no info finding to send makes the same request as arm W.
  const infoSent = sent.some((f) => f.severity === 'info');
  return arm === 'I' && infoSent ? infoRepairMessage(list) : repairMessage(list);
}

/** Per model: differing pairs only, info-bearing first, each group shuffled with the seed. */
export function sampleReviewJobs<T extends { model: string; differ: boolean; infoSent: number }>(
  jobs: T[],
  perModel: number,
  seed: number,
): T[] {
  const rand = rng(seed);
  const out: T[] = [];
  for (const model of [...new Set(jobs.map((j) => j.model))]) {
    const differ = jobs.filter((j) => j.model === model && j.differ);
    const withInfo = shuffle(
      differ.filter((j) => j.infoSent > 0),
      rand,
    );
    const rest = shuffle(
      differ.filter((j) => j.infoSent === 0),
      rand,
    );
    out.push(...[...withInfo, ...rest].slice(0, perModel));
  }
  return out;
}
