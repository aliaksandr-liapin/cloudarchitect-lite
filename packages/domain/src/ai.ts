import { z } from 'zod';
import { ModelChoice } from './models.js';
import { LIMITS, Project, Requirement } from './project.js';
import { DesignToggles } from './toggles.js';

/** Fixed list of gaps the clarification step may ask about. */
export const GapTopic = z.enum([
  'auth-methods',
  'user-scale',
  'data-retention',
  'region-residency',
  'compliance',
  'notifications',
  'media-processing',
  'integrations',
  'availability-target',
]);
export type GapTopic = z.infer<typeof GapTopic>;

export const Question = z.object({
  topic: GapTopic,
  text: z.string().min(1).max(500),
  suggestions: z.array(z.string().min(1).max(120)).min(2).max(4),
});
export type Question = z.infer<typeof Question>;

/** Answer value meaning "let the model decide". */
export const YOU_DECIDE = 'you-decide';

export const GenerateRequest = z.object({
  prompt: z.string().min(1).max(LIMITS.maxPromptChars),
  catalogVersion: z.string(),
  model: ModelChoice.optional(),
  toggles: DesignToggles.default({}),
  reviewRequirements: z.boolean().default(false),
});
export type GenerateRequest = z.infer<typeof GenerateRequest>;

export const ContinueRequest = z
  .object({
    operationId: z.string().uuid(),
    operationToken: z.string().max(64_000),
    answers: z.partialRecord(GapTopic, z.string().min(1).max(500)).default({}),
    requirements: z.array(Requirement).min(1).max(100).optional(),
  })
  .refine((r) => new Set(r.requirements?.map((q) => q.id)).size === (r.requirements?.length ?? 0), {
    message: 'Requirement ids must be unique',
    path: ['requirements'],
  });
export type ContinueRequest = z.infer<typeof ContinueRequest>;

export type GenerateResponse =
  | {
      status: 'questions';
      operationId: string;
      operationToken: string;
      requirements: Requirement[];
      assumptions: string[];
      questions: Question[];
    }
  | { status: 'done'; project: Project; usage: { costUsd: number } };
