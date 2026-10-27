/**
 * Records one real generation against a running gateway into tools/fixtures/blog-generation.json
 * (`node tools/record-generation.ts [gateway-url]`). The screenshots and the README GIF replay this
 * file, so they only show what the product really produced. Costs real money on the gateway's key
 * (about one cent with Haiku); the committed fixture means it is rarely needed.
 */
import { readFile, writeFile } from 'node:fs/promises';

const GATEWAY = process.argv[2] ?? 'http://localhost:8787';
const OUT = new URL('./fixtures/blog-generation.json', import.meta.url);
const PROMPT =
  'A blog with user signups and a welcome email. Authors upload photos and we need thumbnails.';
/** Same toggle the clarification screenshot switches on. */
const TOGGLES = { backups: true };
/** Placeholders kept in the fixture; screenshots.ts relies on them. */
const OPERATION_ID = '00000000-0000-4000-8000-000000000001';
const OPERATION_TOKEN = 'screenshot-placeholder-token';

interface GatewayReply {
  status: string;
  error?: string;
  operationId: string;
  operationToken: string;
  requirements: unknown[];
  questions: { topic: string; suggestions: string[] }[];
  project: { nodes: unknown[] };
  usage: { costUsd: number };
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as GatewayReply;
  if (!res.ok) throw new Error(`${path} failed: ${res.status} ${json.error ?? ''}`);
  return json;
}

const manifest = JSON.parse(
  await readFile(new URL('../packages/catalog/data/aws/manifest.json', import.meta.url), 'utf8'),
) as { catalogVersion: string };

const questions = await post('/api/ai/generate', {
  prompt: PROMPT,
  toggles: TOGGLES,
  reviewRequirements: false,
  catalogVersion: manifest.catalogVersion,
  model: 'haiku',
});
if (questions.status !== 'questions')
  throw new Error(`expected questions, got ${questions.status}`);

const answers = Object.fromEntries(
  questions.questions.map((q: { topic: string; suggestions: string[] }) => [
    q.topic,
    q.suggestions[0],
  ]),
);
const result = await post('/api/ai/generate/continue', {
  operationId: questions.operationId,
  operationToken: questions.operationToken,
  answers,
  requirements: questions.requirements,
});
if (result.status !== 'done') throw new Error(`expected done, got ${result.status}`);

await writeFile(
  OUT,
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      model: 'haiku',
      prompt: PROMPT,
      toggles: TOGGLES,
      questions: { ...questions, operationId: OPERATION_ID, operationToken: OPERATION_TOKEN },
      answers,
      result,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `recorded: ${questions.questions.length} questions, ${result.project.nodes.length} nodes, cost $${result.usage.costUsd}`,
);
