/**
 * Regenerates the screenshots in docs/images (`pnpm screenshots`). Serves the built web app with
 * `vite preview` and drives the locally installed Google Chrome. Every /api call is answered with a
 * fixed response, so no gateway, API key or network access is needed and the images are repeatable.
 * The responses are one real generation recorded by tools/record-generation.ts. `--gif` records only
 * docs/images/demo.gif; it needs `ffmpeg` on the PATH and Playwright's recorder (`pnpm exec playwright-core install ffmpeg`).
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

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
  dailyBudgetUsd: 5,
  monthlyBudgetUsd: 50,
  rateLimitPerMinute: 20,
};

interface Fixture {
  prompt: string;
  toggles: Record<string, boolean>;
  questions: { questions: { topic: string; suggestions: string[] }[] };
  result: unknown;
}

/** One real generation recorded by tools/record-generation.ts: the product's own output, replayed. */
const FIXTURE = JSON.parse(
  await readFile(new URL('./fixtures/blog-generation.json', import.meta.url), 'utf8'),
) as Fixture;
const BLOG_PROMPT = FIXTURE.prompt;

/** The verified official icon pack (`node tools/fetch-icons.ts`), served as the gateway would. */
const ICON_RELEASE = '2026-07-31';
const ICONS = await readFile(
  new URL(`../.cache/icons/aws-${ICON_RELEASE}.json`, import.meta.url),
  'utf8',
).then(
  (text) => (JSON.parse(text) as { icons: Record<string, string> }).icons,
  () => {
    throw new Error('Official icons missing: run `node tools/fetch-icons.ts` first.');
  },
);

/** `delays` stretch the generate and continue replies so the recording shows the progress status. */
async function mockApi(
  context: BrowserContext,
  configured: boolean,
  delays: { generate?: number; continue?: number } = {},
) {
  const responses: Record<string, unknown> = {
    '/api/ai/generate': FIXTURE.questions,
    '/api/ai/generate/continue': FIXTURE.result,
    '/api/icons': { state: 'ready', release: ICON_RELEASE, icons: ICONS },
    '/api/setup/status': configured
      ? { available: true, configured: true }
      : {
          available: true,
          configured: false,
          providers: { anthropic: 'none', openai: 'none', google: 'none' },
          keyFromEnvironment: false,
          lockedByEnvironment: [],
          current: WIZARD_DEFAULTS,
        },
    '/api/setup/verify-key': { result: 'valid' },
    '/api/setup/complete': { ok: true },
    '/api/models': {
      defaultModel: 'haiku',
      enabled: ['haiku', 'sonnet'],
      options: [],
      available: {
        haiku: true,
        sonnet: true,
        'gpt-luna': false,
        'gpt-sol': false,
        'gemini-flash-lite': false,
        'gemini-argon': false,
      },
    },
  };
  return context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = responses[path];
    if (!body) return route.fulfill({ status: 404, json: { error: 'not_found' } });
    const delay = path === '/api/ai/generate' ? delays.generate : delays.continue;
    if (delay && path.startsWith('/api/ai/')) await new Promise((r) => setTimeout(r, delay));
    return route.fulfill({ json: body });
  });
}

async function shot(page: Page, name: string, fullPage = false) {
  await page.waitForTimeout(400); // let transitions and fitView settle
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage });
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
  const file = join(
    await mkdtemp(join(tmpdir(), 'screenshots-')),
    'myblog-with-finding.project.json',
  );
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

/** The clarification round over the editor: quick answers, You decide, editable requirements. */
async function clarification(context: BrowserContext) {
  await mockApi(context, true);
  const page = await context.newPage();
  await page.goto(BASE);
  await page.locator('.react-flow__node').first().waitFor();
  await page.getByPlaceholder(/Describe your application/).fill(BLOG_PROMPT);
  await page.getByRole('button', { name: 'Backups' }).click();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await page.getByRole('heading', { name: 'A few questions before drawing' }).waitFor();
  const first = FIXTURE.questions.questions[0];
  await page.getByRole('button', { name: first.suggestions[0], exact: true }).click();
  await shot(page, 'generate-clarify');
}

