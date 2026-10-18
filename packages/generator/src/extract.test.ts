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
    const r = await extract(llm, { prompt: 'a shop', toggles: {} });
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
    const r = await extract(llm, { prompt: 'a shop', toggles: { highAvailability: true } });
    expect(r.questions.map((x) => x.topic)).toEqual(['user-scale']);
  });

  it('always uses Haiku', async () => {
    const { llm, requests } = fake({ ...base, questions: [] });
    await extract(llm, { prompt: 'a shop', toggles: { backups: true } });
    expect(requests[0]?.model).toBe('claude-haiku-5-5');
    expect(requests[0]?.maxTokens).toBe(4000);
    expect(requests[0]?.effort).toBe('low');
    expect(requests[0]?.system).toContain('Backups');
  });

  it('throws GenerationError on invalid JSON and carries usage', async () => {
    const { llm } = fake(null, 'not json');
    const err = await extract(llm, { prompt: 'x', toggles: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GenerationError);
    expect((err as GenerationError).usage[0]?.usage).toEqual(usage);
  });

  it('throws GenerationError on schema-invalid JSON', async () => {
    const { llm } = fake({ name: 'x' });
    await expect(extract(llm, { prompt: 'x', toggles: {} })).rejects.toBeInstanceOf(
      GenerationError,
    );
  });
});
