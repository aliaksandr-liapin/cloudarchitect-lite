import { awsCatalog } from '@cloudarchitect/catalog';
import { Project, validateProject } from '@cloudarchitect/domain';
import { z } from 'zod';

export const Scenario = z.object({
  id: z.string(),
  title: z.string(),
  prompt: z.string().max(8000),
  expectedRequirements: z.array(z.object({ id: z.string(), keywords: z.array(z.string()).min(1) })),
  expectedServices: z.object({
    required: z.array(z.string()),
    anyOf: z.array(z.array(z.string())).default([]),
    forbidden: z.array(z.string()).default([]),
  }),
  maxErrorFindings: z.number().int().min(0).default(0),
});
export type Scenario = z.infer<typeof Scenario>;

export interface ScenarioResult {
  scenarioId: string;
  schemaValid: boolean;
  requirementRecall: number;
  missingServices: string[];
  forbiddenServices: string[];
  errorFindings: number;
  passed: boolean;
}

/** Release thresholds from PRD §13. A regression below these fails CI. */
export const THRESHOLDS = { schemaValidRate: 0.99, requirementRecall: 0.9 } as const;

/**
 * Scores one candidate output against a scenario. Candidates come from the generator (Phase 2) or,
 * until it exists, from hand-written reference projects in `candidates/`.
 */
export function scoreCandidate(scenario: Scenario, candidate: unknown): ScenarioResult {
  const parsed = Project.safeParse(candidate);
  if (!parsed.success) {
    return {
      scenarioId: scenario.id,
      schemaValid: false,
      requirementRecall: 0,
      missingServices: [],
      forbiddenServices: [],
      errorFindings: 0,
      passed: false,
    };
  }
  const p = parsed.data;
  const text = p.requirements.map((r) => r.text.toLowerCase()).join('\n');
  const recalled = scenario.expectedRequirements.filter((r) =>
    r.keywords.some((k) => text.includes(k.toLowerCase())),
  );
  const used = new Set(p.nodes.flatMap((n) => (n.serviceId ? [n.serviceId] : [])));

  const missingServices = [
    ...scenario.expectedServices.required.filter((s) => !used.has(s)),
    ...scenario.expectedServices.anyOf
      .filter((group) => !group.some((s) => used.has(s)))
      .map((g) => g.join('|')),
  ];
  const forbiddenServices = scenario.expectedServices.forbidden.filter((s) => used.has(s));
  const errorFindings = validateProject(p, awsCatalog).filter((f) => f.severity === 'error').length;
  const requirementRecall = scenario.expectedRequirements.length
    ? recalled.length / scenario.expectedRequirements.length
    : 1;

  return {
    scenarioId: scenario.id,
    schemaValid: true,
    requirementRecall,
    missingServices,
    forbiddenServices,
    errorFindings,
    passed:
      requirementRecall >= THRESHOLDS.requirementRecall &&
      missingServices.length === 0 &&
      forbiddenServices.length === 0 &&
      errorFindings <= scenario.maxErrorFindings,
  };
}
