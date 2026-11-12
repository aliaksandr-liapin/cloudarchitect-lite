import { awsCatalog } from '@cloudarchitect/catalog';
import type { Project } from '@cloudarchitect/domain';
import type { LlmClient, LlmRequest } from '@cloudarchitect/generator';
import { describe, expect, it } from 'vitest';
import { Scenario } from './harness.js';
import { runInfoRepairJob } from './info-repair-job.js';

const usage = { input: 2000, output: 800, cacheWrite: 0, cacheRead: 0 };

const scenario = Scenario.parse({
  id: 'orders',
  title: 'Orders',
  class: 'event-driven',
  prompt: 'An order pipeline',
  expectedRequirements: [{ id: 'orders', keywords: ['order'] }],
  expectedServices: { required: ['aws.sqs'] },
});

const extraction = {
  name: 'Orders',
  requirements: [
    { id: 'R1', text: 'Process orders asynchronously', type: 'functional', status: 'confirmed' },
  ],
  assumptions: [],
  questions: [],
};

const node = (id: string, serviceId: string, requirementIds: string[]) => ({
  id,
  serviceId,
  label: id,
  purpose: `The ${id}`,
  rationale: `Needed for ${id}`,
  containerId: 'region',
  requirementIds,
  configuration: [],
});

/**
 * A queue-triggered Lambda. `dlq` decides whether VR-004 (warning) fires; `monitored` whether
 * a CloudWatch node exists (VR-007, info, fires without one).
 */
function graph(dlq: boolean, monitored: boolean) {
  return {
    name: 'Orders',
    inferredRequirements: monitored
      ? [{ id: 'I1', text: 'Observe the pipeline', type: 'non-functional' }]
      : [],
    assumptions: [],
    containers: [
      { id: 'cloud', kind: 'aws-cloud', label: 'AWS' },
      { id: 'region', kind: 'region', parentId: 'cloud', label: 'eu-west-1' },
    ],
    nodes: [
      node('queue', 'aws.sqs', ['R1']),
      node('fn', 'aws.lambda', ['R1']),
      ...(monitored ? [node('logs', 'aws.cloudwatch', ['I1'])] : []),
    ],
    edges: [
      {
        id: 'e1',
        source: 'queue',
        target: 'fn',
        kind: 'event',
        label: 'orders',
        requirementIds: ['R1'],
        configuration: [{ key: 'deadLetterQueue', value: dlq ? 'orders-dlq' : 'none' }],
      },
      ...(monitored
        ? [
            {
              id: 'e2',
              source: 'fn',
              target: 'logs',
              kind: 'write',
              label: 'logs',
              requirementIds: ['I1'],
              configuration: [],
            },
          ]
        : []),
    ],
  };
}

/** Extraction first, the draft second; repairs are routed by their message so concurrency cannot reorder them. */
function fake(answers: { draft: unknown; W?: unknown; I?: unknown }) {
  const requests: LlmRequest[] = [];
  const llm: LlmClient = async (req) => {
    requests.push(req);
    const last = req.messages[req.messages.length - 1]!.content;
    const body: unknown =
      requests.length === 1
        ? extraction
        : requests.length === 2
          ? answers.draft
          : last.includes('Apply each info finding')
            ? answers.I
            : answers.W;
    if (body instanceof Error) throw body;
    return {
      text: typeof body === 'string' ? body : JSON.stringify(body),
      usage,
      stopReason: 'end_turn',
    };
  };
  return { llm, requests };
}

const run = (llm: LlmClient) => {
  const saved: Record<string, Project> = {};
  const record = runInfoRepairJob(llm, awsCatalog, scenario, 'haiku', 1, (name, p) => {
    saved[name] = p;
  });
  return { record, saved };
};

