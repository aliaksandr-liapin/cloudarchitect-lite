/**
 * All providers: setup with Anthropic typed in the wizard and OpenAI and Gemini from `.env`,
 * then one generation per provider whose first AI call is answered 429 — the gateway retries
 * and the design still arrives.
 */
import { writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { FAKE_KEYS, startStack, type Stack } from '../src/stack.ts';
import { PROMPTS } from '../src/prompts.ts';
import type { Provider } from '../fake-ai/fixtures.ts';
import {
  expectedDesigns,
  expectNodes,
  fakeLog,
  failNext,
  finishWizard,
  generate,
  resetFake,
  selectModel,
} from './helpers.ts';

test.describe.configure({ mode: 'serial' });

let stack: Stack;
let page: Page;

const MODEL_LABEL: Record<Provider, string> = {
  anthropic: 'Claude Haiku 5.5',
  openai: 'GPT-6.1 Sol',
  google: 'Gemini 4 Argon',
};

/** A key check lists the provider's models; everything else is a generation call. */
const isModelsList = (path: string) => path.endsWith('/models');

test.beforeAll(async ({ browser }, testInfo) => {
  // A local image build on a cold cache takes several minutes.
  testInfo.setTimeout(600_000);
  const images = (process.env.E2E_IMAGES ?? 'local') as 'local' | 'ghcr';
  stack = await startStack({ setup: 'all', images, version: process.env.E2E_VERSION });
  // Once, before anything reaches the fake server; each provider's replay is used once.
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
    typeKeys: { anthropic: FAKE_KEYS.anthropic },
    offered: ['Claude Haiku 5.5', 'Claude Sonnet 5.5', 'GPT-6.1 Sol', 'Gemini 4 Argon'],
    enable: ['Claude Haiku 5.5', 'GPT-6.1 Sol', 'Gemini 4 Argon'],
  });
});

for (const provider of ['anthropic', 'openai', 'google'] as const) {
  test(`${provider} after a 429`, async () => {
    const [expected] = await expectedDesigns(provider);
    const before = (await fakeLog(stack.control)).length;
    await failNext(stack.control, provider, 429);

    await selectModel(page, MODEL_LABEL[provider]);
    await generate(page, PROMPTS[provider][0]);
    await expect(page.getByRole('banner').getByText(expected!.name, { exact: true })).toBeVisible();
    await expectNodes(page, expected!);
    // The generation error (App.tsx `.alert`); the icon and storage notices are alerts too.
    await expect(page.getByRole('alert').and(page.locator('.alert'))).toHaveCount(0);

    const calls = (await fakeLog(stack.control)).slice(before).filter((c) => !isModelsList(c.path));
    await test.info().attach('fake-ai-log.json', {
      body: JSON.stringify(calls, null, 2),
      contentType: 'application/json',
    });
    expect(calls.every((c) => c.provider === provider)).toBe(true);
    expect(calls.map((c) => c.status).slice(0, 2)).toEqual([429, 200]);
    expect(calls.slice(1).every((c) => c.status === 200)).toBe(true);
  });
}
