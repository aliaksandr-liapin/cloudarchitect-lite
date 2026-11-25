/**
 * Screenshots for the user manual (docs/manual/). Not a test of behaviour: it walks the product
 * the way the manual describes it and saves one PNG per screen into docs/manual/images/.
 * Run with `pnpm --filter @cloudarchitect/e2e manual` (Docker stack + fake AI, like the e2e test).
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { awsCatalog } from '@cloudarchitect/catalog';
import type { Project } from '@cloudarchitect/domain';
import { FAKE_KEYS, ROOT, startStack, type Stack } from '../src/stack.ts';
import { PROMPTS } from '../src/prompts.ts';
import {
  canvas,
  clickEdge,
  closeWindows,
  enterKey,
  expectedDesigns,
  expectNodes,
  GENERATION_TIMEOUT_MS,
  openWindow,
} from './helpers.ts';

test.describe.configure({ mode: 'serial' });

const OUT = join(ROOT, 'docs/manual/images');
const VIEWPORT = { width: 1440, height: 900 };

let stack: Stack;
let page: Page;
let design: Project;

/** Fits the diagram to the canvas as it is now (the column may have changed width since load). */
async function fit(): Promise<void> {
  await page.getByRole('button', { name: 'Fit View' }).click();
  await page.waitForTimeout(500);
}
/** The whole window. */
const shot = (name: string) => page.screenshot({ path: join(OUT, `${name}.png`) });
/** One element, with a margin of `pad` px around it. */
async function shotOf(name: string, el: Locator, pad = 12): Promise<void> {
  const box = (await el.boundingBox())!;
  await page.screenshot({
    path: join(OUT, `${name}.png`),
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: Math.min(VIEWPORT.width, box.width + 2 * pad),
      height: Math.min(VIEWPORT.height, box.height + 2 * pad),
    },
  });
}

test.beforeAll(async ({ browser }, testInfo) => {
  testInfo.setTimeout(600_000);
  await mkdir(OUT, { recursive: true });
  [design] = (await expectedDesigns('anthropic')) as [Project];
  const images = (process.env.E2E_IMAGES ?? 'local') as 'local' | 'ghcr';
  stack = await startStack({ setup: 'claude', images, version: process.env.E2E_VERSION });
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'light' });
  page = await context.newPage();
});

// eslint-disable-next-line no-empty-pattern
test.afterAll(async ({}) => {
  await page?.context().close();
  await stack?.stop();
});

test('setup wizard', async () => {
  const next = page.getByRole('button', { name: 'Next', exact: true });
  await page.goto(stack.setupUrl);
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await shot('setup-1-welcome');
  await next.click();
  await expect(page.getByRole('heading', { name: 'AI providers' })).toBeVisible();
  await enterKey(page, 'anthropic', FAKE_KEYS.anthropic);
  await shot('setup-2-keys');
  await next.click();
  await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
  await shot('setup-3-models');
  await next.click();
  await expect(page.getByRole('heading', { name: 'Limits' })).toBeVisible();
  await shot('setup-4-limits');
  await next.click();
  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
  await shot('setup-5-review');
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await page.getByRole('link', { name: 'Open the editor' }).click();
  await expect(page.getByPlaceholder('Describe your application')).toBeVisible();
  await page.waitForTimeout(1000); // icons and the first layout settle
  await fit();
  await shot('editor-first-start');
});

test('generate', async () => {
  await page.getByPlaceholder('Describe your application').fill(PROMPTS.anthropic[0]!);
  await page.getByRole('button', { name: 'Serverless-first' }).click();
  await shotOf('generate-form', page.locator('.side .generate'));
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const questions = page.getByRole('region', { name: 'Clarify before drawing' });
  const done = page.getByRole('status').filter({ hasText: 'New diagram generated' });
  await expect(questions.or(done)).toBeVisible({ timeout: GENERATION_TIMEOUT_MS });
  if (await questions.isVisible()) {
    await shot('generate-questions');
    await questions.getByRole('button', { name: 'Continue' }).click();
  }
  await expect(done).toBeVisible({ timeout: GENERATION_TIMEOUT_MS });
  await expectNodes(page, design);
  await done.getByRole('button', { name: 'Dismiss' }).click();
  await fit();
  await shot('editor-design');
});

