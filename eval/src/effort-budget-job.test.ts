import { awsCatalog } from '@cloudarchitect/catalog';
import type { Project } from '@cloudarchitect/domain';
import type { LlmClient, LlmRequest } from '@cloudarchitect/generator';
import { describe, expect, it } from 'vitest';
import { runEffortBudgetJob, toPairRecord } from './effort-budget-job.js';
import { Scenario } from './harness.js';

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

const node = (id: string, serviceId: string, containerId: string, requirementIds: string[]) => ({
  id,
  serviceId,
  label: id,
  purpose: `The ${id}`,
  rationale: `Needed for ${id}`,
  containerId,
  requirementIds,
  configuration: [],
});

/**
 * A queue-triggered Lambda behind ALBs. `dlq` decides VR-004 (warning); `monitored` decides
 * VR-007 (info, the one repairable info finding here); `alb` 'one' puts an ALB in a single
 * availability zone (VR-018, warning), 'two' in two zones (no VR-018), 'none' has no ALB.
 */
function graph(dlq: boolean, monitored: boolean, alb: 'none' | 'one' | 'two') {
  const azs = alb === 'none' ? [] : alb === 'one' ? ['az1'] : ['az1', 'az2'];
  return {
    name: 'Orders',
    inferredRequirements: monitored
      ? [{ id: 'I1', text: 'Observe the pipeline', type: 'non-functional' }]
      : [],
    assumptions: [],
    containers: [
      { id: 'cloud', kind: 'aws-cloud', label: 'AWS' },
      { id: 'region', kind: 'region', parentId: 'cloud', label: 'eu-west-1' },
      ...(azs.length ? [{ id: 'vpc', kind: 'vpc', parentId: 'region', label: 'VPC' }] : []),
      ...azs.map((a) => ({ id: a, kind: 'availability-zone', parentId: 'vpc', label: a })),
    ],
    nodes: [
      node('queue', 'aws.sqs', 'region', ['R1']),
      node('fn', 'aws.lambda', 'region', ['R1']),
      ...azs.map((a) => node(`alb-${a}`, 'aws.alb', a, ['R1'])),
      ...(monitored ? [node('logs', 'aws.cloudwatch', 'region', ['I1'])] : []),
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
      ...azs.map((a) => ({
        id: `ea-${a}`,
        source: `alb-${a}`,
        target: 'fn',
        kind: 'invoke',
        label: 'http',
        requirementIds: ['R1'],
        configuration: [],
      })),
    ],
  };
}

interface Answers {
  draft: unknown;
  /** Arm 0 (no info sentence, more than VR-018 alone). */
  plain?: unknown;
  /** Any first-turn message with info findings (arms 1/2, or S without VR-018). */
  info?: unknown;
  /** S turn 1: VR-018 alone. */
  s1?: unknown;
  /** S turn 2 (a five-message conversation). */
  s2?: unknown;
}

