/**
 * Claude-only journey: setup with a typed Anthropic key (rejected first), two generations,
 * exports, versions, import and reload — one browser page, tests in order.
 */
import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { awsCatalog, samples } from '@cloudarchitect/catalog';
import { Project, validateProject } from '@cloudarchitect/domain';
import { FAKE_KEYS, REJECTED_KEY, startStack, type Stack } from '../src/stack.ts';
import { PROMPTS } from '../src/prompts.ts';
import {
  canvas,
  download,
  expectedDesigns,
  CANVAS_TIMEOUT_MS,
  expectNodes,
  finishWizard,
  generate,
  keyField,
  onlyIn,
  rejectKey,
  resetFake,
} from './helpers.ts';

test.describe.configure({ mode: 'serial' });

let stack: Stack;
let page: Page;
/** What the fixtures produce for PROMPTS.anthropic[0] and [1]. */
let dental: Project;
let photos: Project;
/** The JSON export of the first design. */
let exported: Buffer;

const versionsHeading = (n: number) => page.getByText(`Versions (${n})`, { exact: true });

test.beforeAll(async ({ browser }, testInfo) => {
  // A local image build on a cold cache takes several minutes.
  testInfo.setTimeout(600_000);
  [dental, photos] = (await expectedDesigns('anthropic')) as [Project, Project];
  const images = (process.env.E2E_IMAGES ?? 'local') as 'local' | 'ghcr';
  stack = await startStack({ setup: 'claude', images, version: process.env.E2E_VERSION });
  // Once, not per test: the Anthropic replay is ordered (design 1, then design 2) and the two
  // generations are in different tests.
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

test('rejected key', async () => {
  await rejectKey(stack.control, REJECTED_KEY);
  await page.goto(stack.setupUrl);
  const next = page.getByRole('button', { name: 'Next', exact: true });
  await next.click();
  await expect(page.getByRole('heading', { name: 'AI providers' })).toBeVisible();

  await keyField(page, 'anthropic').fill(REJECTED_KEY);
  const check = page.getByRole('button', { name: 'Check key' }).first();
  await check.click();
  await expect(page.getByText('Key rejected')).toBeVisible();
  await expect(next).toBeDisabled();

  await keyField(page, 'anthropic').fill(FAKE_KEYS.anthropic);
  await check.click();
  await expect(page.getByText('✓ Key works')).toBeVisible();
  await expect(next).toBeEnabled();
});

test('setup', async () => {
  // Start over from the setup link; the key typed above was never saved.
  await page.goto(stack.setupUrl);
  await finishWizard(page, { typeKeys: { anthropic: FAKE_KEYS.anthropic } });
  await expect(
    page.getByRole('banner').getByText(samples.myblog.name, { exact: true }),
  ).toBeVisible();
  await expectNodes(page, samples.myblog as Project);
});

test('generate', async () => {
  await generate(page, PROMPTS.anthropic[0]);
  await expect(page.getByRole('banner').getByText(dental.name, { exact: true })).toBeVisible();
  await expectNodes(page, dental);
  // The example diagram was kept.
  await expect(versionsHeading(1)).toBeVisible();
});

test('export', async () => {
  const png = await download(page, 'PNG image');
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(png.length).toBeGreaterThan(10_000);

  const svg = await download(page, 'SVG image');
  expect(svg.toString('utf8')).toContain('<svg');

  exported = await download(page, 'JSON project');
  const project = Project.parse(JSON.parse(exported.toString('utf8')));
  expect(project.nodes.map((n) => n.label).sort()).toEqual(dental.nodes.map((n) => n.label).sort());
  const findings = validateProject(project, awsCatalog);
  await expect(
    page.getByRole('heading', { name: `Findings (${findings.length})`, exact: true }),
  ).toBeVisible();
});

test('versions', async () => {
  await generate(page, PROMPTS.anthropic[1]);
  await expect(page.getByRole('banner').getByText(photos.name, { exact: true })).toBeVisible();
  await expectNodes(page, photos);
  for (const label of onlyIn(dental, photos)) {
    await expect(canvas(page).getByText(label, { exact: true })).toHaveCount(0, {
      timeout: CANVAS_TIMEOUT_MS,
    });
  }
  await expect(versionsHeading(2)).toBeVisible();

  // Newest first: the first design.
  await page.getByRole('button', { name: 'Restore', exact: true }).first().click();
  await expectNodes(page, dental);
  for (const label of onlyIn(photos, dental)) {
    await expect(canvas(page).getByText(label, { exact: true })).toHaveCount(0, {
      timeout: CANVAS_TIMEOUT_MS,
    });
  }
  // The second design was kept when the first came back.
  await expect(versionsHeading(3)).toBeVisible();
});

test('import', async () => {
  // Bring the second design back first, so the import visibly replaces it.
  await page.getByRole('button', { name: 'Restore', exact: true }).first().click();
  await expectNodes(page, photos);
  await expect(versionsHeading(4)).toBeVisible();

  // The hidden file input behind "Import JSON" has no accessible name.
  await page.locator('input[type="file"]').setInputFiles({
    name: 'export.json',
    mimeType: 'application/json',
    buffer: exported,
  });
  await expect(page.getByRole('banner').getByText(dental.name, { exact: true })).toBeVisible();
  await expectNodes(page, dental);
  for (const label of onlyIn(photos, dental)) {
    await expect(canvas(page).getByText(label, { exact: true })).toHaveCount(0, {
      timeout: CANVAS_TIMEOUT_MS,
    });
  }
});

test('reload', async () => {
  await page.reload();
  await expect(page.getByRole('banner').getByText(dental.name, { exact: true })).toBeVisible();
  await expectNodes(page, dental);
  await expect(versionsHeading(4)).toBeVisible();
});