describe('runInfoRepairJob', () => {
  it('repairs both arms from the same draft', async () => {
    const draft = graph(false, false);
    const { llm, requests } = fake({ draft, W: graph(true, false), I: graph(true, true) });
    const { record, saved } = run(llm);
    const r = await record;

    expect(requests).toHaveLength(4);
    const repairs = requests.slice(2);
    const draftText = JSON.stringify(draft);
    for (const q of repairs) {
      expect(q.messages).toHaveLength(3);
      expect(q.messages[1]).toEqual({ role: 'assistant', content: draftText });
    }
    const user = repairs.map((q) => q.messages[2]!.content);
    expect(user.filter((m) => m.includes('Apply each info finding'))).toHaveLength(1);
    expect(user.filter((m) => !m.includes('Apply each info finding'))).toHaveLength(1);

    expect(r.ok).toBe(true);
    expect(r.infoSent).toBeGreaterThan(0);
    expect(r.sameRequest).toBe(false);
    expect(r.differ).toBe(true);
    expect(r.armsDiff).toBeGreaterThan(0);
    expect(r.arms?.W.repaired).toBe(true);
    expect(r.arms?.I.repaired).toBe(true);
    expect(r.arms?.W.ok && r.arms.I.ok).toBe(true);
    expect(r.arms?.W.score).toBeDefined();
    expect(Object.keys(saved).sort()).toEqual(['I', 'W', 'draft']);
    expect(r.calls).toHaveLength(4);
    expect(r.costUsd).toBeCloseTo(
      r.calls.reduce((a, c) => a + c.costUsd, 0),
      9,
    );
    // Each arm pays for extraction, the draft and its own repair only.
    expect(r.arms!.W.costUsd).toBeCloseTo(r.calls[0]!.costUsd * 3, 9);
    expect(r.arms!.W.costUsd).toBeLessThan(r.costUsd);
  });

  it('skips the W repair for an info-only draft', async () => {
    const { llm, requests } = fake({ draft: graph(true, false), I: graph(true, true) });
    const r = await run(llm).record;

    expect(requests).toHaveLength(3);
    expect(r.arms?.W.repaired).toBe(false);
    expect(r.arms?.W.collateral).toBe(0);
    expect(r.arms?.W.targeted).toBe(0);
    expect(r.arms?.I.repaired).toBe(true);
    expect(r.sameRequest).toBe(false);
    expect(r.infoSent).toBeGreaterThan(0);
    expect(r.differ).toBe(true);
  });

  it('marks identical requests as sameRequest', async () => {
    const { llm, requests } = fake({
      draft: graph(false, true),
      W: graph(true, true),
      I: graph(true, true),
    });
    const r = await run(llm).record;

    expect(requests).toHaveLength(4);
    expect(r.infoSent).toBe(0);
    expect(r.sameRequest).toBe(true);
  });

  it('records a failed arm without dropping the job', async () => {
    const { llm } = fake({ draft: graph(false, false), W: graph(true, false), I: 'not json' });
    const r = await run(llm).record;

    expect(r.ok).toBe(true);
    expect(r.arms?.I.ok).toBe(false);
    expect(r.arms?.I.score?.schemaValid).toBe(false);
    expect(r.arms?.W.ok).toBe(true);
    expect(r.arms?.I.costUsd).toBeGreaterThan(0);
  });

  it('settles both arms before failing the job on a non-generation error', async () => {
    const { llm } = fake({
      draft: graph(false, false),
      W: graph(true, false),
      I: new Error('transport down'),
    });
    let returned = false;
    let savedAfterReturn = false;
    const record = await runInfoRepairJob(llm, awsCatalog, scenario, 'haiku', 1, () => {
      if (returned) savedAfterReturn = true;
    });
    returned = true;
    await new Promise((r) => setTimeout(r, 0));

    expect(record.ok).toBe(false);
    expect(record.error).toBe('transport down');
    expect(record.calls).toHaveLength(3);
    expect(record.costUsd).toBeCloseTo(
      record.calls.reduce((a, c) => a + c.costUsd, 0),
      9,
    );
    expect(savedAfterReturn).toBe(false);
  });

  it('records a failed draft as ok false without arms and hands over the rejected text', async () => {
    const { llm, requests } = fake({ draft: 'not json' });
    const rejected: string[] = [];
    const r = await runInfoRepairJob(
      llm,
      awsCatalog,
      scenario,
      'haiku',
      1,
      () => {},
      (text) => rejected.push(text),
    );

    expect(requests).toHaveLength(2);
    expect(r.ok).toBe(false);
    expect(r.arms).toBeUndefined();
    expect(r.costUsd).toBeGreaterThan(0);
    expect(rejected).toEqual(['not json']);
  });

  it('does not hand over rejected text when the draft succeeds', async () => {
    const { llm } = fake({ draft: graph(false, false), W: graph(true, false), I: 'not json' });
    const rejected: string[] = [];
    await runInfoRepairJob(
      llm,
      awsCatalog,
      scenario,
      'haiku',
      1,
      () => {},
      (text) => rejected.push(text),
    );
    expect(rejected).toEqual([]);
  });

  it('times each arm as extraction + draft + its own repair', async () => {
    const slow = { W: 0, I: 120 };
    const { llm: base } = fake({
      draft: graph(false, false),
      W: graph(true, false),
      I: graph(true, true),
    });
    let n = 0;
    const llm: LlmClient = async (req) => {
      n++;
      const last = req.messages[req.messages.length - 1]!.content;
      if (n === 2) await new Promise((r) => setTimeout(r, 40)); // the draft
      if (n > 2) {
        const ms = last.includes('Apply each info finding') ? slow.I : slow.W;
        await new Promise((r) => setTimeout(r, ms));
      }
      return base(req);
    };
    const r = await run(llm).record;

    const { W, I } = r.arms!;
    expect(W.latencyMs).toBeGreaterThanOrEqual(40);
    expect(W.latencyMs).toBeLessThan(I.latencyMs - 60);
    expect(I.latencyMs).toBeGreaterThanOrEqual(160);
    expect(I.latencyMs).toBeLessThanOrEqual(r.latencyMs);
  });
});