/** Extraction first, the draft second; repairs are routed by content so concurrency cannot reorder them. */
function fake(a: Answers) {
  const requests: LlmRequest[] = [];
  const llm: LlmClient = async (req) => {
    requests.push(req);
    const last = req.messages[req.messages.length - 1]!.content;
    const body: unknown =
      requests.length === 1
        ? extraction
        : requests.length === 2
          ? a.draft
          : req.messages.length === 5
            ? a.s2
            : last.includes('Apply each info finding')
              ? a.info
              : last.includes('VR-018') && !/VR-0(0[0-9]|1[0-79]|2[0-9])/.test(last)
                ? a.s1
                : a.plain;
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
  const record = runEffortBudgetJob(llm, awsCatalog, scenario, 'gpt-luna', 1, (name, p) => {
    saved[name] = p;
  });
  return { record, saved };
};

describe('runEffortBudgetJob', () => {
  it('runs four arms from one draft: one extraction, one draft call', async () => {
    const { llm, requests } = fake({
      draft: graph(false, false, 'one'),
      plain: graph(true, false, 'two'),
      info: graph(true, true, 'two'),
      s1: graph(false, false, 'two'),
      s2: graph(true, true, 'two'),
    });
    const { record, saved } = run(llm);
    const r = await record;

    expect(r.ok).toBe(true);
    expect(Object.keys(r.arms!)).toEqual(['0', '1', '2', 'S']);
    // extraction, draft, arms 0/1/2, S turn 1, S turn 2
    expect(requests).toHaveLength(7);
    const draftText = JSON.stringify(graph(false, false, 'one'));
    for (const q of requests.slice(2))
      expect(q.messages[1]).toEqual({ role: 'assistant', content: draftText });
    expect(r.hasVr018).toBe(true);
    expect(r.eligibleInfo).toBe(1);
    expect(Object.keys(saved).sort()).toEqual(['0', '1', '2', 'S', 'S1', 'draft']);
  });

  it('S sends VR-018 alone first, then the recomputed I set', async () => {
    const { llm } = fake({
      draft: graph(false, false, 'one'),
      plain: graph(true, false, 'two'),
      info: graph(true, true, 'two'),
      s1: graph(false, false, 'two'),
      s2: graph(true, true, 'two'),
    });
    const s = (await run(llm).record).arms!.S;

    expect(s.turns).toBe(2);
    expect(s.request[0]).toContain('VR-018');
    expect(s.request[0]).not.toContain('VR-004');
    expect(s.request[0]).not.toContain('VR-007');
    expect(s.request[1]).toContain('VR-004');
    expect(s.request[1]).toContain('Apply each info finding');
    expect(s.request[1]).not.toContain('VR-018');
    expect(s.infoSent).toBe(1);
    expect(s.vr018Fixed).toBe(true);
    expect(s.unfixed).toBe(0);
  });

  it('S skips turn 2 when turn 1 leaves nothing to send', async () => {
    const { llm, requests } = fake({
      draft: graph(false, false, 'one'),
      plain: graph(true, false, 'two'),
      info: graph(true, true, 'two'),
      s1: graph(true, true, 'two'),
    });
    const { record, saved } = run(llm);
    const s = (await record).arms!.S;

    expect(s.turns).toBe(1);
    expect(s.request).toHaveLength(1);
    expect(requests.some((q) => q.messages.length === 5)).toBe(false);
    expect(saved.S1).toBeUndefined();
  });

  it('S without VR-018 is one turn with the I set', async () => {
    const { llm } = fake({
      draft: graph(false, false, 'none'),
      plain: graph(true, false, 'none'),
      info: graph(true, true, 'none'),
    });
    const r = await run(llm).record;

    expect(r.hasVr018).toBe(false);
    expect(r.arms!.S.turns).toBe(1);
    expect(r.arms!.S.request).toEqual(r.arms!['1'].request);
    expect(r.sameRequestAs!.S).toBe('1');
    expect(r.arms!.S.vr018Fixed).toBeUndefined();
  });

  it('S turn-1 schema failure fails only S', async () => {
    const { llm } = fake({
      draft: graph(false, false, 'one'),
      plain: graph(true, false, 'two'),
      info: graph(true, true, 'two'),
      s1: 'not json',
    });
    const r = await run(llm).record;

    expect(r.ok).toBe(true);
    expect(r.arms!.S.ok).toBe(false);
    expect(r.arms!['0'].ok && r.arms!['1'].ok && r.arms!['2'].ok).toBe(true);
    expect(r.arms!.S.vr018Fixed).toBeUndefined();
  });

  it('no findings to send: no calls, every arm keeps the draft', async () => {
    const { llm, requests } = fake({ draft: graph(true, true, 'two') });
    const r = await run(llm).record;

    expect(requests).toHaveLength(2);
    for (const a of ['0', '1', '2', 'S'] as const) {
      expect(r.arms![a].turns).toBe(0);
      expect(r.arms![a].repaired).toBe(false);
      expect(r.arms![a].request).toEqual([]);
    }
    expect(r.sameRequestAs).toEqual({ '0': '0', '1': '0', '2': '0', S: '0' });
  });

  it('sameRequestAs maps arms 1, 2 and S to 0 when the draft has no eligible info and no VR-018', async () => {
    const { llm } = fake({ draft: graph(false, true, 'two'), plain: graph(true, true, 'two') });
    const r = await run(llm).record;

    expect(r.eligibleInfo).toBe(0);
    expect(r.sameRequestAs).toEqual({ '0': '0', '1': '0', '2': '0', S: '0' });
  });

  it('vr018Fixed is false when the final design still has VR-018', async () => {
    const { llm } = fake({
      draft: graph(false, false, 'one'),
      plain: graph(true, false, 'one'),
      info: graph(true, true, 'two'),
      s1: graph(false, false, 'two'),
      s2: graph(true, true, 'two'),
    });
    const r = await run(llm).record;

    expect(r.arms!['0'].vr018Fixed).toBe(false);
    expect(r.arms!['1'].vr018Fixed).toBe(true);
  });

  it('cost of S includes the draft and both turns', async () => {
    const { llm } = fake({
      draft: graph(false, false, 'one'),
      plain: graph(true, false, 'two'),
      info: graph(true, true, 'two'),
      s1: graph(false, false, 'two'),
      s2: graph(true, true, 'two'),
    });
    const r = await run(llm).record;
    const perCall = r.calls[0]!.costUsd;

    expect(r.arms!['0'].costUsd).toBeCloseTo(perCall * 3, 9);
    expect(r.arms!.S.costUsd).toBeCloseTo(perCall * 4, 9);
    expect(r.costUsd).toBeCloseTo(perCall * 7, 9);
  });

  it('toPairRecord maps arm 0 to W and the chosen arm to I', async () => {
    const { llm } = fake({
      draft: graph(false, false, 'one'),
      plain: graph(true, false, 'two'),
      info: graph(true, true, 'two'),
      s1: graph(false, false, 'two'),
      s2: graph(true, true, 'two'),
    });
    const r = await run(llm).record;
    const pair = toPairRecord(r, 'S');

    expect(pair.arms!.W).toBe(r.arms!['0']);
    expect(pair.arms!.I).toBe(r.arms!.S);
    expect(pair.sameRequest).toBe(false);
    expect(pair.infoSent).toBe(r.arms!.S.infoSent);
    expect(pair.differ).toBe(true);
    expect(pair.firstDraftFindingsByRule).toEqual(r.firstDraftFindingsByRule);
  });

  it('toPairRecord of a failed job carries no arms', () => {
    const pair = toPairRecord(
      {
        scenarioId: 'x',
        model: 'gpt-luna',
        repeat: 1,
        ok: false,
        error: 'boom',
        eligibleInfo: 0,
        hasVr018: false,
        costUsd: 0.01,
        latencyMs: 5,
        calls: [],
      },
      'S',
    );
    expect(pair.ok).toBe(false);
    expect(pair.arms).toBeUndefined();
    expect(pair.sameRequest).toBe(false);
  });
});