async function wizard(context: BrowserContext) {
  await mockApi(context, false);
  const page = await context.newPage();
  const next = () => page.getByRole('button', { name: 'Next' }).click();
  await page.goto(`${BASE}/setup?code=${SETUP_CODE}`);
  await page.getByRole('heading', { name: 'Welcome' }).waitFor();
  await shot(page, 'setup-1-welcome');
  await next();
  await page.getByLabel('Claude API key').fill(FAKE_KEY);
  await page.getByRole('button', { name: 'Check key' }).first().click();
  await page.getByText('✓ Key works').waitFor();
  await shot(page, 'setup-2-key', true);
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

/** README GIF must stay below this size. */
const GIF_MAX_BYTES = 5 * 1024 * 1024;
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';

/**
 * Types the prompt, answers the clarification card and waits for the finished diagram, the way a
 * person would. Returns the seconds of video to skip (the blank page load before typing starts).
 */
async function recordedFlow(page: Page, startedAt: number) {
  await page.goto(BASE);
  await page.locator('.react-flow__node img').first().waitFor(); // official icons loaded
  await page.waitForTimeout(500);
  const trim = (Date.now() - startedAt) / 1000;
  await page.getByPlaceholder(/Describe your application/).pressSequentially(BLOG_PROMPT, {
    delay: 12,
  });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Backups' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await page.getByRole('heading', { name: 'A few questions before drawing' }).waitFor();
  await page.waitForTimeout(800);
  for (const q of FIXTURE.questions.questions) {
    await page.getByRole('button', { name: q.suggestions[0], exact: true }).click();
    await page.waitForTimeout(700);
  }
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.locator('.gen-status').waitFor();
  await page.locator('.gen-status').waitFor({ state: 'detached' });
  await page.waitForTimeout(2000); // let fitView settle and hold on the finished diagram
  return trim;
}

/** `pnpm screenshots --gif`: a screen recording of the replayed generation, converted to docs/images/demo.gif. */
async function gif(browser: Browser) {
  const videoDir = await mkdtemp(join(tmpdir(), 'demo-video-'));
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    colorScheme: 'light',
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } },
  });
  await mockApi(context, true, { generate: 2500, continue: 3500 });
  const startedAt = Date.now();
  const page = await context.newPage();
  const trim = await recordedFlow(page, startedAt);
  const video = page.video();
  await context.close();
  const source = await video!.path();
  const target = `${OUT}demo.gif`;
  const filter =
    'fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4';
  const run = spawnSync(
    FFMPEG,
    ['-y', '-v', 'error', '-ss', trim.toFixed(2), '-i', source, '-vf', filter, target],
    { stdio: 'inherit' },
  );
  if (run.status !== 0) throw new Error('ffmpeg failed (is it installed? set FFMPEG=/path)');
  await rm(videoDir, { recursive: true, force: true });
  const { size } = await stat(target);
  if (size >= GIF_MAX_BYTES)
    throw new Error(`demo.gif is ${size} bytes; limit is ${GIF_MAX_BYTES}`);
  console.log(`docs/images/demo.gif (${(size / 1024 / 1024).toFixed(2)} MB)`);
}

/** 1280x640 repository card: name, pitch and the app's own rendering of the recorded diagram. */
async function socialPreview(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 760 },
    deviceScaleFactor: 2,
    colorScheme: 'light',
  });
  await mockApi(context, true);
  const page = await context.newPage();
  await page.goto(BASE);
  await page.locator('.react-flow__node').first().waitFor();
  await page.getByPlaceholder(/Describe your application/).fill(BLOG_PROMPT);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await page.getByRole('heading', { name: 'A few questions before drawing' }).waitFor();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('heading', { name: /Findings/ }).waitFor();
  await page.waitForTimeout(2500); // fitView animation
  const diagram = (await page.locator('.react-flow').screenshot()).toString('base64');
  await context.close();
  const card = await browser.newContext({ viewport: { width: 1280, height: 640 } });
  const cardPage = await card.newPage();
  await cardPage.setContent(`<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; width: 1280px; height: 640px; overflow: hidden; background: #f6f8fb;
      font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #17202e; }
    .text { padding: 52px 64px 0; }
    h1 { margin: 0; font-size: 56px; letter-spacing: -1px; }
    p { margin: 14px 0 0; font-size: 26px; line-height: 1.35; color: #3d4b5f; max-width: 1180px; }
    .shot { position: absolute; left: 64px; right: 64px; top: 250px; bottom: -40px;
      border-radius: 14px 14px 0 0; border: 1px solid #d3dae5; border-bottom: 0; overflow: hidden;
      background: #fff url(data:image/png;base64,${diagram}) center / cover no-repeat;
      box-shadow: 0 10px 40px rgba(23, 32, 46, 0.18); }
  </style><div class="text"><h1>CloudArchitect Lite</h1>
  <p>Describe your app, get an AWS architecture checked against 25 rules, on your own key.</p></div>
  <div class="shot"></div>`);
  await cardPage.screenshot({ path: `${OUT}social-preview.png` });
  await card.close();
  console.log('docs/images/social-preview.png');
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
    if (process.argv.includes('--gif')) {
      await gif(browser);
    } else {
      const projectFile = await sampleWithFinding();
      for (const colorScheme of ['light', 'dark'] as const) {
        const context = await browser.newContext({ viewport, deviceScaleFactor: 2, colorScheme });
        // The editor follows its own theme switch (light by default), not the OS preference.
        await context.addInitScript((theme) => {
          localStorage.setItem('cloudarchitect.theme', theme);
        }, colorScheme);
        await editor(context, `editor-${colorScheme}`, projectFile);
        await context.close();
      }
      const clarifyContext = await browser.newContext({
        viewport,
        deviceScaleFactor: 2,
        colorScheme: 'light',
      });
      await clarification(clarifyContext);
      await clarifyContext.close();
      const context = await browser.newContext({
        viewport: { width: 1100, height: 700 },
        deviceScaleFactor: 2,
        colorScheme: 'light',
      });
      await wizard(context);
      await context.close();
      await socialPreview(browser);
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
