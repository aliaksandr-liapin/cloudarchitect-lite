/**
 * Starts the production web + gateway images with Docker Compose for the browser test:
 * `compose.yaml` (+ `compose.build.yaml` for local images) + `e2e/compose.e2e.yaml`, which adds
 * the fake AI server and points the gateway at it.
 *
 * The repo-root `.env` is never used: the gateway's `env_file` is replaced by a temp file holding
 * only `envFor(setup)`, and the same file replaces `.env` for compose's own interpolation.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Setup = 'claude' | 'gemini' | 'all';

export const FAKE_KEYS = {
  anthropic: 'sk-ant-e2e-fake-key-0000000000000000',
  openai: 'sk-e2e-fake-key-0000000000000000',
  google: 'AIza-e2e-fake-key-000000000000000',
};

export const REJECTED_KEY = 'sk-ant-e2e-rejected-key-00000000000';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const BASE_URL = 'http://localhost:8080';
const CONTROL_URL = 'http://127.0.0.1:8799';
const SETUP_LINK = /http:\/\/localhost:8080\/setup\?code=[0-9a-f]{12}/;
const ICONS_TIMEOUT_MS = 120_000;

/** The gateway's environment beyond the base URLs. */
export function envFor(setup: Setup): Record<string, string> {
  switch (setup) {
    case 'claude':
      // The Anthropic key is typed in the wizard.
      return {};
    case 'gemini':
      // Below one Argon generation, above its extraction.
      return { GEMINI_API_KEY: FAKE_KEYS.google, DAILY_BUDGET_MICRO_USD: '20000' };
    case 'all':
      return { OPENAI_API_KEY: FAKE_KEYS.openai, GEMINI_API_KEY: FAKE_KEYS.google };
  }
}

export function envFile(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}\n`)
    .join('');
}

export function composeArgs(opts: {
  setup: Setup;
  images: 'local' | 'ghcr';
  version?: string;
  envFile: string;
  /** Checkout holding the compose files; the repo root by default. */
  root?: string;
}): string[] {
  const root = opts.root ?? ROOT;
  const files = [
    'compose.yaml',
    ...(opts.images === 'local' ? ['compose.build.yaml'] : []),
    'e2e/compose.e2e.yaml',
  ];
  return [
    'compose',
    '--project-name',
    `ca-e2e-${opts.setup}`,
    '--project-directory',
    root,
    // Replaces the project's `.env` for interpolation.
    '--env-file',
    opts.envFile,
    ...files.flatMap((f) => ['--file', join(root, f)]),
  ];
}

/** Environment for the `docker compose` process: fixes the variables the compose files read. */
export function composeEnv(opts: { envFile: string; version?: string }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, E2E_ENV_FILE: opts.envFile, WEB_PORT: '8080' };
  if (opts.version) env.CLOUDARCHITECT_VERSION = opts.version;
  else delete env.CLOUDARCHITECT_VERSION;
  return env;
}

function docker(
  args: string[],
  sub: string[],
  env: NodeJS.ProcessEnv,
  showProgress = false,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [...args, ...sub], {
      env,
      stdio: ['ignore', 'pipe', showProgress ? 'inherit' : 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout!.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else
        reject(
          new Error(`docker compose ${sub.join(' ')} exited with ${code}${err ? `:\n${err}` : ''}`),
        );
    });
  });
}

async function poll<T>(
  timeoutMs: number,
  check: () => Promise<T | undefined>,
): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await check().catch(() => undefined);
    if (v !== undefined || Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export interface Stack {
  baseUrl: string;
  setupUrl: string;
  /** The fake AI server's control API. */
  control: string;
  stop(): Promise<void>;
  logs(): Promise<string>;
}

export async function startStack(opts: {
  setup: Setup;
  images: 'local' | 'ghcr';
  version?: string;
}): Promise<Stack> {
  const dir = await mkdtemp(join(tmpdir(), `ca-e2e-${opts.setup}-`));
  const file = join(dir, 'e2e.env');
  await writeFile(file, envFile(envFor(opts.setup)));
  const args = composeArgs({ ...opts, envFile: file });
  const env = composeEnv({ envFile: file, version: opts.version });

  const logs = () => docker(args, ['logs', '--no-color'], env);
  const stop = async () => {
    await docker(args, ['down', '--volumes', '--remove-orphans'], env);
    await rm(dir, { recursive: true, force: true });
  };

  try {
    // A crashed earlier run can leave a configured `gateway-data` volume, which hides the setup link.
    await docker(args, ['down', '--volumes', '--remove-orphans'], env).catch(() => undefined);
    await docker(args, ['up', '--detach', '--wait', '--wait-timeout', '300'], env, true);
    const setupUrl = await poll(30_000, async () => {
      const out = await docker(args, ['logs', '--no-color', 'gateway'], env);
      return SETUP_LINK.exec(out)?.[0];
    });
    if (!setupUrl)
      throw new Error('the gateway log has no setup link (http://localhost:8080/setup?code=…)');
    const ready = await poll(ICONS_TIMEOUT_MS, async () => {
      const res = await fetch(`${BASE_URL}/api/icons`, { signal: AbortSignal.timeout(5000) });
      return (await res.text()).includes('"state":"ready"') || undefined;
    });
    if (!ready) {
      throw new Error(
        `the icon download did not finish within ${ICONS_TIMEOUT_MS / 1000} s: the gateway fetches the AWS icon set on first start and needs internet access`,
      );
    }
    return { baseUrl: BASE_URL, setupUrl, control: CONTROL_URL, stop, logs };
  } catch (err) {
    const output = await logs().catch(() => '');
    await stop().catch(() => undefined);
    throw new Error(`${(err as Error).message}\n--- compose logs ---\n${output}`, { cause: err });
  }
}
