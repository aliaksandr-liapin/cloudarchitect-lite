/**
 * The prompts and models the fixtures are recorded with, and the generation flow both the
 * recorder and the freshness test run: extraction, every question answered "you decide",
 * then generation (with any repair turns) — the same sequence as eval/src/live.ts.
 */
import { awsCatalog } from '@cloudarchitect/catalog';
import { YOU_DECIDE, type ModelChoice, type Project } from '@cloudarchitect/domain';
import { extract, extractionModel, generateArchitecture } from '@cloudarchitect/generator';
import type { LlmClient } from '@cloudarchitect/generator';
import type { Provider } from '../fake-ai/fixtures.ts';

const DENTAL =
  'A booking app for a small chain of dental clinics. Patients book and cancel appointments on the web, get email and SMS reminders the day before, and staff see the daily schedule per clinic. Around 5,000 patients. Patient data must stay private.';

const PHOTOS =
  'A photo-sharing site for a hiking club. Members upload trail photos from their phones, the site makes thumbnails, and anyone can browse albums by trail. About 300 members, low traffic, keep costs minimal.';

export const PROMPTS: { anthropic: [string, string]; openai: [string]; google: [string] } = {
  anthropic: [DENTAL, PHOTOS],
  openai: [DENTAL],
  google: [DENTAL],
};

/** The cheapest listed model per provider. */
export const MODELS: Record<Provider, ModelChoice> = {
  anthropic: 'haiku',
  openai: 'gpt-sol',
  google: 'gemini-argon',
};

/** Distinct prompts in recording order, as stored in `fixtures.json`. */
export const ALL_PROMPTS: string[] = [...new Set(Object.values(PROMPTS).flat())];

/** One design: extraction, every question answered `YOU_DECIDE`, generation. */
export async function design(llm: LlmClient, provider: Provider, prompt: string): Promise<Project> {
  const ex = await extract(llm, { prompt, toggles: {} }, extractionModel(provider));
  const r = await generateArchitecture(llm, awsCatalog, {
    prompt,
    toggles: {},
    model: MODELS[provider],
    name: ex.name,
    requirements: ex.requirements,
    assumptions: ex.assumptions,
    questions: ex.questions,
    answers: Object.fromEntries(ex.questions.map((q) => [q.topic, YOU_DECIDE])),
  });
  return r.project;
}
