import type { Finding } from '@cloudarchitect/domain';
import { infoRepairMessage, repairMessageFor } from '@cloudarchitect/generator';
import { rng, shuffle } from './packets.js';

export type Arm = 'W' | 'I';

export const INFO_RULES_TO_REPAIR = ['VR-005', 'VR-007', 'VR-008', 'VR-013', 'VR-024'] as const;

/** Findings an arm sends back to the model. W sends errors and warnings only; I adds five info rules. */
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

export { infoRepairMessage };

/** The repair message for an arm, or undefined when the arm has nothing to send. */
export function messageFor(arm: Arm, findings: Finding[]): string | undefined {
  const sent = armFindings(findings, arm);
  // Arm I with no info finding to send makes the same request as arm W.
  return sent.length ? repairMessageFor(sent) : undefined;
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
