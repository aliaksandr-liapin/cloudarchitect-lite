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
  expect(onlyIn(dental, photos).length, 'fixture designs must differ').toBeGreaterThan(0);
  expect(onlyIn(photos, dental).length, 'fixture designs must differ').toBeGreaterThan(0);
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
  expect(onlyIn(dental, photos).length, 'fixture designs must differ').toBeGreaterThan(0);
  expect(onlyIn(photos, dental).length, 'fixture designs must differ').toBeGreaterThan(0);
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

test('add a service by hand and see its finding', async () => {
  await page.getByRole('searchbox', { name: 'Search services' }).fill('dax');
  await page.getByRole('button', { name: 'Add DynamoDB Accelerator (DAX)' }).click();
  await expect(canvas(page).getByText('DynamoDB Accelerator (DAX)').first()).toBeVisible({
    timeout: CANVAS_TIMEOUT_MS,
  });
  await expect(page.locator('.findings').getByText('VR-006').first()).toBeVisible();
});

test('linking a requirement clears it', async () => {
  // The new node is selected, so Details shows it.
  const details = page.getByRole('region', { name: 'Details' });
  await details.getByRole('checkbox').first().check();
  await expect(page.locator('.findings').getByText('VR-006')).toHaveCount(0);
});

test('a setting clears its finding, and undo brings it back', async () => {
  await page.getByRole('searchbox', { name: 'Search services' }).fill('dynamodb');
  await page.getByRole('button', { name: 'Add Amazon DynamoDB', exact: true }).click();
  // The new table is selected, so Details shows it; it has no encryption at rest (VR-008).
  const details = page.getByRole('region', { name: 'Details' });
  const add = details.getByRole('button', { name: 'Add DynamoDB encryption at rest' });
  await expect(add).toBeVisible({ timeout: CANVAS_TIMEOUT_MS });
  const vr008 = page.locator('.findings').getByText('VR-008');
  const before = await vr008.count();
  expect(before).toBeGreaterThan(0);

  await add.click();
  await expect(details.getByRole('combobox', { name: 'DynamoDB encryption at rest' })).toHaveValue(
    'KMS',
  );
  await expect(vr008).toHaveCount(before - 1);
  const json = Project.parse(JSON.parse((await download(page, 'JSON project')).toString('utf8')));
  const kmsTables = (p: Project) =>
    p.nodes.filter((n) => n.serviceId === 'aws.dynamodb' && n.configuration?.encryption === 'KMS')
      .length;
  expect(kmsTables(json)).toBe(kmsTables(dental) + 1);

  await page.keyboard.press('ControlOrMeta+z');
  await expect(vr008).toHaveCount(before);
});

// Runs right after a Ctrl+Z: guards the stuck-key bug where Delete stopped working after undo.
test('delete keys delete from the design, and undo brings it back', async () => {
  const first = dental.nodes[0]!;
  const label = first.label;
  await canvas(page).getByText(label, { exact: true }).first().click();
  await page.keyboard.press('Delete');
  await expect(canvas(page).getByText(label, { exact: true })).toHaveCount(0);
  const json = Project.parse(JSON.parse((await download(page, 'JSON project')).toString('utf8')));
  expect(json.nodes.some((n) => n.label === label)).toBe(false);
  expect(json.edges.some((e) => e.source === first.id || e.target === first.id)).toBe(false);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(canvas(page).getByText(label, { exact: true }).first()).toBeVisible({
    timeout: CANVAS_TIMEOUT_MS,
  });
  await expectNodes(page, dental);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(canvas(page).getByText(label, { exact: true })).toHaveCount(0);
});

/** The JSON export, parsed. */
const exportJson = async () =>
  Project.parse(JSON.parse((await download(page, 'JSON project')).toString('utf8')));

/** Centre of an element's bounding box, in page coordinates. */
const centre = async (selector: string) => {
  const box = await canvas(page).locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} is not on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/**
 * Clicks a connector on its own stroke: connectors leaving the same handle share their first
 * segment, so this picks a point along the path where this connector is the topmost element.
 */