test('findings', async () => {
  // An unconnected queue added by hand gets a marker (VR-026, and VR-013 with no requirement).
  await canvas(page)
    .locator('.react-flow__pane')
    .click({ position: { x: 5, y: 5 } });
  await openWindow(page, 'Add');
  await page.getByRole('searchbox', { name: 'Search services' }).fill('sqs');
  await page.getByRole('button', { name: 'Add Amazon SQS', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search services' }).fill('');
  await closeWindows(page);
  const marked = canvas(page).locator('.react-flow__node:has(.mark-warning)').first();
  await expect(marked).toBeVisible();
  // Zoom in on it (the wheel zooms around the pointer), take the close-up, then fit again.
  const box = (await marked.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(400);
  await shotOf('finding-marker', marked, 24);
  await fit();
  await openWindow(page, 'Findings');
  await fit();
  await shot('findings-window');
  await shotOf('findings-list', page.getByRole('region', { name: 'Findings', exact: true }), 4);
  await closeWindows(page);
});

test('edit by hand', async () => {
  await openWindow(page, 'Add');
  await page.getByRole('searchbox', { name: 'Search services' }).fill('queue');
  await shotOf('add-window', page.getByRole('region', { name: 'Add', exact: true }), 4);
  await page.getByRole('searchbox', { name: 'Search services' }).fill('');
  await closeWindows(page);

  // A component with settings, selected: Details shows its settings.
  const withSettings = new Set(
    awsCatalog.features.filter((f) => f.appliesTo === 'node').map((f) => f.serviceId),
  );
  const node = design.nodes.find((n) => n.serviceId && withSettings.has(n.serviceId))!;
  await canvas(page).getByText(node.label, { exact: true }).first().click();
  const details = page.getByRole('region', { name: 'Details' });
  await expect(details).toBeVisible();
  await shotOf('details-component', details, 8);
  const settings = details.locator('.settings');
  await settings.scrollIntoViewIfNeeded();
  await shotOf('details-settings', settings, 10);

  // A connector with settings.
  const edgeServices = new Set(
    awsCatalog.features.filter((f) => f.appliesTo === 'edge').map((f) => f.serviceId),
  );
  const serviceOf = (id: string) => design.nodes.find((n) => n.id === id)?.serviceId ?? '';
  // Prefer the connectors whose settings mean the most: CDN → bucket, then queue → function.
  const pairs = [
    ['aws.cloudfront', 'aws.s3'],
    ['aws.sqs', 'aws.lambda'],
  ];
  const edge =
    pairs
      .map(([from, to]) =>
        design.edges.find((e) => serviceOf(e.source) === from && serviceOf(e.target) === to),
      )
      .find(Boolean) ??
    design.edges.find(
      (e) => edgeServices.has(serviceOf(e.source)) || edgeServices.has(serviceOf(e.target)),
    );
  if (edge) {
    await clickEdge(page, edge.id);
    await expect(details.getByText('Connection')).toBeVisible();
    await shotOf('details-connector', details, 8);
  }
  await canvas(page)
    .locator('.react-flow__pane')
    .click({ position: { x: 5, y: 5 } });
});

test('versions, model, export, panel and theme', async () => {
  await openWindow(page, 'Versions');
  await shotOf('versions-window', page.getByRole('region', { name: 'Versions', exact: true }), 4);
  await closeWindows(page);
  await openWindow(page, 'AI model');
  await shotOf('model-window', page.getByRole('region', { name: 'AI model', exact: true }), 4);
  await closeWindows(page);

  await page.getByText('Export', { exact: true }).click();
  await shotOf('export-menu', page.locator('.menu'), 60);
  await page.keyboard.press('Escape');

  await shotOf('toolbar', page.getByRole('banner'), 0);

  await page.getByRole('button', { name: 'Side panel' }).click();
  await fit();
  await shot('editor-canvas-only');
  await page.getByRole('button', { name: 'Side panel' }).click();

  await page.getByRole('button', { name: 'Dark mode' }).click();
  await fit();
  await shot('editor-dark');
  await page.getByRole('button', { name: 'Dark mode' }).click();
});
