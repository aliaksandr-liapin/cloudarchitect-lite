/**
 * Regenerates the screenshots in docs/images (`pnpm screenshots`). Serves the built web app with
 * `vite preview` and drives the locally installed Google Chrome. Every /api call is answered with a
 * fixed response, so no gateway, API key or network access is needed and the images are repeatable.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright-core';

const PORT = 4179;
const BASE = `http://localhost:${PORT}`;
const OUT = new URL('../docs/images/', import.meta.url).pathname;
/** Same placeholder as docs/operations/installation.md; not a real setup code. */
const SETUP_CODE = '1a2b3c4d5e6f';
/** Typed into a password field, so only dots appear in the image. Never a real key. */
const FAKE_KEY = 'sk-ant-api03-placeholder-for-screenshots-0000000000';

const WIZARD_DEFAULTS = {
  models: ['haiku'],
  defaultModel: 'haiku',
  freeCredits: 3,
  dailyBudgetUsd: 5,
  monthlyBudgetUsd: 50,
  rateLimitPerMinute: 20,
};

function mockApi(context: BrowserContext, configured: boolean) {
  const responses: Record<string, unknown> = {
    '/api/setup/status': configured
      ? { available: true, configured: true }
      : {
          available: true,
          configured: false,
          keyFromEnvironment: false,
          lockedByEnvironment: [],
          current: WIZARD_DEFAULTS,
        },
    '/api/setup/verify-key': { result: 'valid' },
    '/api/setup/complete': { ok: true },
    '/api/models': { defaultModel: 'haiku', enabled: ['haiku', 'sonnet'], options: [] },
  };
  return context.route('**/api/**', (route) => {
    const body = responses[new URL(route.request().url()).pathname];
    return body
      ? route.fulfill({ json: body })
      : route.fulfill({ status: 404, json: { error: 'not_found' } });
  });
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400); // let transitions and fitView settle
  await page.screenshot({ path: `${OUT}${name}.png` });
  console.log(`docs/images/${name}.png`);
}

/**
 * The bundled sample has no findings, so the editor shot imports a copy without the thumbnail
 * function's failure queue: a realistic mistake that shows a rule finding and its remediation.
 */
async function sampleWithFinding() {
  const sample = JSON.parse(
    await readFile(
      new URL('../packages/catalog/samples/myblog.project.json', import.meta.url),
      'utf8',
    ),
  );
  sample.nodes = sample.nodes.filter((n: { id: string }) => n.id !== 'dlq');
  sample.edges = sample.edges
    .filter((e: { target: string }) => e.target !== 'dlq')
    .map((e: { id: string; configuration?: Record<string, unknown> }) =>
      e.id === 'e9' ? { ...e, configuration: { eventNotification: 'ObjectCreated' } } : e,
    );
  const file = join(tmpdir(), 'myblog-with-finding.project.json');
  await writeFile(file, JSON.stringify(sample));
  return file;
}

async function editor(context: BrowserContext, name: string, projectFile: string) {
  await mockApi(context, true);
  const page = await context.newPage();
  await page.goto(BASE);
  await page.locator('.react-flow__node').first().waitFor();
  await page.locator('input[type=file]').setInputFiles(projectFile);
  await page.getByRole('heading', { name: /Findings \([1-9]/ }).waitFor();
  await page.locator('.findings button').first().click();
  await page.getByRole('heading', { name: 'Details' }).waitFor();
  await shot(page, name);
}

async function wizard(context: BrowserContext) {
  await mockApi(context, false);
  const page = await context.newPage();
  const next = () => page.getByRole('button', { name: 'Next' }).click();
  await page.goto(`${BASE}/setup?code=${SETUP_CODE}`);
  await page.getByRole('heading', { name: 'Welcome' }).waitFor();
  await shot(page, 'setup-1-welcome');
  await next();
  await page.getByLabel('API key').fill(FAKE_KEY);
  await page.getByRole('button', { name: 'Check key' }).click();
  await page.getByText('✓ Key works').waitFor();
  await shot(page, 'setup-2-key');
  await next();
  await page.getByRole('heading', { name: 'Models' }).waitFor();
  await shot(page, 'setup-3-models');
  await next();
  await page.getByRole('heading', { name: 'Limits' }).waitFor();
  await shot(page, 'setup-4-limits');
  await next();
  await page.getByRole('heading', { name: 'Review' }).waitFor();
  await shot(page, 'setup-5-review');
}

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`vite preview did not start on ${BASE}`);
}

const server = spawn(
  'pnpm',
  [
    '--filter',
    '@cloudarchitect/web',
    'exec',
    'vite',
    'preview',
    '--port',
    String(PORT),
    '--strictPort',
  ],
  { stdio: 'ignore' },
);
try {
  await waitForServer();
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const viewport = { width: 1440, height: 900 };
  try {
    const projectFile = await sampleWithFinding();
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme });
      await editor(context, `editor-${colorScheme}`, projectFile);
      await context.close();
    }
    const context = await browser.newContext({
      viewport: { width: 1100, height: 700 },
      deviceScaleFactor: 2,
      colorScheme: 'light',
    });
    await wizard(context);
    await context.close();
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