async function clickEdge(id: string): Promise<void> {
  const path = canvas(page).locator(
    `.react-flow__edge[data-id="${id}"] path.react-flow__edge-path`,
  );
  const at = await path.evaluate((el, edgeId) => {
    // The e2e tsconfig has no DOM lib; this runs in the browser.
    type Hit = { closest(s: string): { getAttribute(n: string): string | null } | null } | null;
    const p = el as unknown as {
      getTotalLength(): number;
      getPointAtLength(l: number): { x: number; y: number };
      getScreenCTM(): { a: number; b: number; c: number; d: number; e: number; f: number } | null;
      ownerDocument: { elementFromPoint(x: number, y: number): Hit };
    };
    const m = p.getScreenCTM()!;
    const total = p.getTotalLength();
    for (const f of [0.5, 0.6, 0.4, 0.7, 0.3, 0.8, 0.2, 0.9, 0.1]) {
      const q = p.getPointAtLength(total * f);
      const x = q.x * m.a + q.y * m.c + m.e;
      const y = q.x * m.b + q.y * m.d + m.f;
      const hit = p.ownerDocument.elementFromPoint(x, y)?.closest('.react-flow__edge');
      if (hit?.getAttribute('data-id') === edgeId) return { x, y };
    }
    return undefined;
  }, id);
  if (!at) throw new Error(`no clickable point on connector ${id}`);
  await page.mouse.click(at.x, at.y);
}

test('connectors: connect, select, edit, delete and undo', async () => {
  // Two dental components that are still on the canvas and not yet connected that way.
  const gone = dental.nodes[0]!.id;
  const present = dental.nodes.filter((n) => n.id !== gone);
  const pair = present
    .flatMap((a) => present.map((b) => [a, b] as const))
    .find(
      ([a, b]) =>
        a.id !== b.id && !dental.edges.some((e) => e.source === a.id && e.target === b.id),
    );
  expect(pair, 'two dental components to connect').toBeDefined();
  const [from, to] = pair!;

  const start = await centre(`.react-flow__node[data-id="${from.id}"] .react-flow__handle.source`);
  const end = await centre(`.react-flow__node[data-id="${to.id}"] .react-flow__handle.target`);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();

  let json = await exportJson();
  const edge = json.edges.find((e) => e.source === from.id && e.target === to.id);
  expect(edge, 'the dragged connector is in the design').toBeDefined();
  const id = edge!.id;
  const shown = canvas(page).locator(`.react-flow__edge[data-id="${id}"]`);
  await expect(shown).toHaveCount(1);

  // Clicking empty canvas closes Details; clicking the connector opens its view.
  const details = page.getByRole('region', { name: 'Details' });
  await canvas(page)
    .locator('.react-flow__pane')
    .click({ position: { x: 5, y: 5 } });
  await expect(details).toHaveCount(0);
  await clickEdge(id);
  const kind = details.getByRole('combobox', { name: 'Kind' });
  await expect(kind).toBeVisible();
  await expect(details.getByRole('button', { name: 'Delete connector' })).toBeVisible();
  await expect(details.getByText(`${from.label} → ${to.label}`)).toBeVisible();

  await kind.selectOption({ label: 'Invoke' });
  await expect(kind).toHaveValue('invoke');
  json = await exportJson();
  expect(json.edges.find((e) => e.id === id)?.kind).toBe('invoke');
  await expect(kind).toHaveValue('invoke');

  await clickEdge(id);
  await page.keyboard.press('Delete');
  await expect(shown).toHaveCount(0);
  json = await exportJson();
  expect(json.edges.some((e) => e.id === id)).toBe(false);

  await page.keyboard.press('ControlOrMeta+z');
  await expect(shown).toHaveCount(1, { timeout: CANVAS_TIMEOUT_MS });
  json = await exportJson();
  expect(json.edges.find((e) => e.id === id)?.kind).toBe('invoke');
});
