import { Question, Requirement } from '@cloudarchitect/domain';
import { describe, expect, it } from 'vitest';
import { allowedTopics, extract } from './extract.js';
import { GenerationError, type LlmClient, type LlmRequest } from './llm.js';

const usage = { input: 1000, output: 200, cacheWrite: 0, cacheRead: 0 };
const q = (topic: string) => ({ topic, text: `About ${topic}?`, suggestions: ['a', 'b'] });

function fake(body: unknown, text?: string) {
  const requests: LlmRequest[] = [];
  const llm: LlmClient = async (req) => {
    requests.push(req);
    return { text: text ?? JSON.stringify(body), usage, stopReason: 'end_turn' };
  };
  return { llm, requests };
}

const base = {
  name: 'Shop',
  requirements: [{ id: 'R1', text: 'Sell things', type: 'functional', status: 'confirmed' }],
  assumptions: ['EU users'],
};

describe('extract', () => {
  it('returns questions with stable topics and caps them at 3', async () => {
    const { llm } = fake({
      ...base,
      questions: [
        q('auth-methods'),
        q('auth-methods'),
        q('user-scale'),
        q('compliance'),
        q('notifications'),
      ],
    });
    const r = await extract(llm, { prompt: 'a shop', toggles: {} }, 'claude-haiku-5-5');
    expect(r.questions.map((x) => x.topic)).toEqual(['auth-methods', 'user-scale', 'compliance']);
    expect(r.requirements[0]?.provenance).toBe('ai');
    expect(r.usage).toHaveLength(1);
    expect(r.usage[0]?.costMicroUsd).toBeGreaterThan(0);
  });

  it('drops availability-target when highAvailability is on', async () => {
    expect(allowedTopics({ highAvailability: true })).not.toContain('availability-target');
    expect(allowedTopics({ disasterRecovery: 'multi-az' })).not.toContain('availability-target');
    expect(allowedTopics({})).toContain('availability-target');
    const { llm } = fake({ ...base, questions: [q('availability-target'), q('user-scale')] });
    const r = await extract(
      llm,
      { prompt: 'a shop', toggles: { highAvailability: true } },
      'claude-haiku-5-5',
    );
    expect(r.questions.map((x) => x.topic)).toEqual(['user-scale']);
  });

  it('sends the request to the given extraction model', async () => {
    const { llm, requests } = fake({ ...base, questions: [] });
    await extract(llm, { prompt: 'a shop', toggles: { backups: true } }, 'claude-haiku-5-5');
    expect(requests[0]?.model).toBe('claude-haiku-5-5');
    expect(requests[0]?.maxTokens).toBe(4000);
    expect(requests[0]?.effort).toBe('low');
    expect(requests[0]?.system).toContain('Backups');
  });

  it('uses the model argument, not a fixed model', async () => {
    const { llm, requests } = fake({ ...base, questions: [] });
    await extract(llm, { prompt: 'a shop', toggles: {} }, 'claude-sonnet-5-5');
    expect(requests[0]?.model).toBe('claude-sonnet-5-5');
  });

  it('drops questions with fewer than 2 suggestions and keeps at most 4', async () => {
    const { llm } = fake({
      ...base,
      questions: [
        { topic: 'auth-methods', text: 'How?', suggestions: ['only one'] },
        { topic: 'user-scale', text: 'How many?', suggestions: ['1', '2', '3', '4', '5'] },
        { topic: 'compliance', text: 'Which?', suggestions: ['', '  ', 'GDPR'] },
      ],
    });
    const r = await extract(llm, { prompt: 'a shop', toggles: {} }, 'claude-haiku-5-5');
    expect(r.questions.map((x) => x.topic)).toEqual(['user-scale']);
    expect(r.questions[0]?.suggestions).toEqual(['1', '2', '3', '4']);
  });

  it('truncates question and suggestion texts to the schema limits', async () => {
    const { llm } = fake({
      ...base,
      questions: [
        { topic: 'user-scale', text: 'q'.repeat(600), suggestions: ['s'.repeat(150), 'b'] },
      ],
    });
    const r = await extract(llm, { prompt: 'a shop', toggles: {} }, 'claude-haiku-5-5');
    expect(r.questions[0]?.text).toHaveLength(500);
    expect(r.questions[0]?.suggestions[0]).toHaveLength(120);
    expect(() => Question.array().parse(r.questions)).not.toThrow();
  });

  it('drops empty requirements and truncates long ones', async () => {
    const req = (id: string, text: string) => ({
      id,
      text,
      type: 'functional',
      status: 'confirmed',
    });
    const { llm } = fake({
      ...base,
      requirements: [req('R1', 'Sell things'), req('R2', '   '), req('R3', 'x'.repeat(2500))],
      questions: [],
    });
    const r = await extract(llm, { prompt: 'a shop', toggles: {} }, 'claude-haiku-5-5');
    expect(r.requirements.map((x) => x.id)).toEqual(['R1', 'R3']);
    expect(r.requirements[1]?.text).toHaveLength(2000);
  });

  it('re-ids duplicate, reserved and invalid requirement ids to the first free R<n>', async () => {
    const req = (id: string) => ({ id, text: `Req ${id}`, type: 'functional', status: 'inferred' });
    const { llm } = fake({
      ...base,
      requirements: [req('R1'), req('R1'), req('C-auth'), req('T-backups'), req('R2'), req('')],
      questions: [],
    });
    const r = await extract(llm, { prompt: 'a shop', toggles: {} }, 'claude-haiku-5-5');
    expect(r.requirements.map((x) => x.id)).toEqual(['R1', 'R3', 'R4', 'R5', 'R2', 'R6']);
    expect(r.requirements[1]?.text).toBe('Req R1');
    expect(() => Requirement.array().parse(r.requirements)).not.toThrow();
  });

  it('throws GenerationError on invalid JSON and carries usage', async () => {
    const { llm } = fake(null, 'not json');
    const err = await extract(llm, { prompt: 'x', toggles: {} }, 'claude-haiku-5-5').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(GenerationError);
    expect((err as GenerationError).usage[0]?.usage).toEqual(usage);
  });

  it('throws GenerationError on schema-invalid JSON', async () => {
    const { llm } = fake({ name: 'x' });
    await expect(
      extract(llm, { prompt: 'x', toggles: {} }, 'claude-haiku-5-5'),
    ).rejects.toBeInstanceOf(GenerationError);
  });
});
