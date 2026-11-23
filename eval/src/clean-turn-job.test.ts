import { awsCatalog } from '@cloudarchitect/catalog';
import type { Project } from '@cloudarchitect/domain';
import type { LlmClient, LlmRequest } from '@cloudarchitect/generator';
import { describe, expect, it } from 'vitest';
import { runCleanTurnJob } from './clean-turn-job.js';
import { toPairRecord } from './effort-budget-job.js';
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
  /** Arm 0 and its replica R (plain message, more than VR-018 alone). */
  plain?: unknown;
  /** S turn 1: VR-018 alone. */
  s1?: unknown;
  /** S in one turn (draft without VR-018): arm I's set on the draft. */
  sOne?: unknown;
  /** K turn 2 (info findings only), continued and fresh. */
  kc?: unknown;
  kf?: unknown;
  /** S turn 2 (arm I's set on S1), continued and fresh. */
  sc?: unknown;
  sf?: unknown;
}

/** Routed by content and conversation shape, so concurrency cannot reorder answers. */
function fake(a: Answers) {
  const requests: LlmRequest[] = [];
  const draftText = JSON.stringify(a.draft);
  const llm: LlmClient = async (req) => {
    requests.push(req);
    const msgs = req.messages;
    const last = msgs[msgs.length - 1]!.content;
    const info = last.includes('Apply each info finding');
    const turn2 = msgs.length === 5 || (msgs.length === 3 && msgs[1]!.content !== draftText);
    const fresh = msgs.length === 3;
    const body: unknown =
      requests.length === 1
        ? extraction
        : requests.length === 2
          ? a.draft
          : turn2
            ? last.includes('VR-004')
              ? fresh
                ? a.sf
                : a.sc
              : fresh
                ? a.kf
                : a.kc
            : info
              ? last.includes('VR-004')
                ? a.sOne
                : a.kc
              : last.includes('VR-018') && !last.includes('VR-004')
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
  const record = runCleanTurnJob(llm, awsCatalog, scenario, 'gpt-luna', 1, (name, p) => {
    saved[name] = p;
  });
  return { record, saved };
};

/** Draft: no DLQ (VR-004), no monitoring (VR-007), ALB in one zone (VR-018). */
const full: Answers = {
  draft: graph(false, false, 'one'),
  plain: graph(true, false, 'two'),
  s1: graph(false, false, 'two'),
  kc: graph(true, true, 'two'),
  kf: graph(true, true, 'two'),
  sc: graph(true, true, 'two'),
  sf: graph(false, true, 'two'),
};

describe('runCleanTurnJob', () => {
  it('shares turn 1 and splits turn 2 into continued and fresh', async () => {
    const { llm, requests } = fake(full);
    const { record, saved } = run(llm);
    const r = await record;

    expect(r.ok).toBe(true);
    expect(Object.keys(r.arms!)).toEqual(['0', 'R', 'KC', 'KF', 'SC', 'SF']);
    // extraction, draft, arm 0, replica R, S turn 1, then KC, KF, SC, SF
    expect(requests).toHaveLength(9);
    expect(r.kSplit).toBe(true);
    expect(r.sSplit).toBe(true);
    expect(r.arms!.KC.turns).toBe(2);
    expect(r.arms!.KF.turns).toBe(2);
    expect(r.arms!.KC.request).toEqual(r.arms!.KF.request);
    expect(r.arms!.KC.request[0]).toBe(r.arms!['0'].request[0]);
    expect(r.arms!.SC.request).toEqual(r.arms!.SF.request);
    expect(Object.keys(saved).sort()).toEqual(['0', 'KC', 'KF', 'R', 'S1', 'SC', 'SF', 'draft']);
  });

  it("a fresh turn 2 carries the request, turn 1's design and the message only", async () => {
    const { llm, requests } = fake(full);
    await run(llm).record;
    const draftText = JSON.stringify(full.draft);
    const fresh = requests.filter(
      (q) => q.messages.length === 3 && q.messages[1]!.content !== draftText,
    );
    const continued = requests.filter((q) => q.messages.length === 5);

    expect(fresh).toHaveLength(2);
    expect(continued).toHaveLength(2);
    for (const q of fresh) expect(q.messages[0]).toEqual(requests[1]!.messages[0]);
    const kFresh = fresh.find((q) => !q.messages[2]!.content.includes('VR-004'))!;
    expect(kFresh.messages[1]!.content).toBe(JSON.stringify(full.plain));
    const sFresh = fresh.find((q) => q.messages[2]!.content.includes('VR-004'))!;
    expect(sFresh.messages[1]!.content).toBe(JSON.stringify(full.s1));
    // The continued turn 2 has the same last message as its fresh twin.
    for (const q of fresh)
      expect(continued.some((c) => c.messages[4]!.content === q.messages[2]!.content)).toBe(true);
  });

  it('K turn 2 sends the repairable info findings only', async () => {
    const r = await run(fake(full).llm).record;
    const k2 = r.arms!.KC.request[1]!;

    expect(k2).toContain('VR-007');
    expect(k2).not.toContain('VR-004');
    expect(k2).not.toContain('VR-018');
    expect(r.arms!.KC.infoSent).toBe(1);
  });

  it('skips turn 2 when turn 1 leaves nothing to send', async () => {
    const { llm, requests } = fake({ ...full, plain: graph(true, true, 'two') });
    const r = await run(llm).record;

    expect(r.kSplit).toBe(false);
    expect(r.arms!.KC.turns).toBe(1);
    expect(r.arms!.KF.finalHash).toBe(r.arms!['0'].finalHash);
    expect(requests).toHaveLength(7);
  });

  it('no errors or warnings: K turn 2 is the first repair and runs once', async () => {
    const { llm, requests } = fake({
      draft: graph(true, false, 'two'),
      kc: graph(true, true, 'two'),
      sOne: graph(true, true, 'two'),
    });
    const r = await run(llm).record;

    expect(r.arms!['0'].turns).toBe(0);
    expect(r.arms!.R.turns).toBe(0);
    expect(r.kSplit).toBe(false);
    expect(r.arms!.KC.turns).toBe(1);
    expect(r.arms!.KF.finalHash).toBe(r.arms!.KC.finalHash);
    // No call for arm 0 means R repeats nothing: it must not feed the noise floor.
    expect(r.sameRequestAs!.R).toBe('R');
    expect(toPairRecord(r, 'R').sameRequest).toBe(false);
    // extraction, draft, K's single info turn, S's single turn
    expect(requests).toHaveLength(4);
  });

  it("S without VR-018 is one shared turn with arm I's set", async () => {
    const { llm } = fake({
      draft: graph(false, false, 'none'),
      plain: graph(true, false, 'none'),
      sOne: graph(true, true, 'none'),
      kc: graph(true, true, 'none'),
      kf: graph(true, true, 'none'),
    });
    const r = await run(llm).record;

    expect(r.hasVr018).toBe(false);
    expect(r.sSplit).toBe(false);
    expect(r.arms!.SC.turns).toBe(1);
    expect(r.arms!.SF.request).toEqual(r.arms!.SC.request);
    expect(r.arms!.SC.request[0]).toContain('Apply each info finding');
    expect(r.arms!.SC.vr018Fixed).toBeUndefined();
  });

  it('a failed fresh turn fails only the fresh arm', async () => {
    const r = await run(fake({ ...full, sf: 'not json' }).llm).record;

    expect(r.ok).toBe(true);
    expect(r.arms!.SF.ok).toBe(false);
    expect(r.arms!.SF.turns).toBe(2);
    expect(r.arms!.SC.ok).toBe(true);
    expect(r.arms!.KF.ok).toBe(true);
  });

  it('a failed shared turn 1 fails both arms of its branch, nothing else', async () => {
    const r = await run(fake({ ...full, s1: 'not json' }).llm).record;

    expect(r.arms!.SC.ok).toBe(false);
    expect(r.arms!.SF.ok).toBe(false);
    expect(r.arms!.SC.turns).toBe(1);
    expect(r.arms!.KC.ok && r.arms!.KF.ok && r.arms!['0'].ok).toBe(true);
  });

  it("R is an independent call of arm 0's request and pairs as noise", async () => {
    const r = await run(fake(full).llm).record;

    expect(r.arms!.R.request).toEqual(r.arms!['0'].request);
    expect(r.sameRequestAs).toEqual({ '0': '0', R: '0', KC: 'KC', KF: 'KF', SC: 'SC', SF: 'SF' });
    expect(toPairRecord(r, 'R').sameRequest).toBe(true);
    expect(toPairRecord(r, 'KF').sameRequest).toBe(false);
  });

  it("each arm's cost covers the draft and every turn on its path", async () => {
    const r = await run(fake(full).llm).record;
    const perCall = r.calls[0]!.costUsd;

    expect(r.arms!['0'].costUsd).toBeCloseTo(perCall * 3, 9);
    expect(r.arms!.KF.costUsd).toBeCloseTo(perCall * 4, 9);
    expect(r.arms!.SF.costUsd).toBeCloseTo(perCall * 4, 9);
    expect(r.costUsd).toBeCloseTo(perCall * 9, 9);
  });
});
