/**
 * Browser steps shared by the journey specs (claude, gemini, all): the setup wizard, one
 * generation, file downloads, and the designs the recorded fixtures are expected to produce.
 */
import { readFile } from 'node:fs/promises';
import { expect, type Locator, type Page } from '@playwright/test';
import { PROVIDER_LABEL, type Project } from '@cloudarchitect/domain';
import { anthropicClient, googleClient, openaiClient } from '@cloudarchitect/generator';
import type { LlmClient } from '@cloudarchitect/generator';
import { loadFixtures, type Provider } from '../fake-ai/fixtures.ts';
import { startFakeAi } from '../fake-ai/server.ts';
import { design, PROMPTS } from '../src/prompts.ts';

/**
 * A generation (extraction, questions, design, repair) through the fake server takes seconds;
 * the margin covers a slow CI machine. Below the per-test timeout in playwright.config.ts.
 */
const GENERATION_TIMEOUT_MS = 90_000;

/**
 * Canvas nodes after a generate, import, restore or reload: React Flow hides nodes until it
 * re-measures them, while the route recovery runs ELK on the main thread — slow under CPU load.
 */
export const CANVAS_TIMEOUT_MS = 30_000;

/** Rewinds the fake AI server: replay cursors, injected faults, rejected keys and the call log. */
export async function resetFake(control: string): Promise<void> {
  const res = await fetch(`${control}/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`fake-ai /reset answered ${res.status}`);
}

/** Makes the fake server answer the key check for `key` with the provider's "invalid key" error. */
export async function rejectKey(control: string, key: string): Promise<void> {
  const res = await fetch(`${control}/reject-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) throw new Error(`fake-ai /reject-key answered ${res.status}`);
}

export const keyField = (page: Page, p: Provider): Locator =>
  page.getByLabel(`${PROVIDER_LABEL[p]} API key`);

/** Types a key on the AI providers step and checks it; the check must pass. */
export async function enterKey(page: Page, p: Provider, key: string): Promise<void> {
  await keyField(page, p).fill(key);
  // One "Check key" button per provider card, in provider order, next to its key field.
  const card = page.getByRole('heading', { name: PROVIDER_LABEL[p], exact: true }).locator('..');
  await card.getByRole('button', { name: 'Check key' }).click();
  await expect(card.getByText('✓ Key works')).toBeVisible();
}

/**
 * Walks the wizard from the page it is on (Welcome, opened with the setup link) to the editor:
 * AI providers (typing and checking `typeKeys`), Models (checking that exactly `offered` are
 * listed, then ticking `enable`), Limits, Review,
 * Finish setup, Open the editor.
 */
export async function finishWizard(
  page: Page,
  opts: {
    typeKeys?: Partial<Record<Provider, string>>;
    offered?: string[];
    enable?: string[];
  } = {},
): Promise<void> {
  const next = page.getByRole('button', { name: 'Next', exact: true });
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await next.click();

  await expect(page.getByRole('heading', { name: 'AI providers' })).toBeVisible();
  for (const [p, key] of Object.entries(opts.typeKeys ?? {}) as [Provider, string][]) {
    await enterKey(page, p, key);
  }
  await next.click();

  await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
  if (opts.offered) {
    await expect(page.getByRole('checkbox')).toHaveCount(opts.offered.length);
    for (const label of opts.offered) {
      await expect(page.getByRole('checkbox', { name: label, exact: true })).toBeVisible();
    }
  }
  for (const label of opts.enable ?? []) {
    await page.getByRole('checkbox', { name: label, exact: true }).check();
  }
  await next.click();

  await expect(page.getByRole('heading', { name: 'Limits' })).toBeVisible();
  await next.click();

  await expect(page.getByRole('heading', { name: 'Review' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish setup' }).click();

  await expect(page.getByRole('heading', { name: 'You are all set' })).toBeVisible();
  await page.getByRole('link', { name: 'Open the editor' }).click();
  await expect(page.getByRole('button', { name: 'Import JSON' })).toBeVisible();
}

/** One call the fake server answered, as listed by its `/log`. */
export interface FakeCall {
  provider: Provider;
  path: string;
  status: number;
}

/** Makes the fake server answer the next generation call of `provider` with `status`. */
export async function failNext(control: string, provider: Provider, status: number): Promise<void> {
  const res = await fetch(`${control}/fail-next`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider, status }),
  });
  if (!res.ok) throw new Error(`fake-ai /fail-next answered ${res.status}`);
}

