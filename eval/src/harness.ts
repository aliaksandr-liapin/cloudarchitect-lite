import { awsCatalog } from '@cloudarchitect/catalog';
import { DesignToggles, GapTopic, Project, validateProject } from '@cloudarchitect/domain';
import { z } from 'zod';

/** Benchmark classes from PRD §13; the Phase 0 set covers each at least once. */
export const ScenarioClass = z.enum([
  'static-web',
  'serverless-api',
  'event-driven',
  'data-pipeline',
  'containerized-api',
  'ml-inference',
  'legacy-migration',
  'workflow',
  'security-compliance',
]);

export const Scenario = z.object({
  id: z.string(),
  title: z.string(),
  class: ScenarioClass,
  prompt: z.string().max(8000),
  expectedRequirements: z.array(z.object({ id: z.string(), keywords: z.array(z.string()).min(1) })),
  expectedServices: z.object({
    required: z.array(z.string()),
    anyOf: z.array(z.array(z.string())).default([]),
    forbidden: z.array(z.string()).default([]),
  }),
  /** Needs outside the catalog: each must appear as an unresolved node whose name matches a keyword (FR-020). */
  expectedUnresolved: z
    .array(z.object({ id: z.string(), keywords: z.array(z.string()).min(1) }))
    .default([]),
  maxErrorFindings: z.number().int().min(0).default(0),
  /** Design toggles enabled for the live generator run. */
  toggles: DesignToggles.default({}),
  /** Answers to clarification questions by topic; unanswered topics get "You decide". */
  answers: z.partialRecord(GapTopic, z.string()).default({}),
  /** Validation rule ids that must not fire on the candidate (e.g. a toggle the design ignores). */
  forbiddenRules: z.array(z.string()).default([]),
});
export type Scenario = z.infer<typeof Scenario>;

export interface ScenarioResult {
  scenarioId: string;
  schemaValid: boolean;
  requirementRecall: number;
  missingServices: string[];
  forbiddenServices: string[];
  missingUnresolved: string[];
  errorFindings: number;
  forbiddenRuleHits: string[];
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
      missingUnresolved: [],
      errorFindings: 0,
      forbiddenRuleHits: [],
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
  const unresolvedNames = p.nodes.flatMap((n) =>
    n.unresolved ? [n.unresolved.name.toLowerCase()] : [],
  );
  const missingUnresolved = scenario.expectedUnresolved
    .filter(
      (u) =>
        !unresolvedNames.some((name) => u.keywords.some((k) => name.includes(k.toLowerCase()))),
    )
    .map((u) => u.id);
  const findings = validateProject(p, awsCatalog);
  const errorFindings = findings.filter((f) => f.severity === 'error').length;
  const firedRules = new Set(findings.flatMap((f) => (f.ruleId ? [f.ruleId] : [])));
  const forbiddenRuleHits = scenario.forbiddenRules.filter((r) => firedRules.has(r));
  const requirementRecall = scenario.expectedRequirements.length
    ? recalled.length / scenario.expectedRequirements.length
    : 1;

  return {
    scenarioId: scenario.id,
    schemaValid: true,
    requirementRecall,
    missingServices,
    forbiddenServices,
    missingUnresolved,
    errorFindings,
    forbiddenRuleHits,
    passed:
      requirementRecall >= THRESHOLDS.requirementRecall &&
      missingServices.length === 0 &&
      forbiddenServices.length === 0 &&
      missingUnresolved.length === 0 &&
      errorFindings <= scenario.maxErrorFindings &&
      forbiddenRuleHits.length === 0,
  };
}
