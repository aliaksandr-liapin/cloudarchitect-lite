/**
 * Gemini-only journey: the key comes from `.env` and the daily budget is $0.02 — above the
 * Flash-Lite extraction, below one Gemini 4 Argon generation (src/stack.ts). One generation,
 * a JSON export and a reload; then the spent budget stops the next generation while manual
 * editing (dragging a node) still works.
 */
import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { awsCatalog } from '@cloudarchitect/catalog';
import { Project, validateProject } from '@cloudarchitect/domain';
import { startStack, type Stack } from '../src/stack.ts';
import { PROMPTS } from '../src/prompts.ts';
import {
  canvas,
  download,
  expectedDesigns,
  expectNodes,
  fakeLog,
  finishWizard,
  generate,
  resetFake,
} from './helpers.ts';

test.describe.configure({ mode: 'serial' });

let stack: Stack;
let page: Page;
/** What the fixtures produce for PROMPTS.google[0]. */
let dental: Project;

const BUDGET_ERROR =
  'AI generation is paused: the daily or monthly spending limit is reached. Manual editing still works.';

/** A key check lists the provider's models; everything else is a generation call. */
const generationCalls = async () =>
  (await fakeLog(stack.control)).filter((c) => !c.path.endsWith('/models'));

test.beforeAll(async ({ browser }, testInfo) => {
  // A local image build on a cold cache takes several minutes.
  testInfo.setTimeout(600_000);
  [dental] = (await expectedDesigns('google')) as [Project];
  const images = (process.env.E2E_IMAGES ?? 'local') as 'local' | 'ghcr';
  stack = await startStack({ setup: 'gemini', images, version: process.env.E2E_VERSION });
  // Once, before anything reaches the fake server; the Gemini replay is used once.
  await resetFake(stack.control);
  page = await (await browser.newContext()).newPage();
});

// Playwright requires the fixtures argument to be a destructuring pattern.
// eslint-disable-next-line no-empty-pattern
test.afterAll(async ({}, testInfo) => {
  await page?.context().close();
  if (!stack) return;
  try {
    await writeFile(testInfo.outputPath('compose.log'), await stack.logs());
  } finally {
    await stack.stop();
  }
});

test('setup', async () => {
  await page.goto(stack.setupUrl);
  await finishWizard(page, {
    envKeys: ['google'],
    offered: ['Gemini 4 Argon'],
    preselected: ['Gemini 4 Argon'],
  });
});

test('generate', async () => {
  await generate(page, PROMPTS.google[0]);
  await expect(page.getByRole('banner').getByText(dental.name, { exact: true })).toBeVisible();
  await expectNodes(page, dental);
});

test('export JSON', async () => {
  const exported = await download(page, 'JSON project');
  const project = Project.parse(JSON.parse(exported.toString('utf8')));
  expect(project.nodes.map((n) => n.label).sort()).toEqual(dental.nodes.map((n) => n.label).sort());
  const findings = validateProject(project, awsCatalog);
  await expect(
    page.getByRole('heading', { name: `Findings (${findings.length})`, exact: true }),
  ).toBeVisible();
});

test('reload', async () => {
  await page.reload();
  await expect(page.getByRole('banner').getByText(dental.name, { exact: true })).toBeVisible();
  await expectNodes(page, dental);
});

test('budget', async () => {
  const calls = (await generationCalls()).length;
  await page.getByPlaceholder('Describe your application').fill(PROMPTS.google[0]);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: BUDGET_ERROR })).toBeVisible();
  // Refused by the gateway: nothing reached the provider.
  expect(await generationCalls()).toHaveLength(calls);
  // The design is unchanged.
  await expectNodes(page, dental);

  // Manual editing: drag a node that sits in no container, so the move is not clamped.
  const free = dental.nodes.find((n) => !n.containerId);
  expect(free, 'fixture has no node outside a container; pick another drag target').toBeDefined();
  const node = canvas(page).getByText(free!.label, { exact: true });
  // Measured against another node: a drag on the canvas pans the viewport and moves every node,
  // so only a change in the distance between the two shows that the node itself was moved.
  const other = canvas(page).getByText(dental.nodes.find((n) => n.label !== free!.label)!.label, {
    exact: true,
  });
  const offset = async () => {
    const [a, b] = [(await node.boundingBox())!, (await other.boundingBox())!];
    return { x: a.x - b.x, y: a.y - b.y };
  };
  const moved = (from: { x: number; y: number }) => async () => {
    const to = await offset();
    return Math.hypot(to.x - from.x, to.y - from.y);
  };
  const before = await offset();
  const box = (await node.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 80, { steps: 10 });
  await page.mouse.up();
  await expect.poll(moved(before)).toBeGreaterThan(50);

  // The drop is saved: after a reload the node is still away from where it was.
  await page.reload();
  await expectNodes(page, dental);
  await expect.poll(moved(before)).toBeGreaterThan(20);
});