/** The calls the fake server answered since the last reset, oldest first. */
export async function fakeLog(control: string): Promise<FakeCall[]> {
  const res = await fetch(`${control}/log`);
  if (!res.ok) throw new Error(`fake-ai /log answered ${res.status}`);
  return (await res.json()) as FakeCall[];
}

/**
 * Opens the editor's "AI model" section if needed and presses `label`'s select button. The
 * buttons all read "Use" or "Selected", so the button is found by its column: the model's
 * column header in the provider's comparison table.
 */
export async function selectModel(page: Page, label: string): Promise<void> {
  const table = page
    .getByRole('table')
    .filter({ has: page.getByRole('columnheader', { name: label, exact: true }) });
  if (!(await table.isVisible())) {
    // The section is a <details>; its <summary> has no accessible role, so it is found by its text.
    await page.getByText('AI model', { exact: true }).click();
  }
  const headers = await table.getByRole('columnheader').allTextContents();
  // The first column header is the empty one above the row labels.
  const button = table.getByRole('button').nth(headers.indexOf(label) - 1);
  await button.click();
  await expect(button).toHaveText('Selected');
}

/** Generates from `prompt`, answering the questions with their defaults ("You decide"). */
export async function generate(page: Page, prompt: string): Promise<void> {
  const done = page.getByRole('status').filter({ hasText: 'New diagram generated' });
  // A previous generation's notice would satisfy the waits below before this one has started.
  if (await done.isVisible()) await done.getByRole('button', { name: 'Dismiss' }).click();
  await expect(done).toHaveCount(0);
  await page.getByPlaceholder('Describe your application').fill(prompt);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const questions = page.getByRole('region', { name: 'Clarify before drawing' });
  // The questions step appears only when the extraction found gaps.
  await expect(questions.or(done)).toBeVisible({ timeout: GENERATION_TIMEOUT_MS });
  if (await questions.isVisible()) {
    await questions.getByRole('button', { name: 'Continue' }).click();
  }
  await expect(done).toBeVisible({ timeout: GENERATION_TIMEOUT_MS });
}

/** Saves one entry of the Export menu and returns the file's bytes. */
export async function download(
  page: Page,
  menuItem: 'PNG image' | 'SVG image' | 'JSON project',
): Promise<Buffer> {
  // The menu is a <details>; its <summary> has no accessible role, so it is found by its text.
  await page.getByText('Export', { exact: true }).click();
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: menuItem }).click(),
  ]);
  const path = await file.path();
  // Image exports leave the menu open; close it so it does not cover the canvas.
  await page.keyboard.press('Escape');
  return readFile(path);
}

/** The diagram area. */
export const canvas = (page: Page): Locator =>
  page.getByRole('region', { name: 'Architecture canvas' });

/** Asserts every node label of `project` is shown on the canvas. */
export async function expectNodes(page: Page, project: Project): Promise<void> {
  for (const label of new Set(project.nodes.map((n) => n.label))) {
    await expect(canvas(page).getByText(label, { exact: true }).first()).toBeVisible({
      timeout: CANVAS_TIMEOUT_MS,
    });
  }
}

/** Node labels of `a` that `b` does not have. */
export const onlyIn = (a: Project, b: Project): string[] => {
  const other = new Set(b.nodes.map((n) => n.label));
  return [...new Set(a.nodes.map((n) => n.label))].filter((l) => !other.has(l));
};

const CLIENT: Record<Provider, (key: string) => LlmClient> = {
  anthropic: anthropicClient,
  openai: openaiClient,
  google: googleClient,
};

/**
 * The designs the app should show for `PROMPTS[provider]`: the fixtures replayed in-process
 * through the same generator the gateway runs, so a re-recording needs no spec change.
 */
export async function expectedDesigns(provider: Provider): Promise<Project[]> {
  const ENV = ['ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL', 'GOOGLE_GEMINI_BASE_URL'] as const;
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  const server = await startFakeAi({ fixtures: loadFixtures(), port: 0, controlPort: 0 });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    process.env.ANTHROPIC_BASE_URL = base;
    process.env.OPENAI_BASE_URL = `${base}/v1`;
    process.env.GOOGLE_GEMINI_BASE_URL = base;
    const llm = CLIENT[provider]('fake-key');
    const projects: Project[] = [];
    for (const prompt of PROMPTS[provider]) projects.push(await design(llm, provider, prompt));
    return projects;
  } finally {
    await server.close();
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}
