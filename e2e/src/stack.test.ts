/**
 * The e2e compose stack, checked with `docker compose config` (no containers start). Needs the
 * Docker CLI; skipped where it is missing. Resolved configs are never printed: on a developer
 * machine they can hold real keys from the repo-root `.env` if the override ever breaks.
 */
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { composeArgs, composeEnv, envFile, envFor, ROOT } from './stack.ts';
import type { Setup } from './stack.ts';

const SETUPS: Setup[] = ['claude', 'gemini', 'all'];
const BASE_URLS = {
  ANTHROPIC_BASE_URL: 'http://fake-ai:8790',
  OPENAI_BASE_URL: 'http://fake-ai:8790/v1',
  GOOGLE_GEMINI_BASE_URL: 'http://fake-ai:8790',
};
/** Set by compose.yaml itself. */
const COMPOSE_VARS = ['ALLOWED_ORIGINS', 'PUBLIC_URL'];

const hasDocker = spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status === 0;

interface Service {
  image?: string;
  environment?: Record<string, string | null>;
  ports?: { host_ip?: string; target: number; published?: string }[];
}

let tmp: string;

async function config(
  setup: Setup,
  opts: { images?: 'local' | 'ghcr'; version?: string; root?: string } = {},
): Promise<Record<string, Service>> {
  const file = join(tmp, `${setup}.env`);
  await writeFile(file, envFile(envFor(setup)));
  const args = composeArgs({
    setup,
    images: opts.images ?? 'local',
    version: opts.version,
    envFile: file,
    root: opts.root,
  });
  const r = spawnSync('docker', [...args, 'config', '--format', 'json'], {
    env: composeEnv({ envFile: file, version: opts.version }),
    encoding: 'utf8',
  });
  // Only stderr is shown: stdout is the resolved config.
  if (r.status !== 0) throw new Error(`docker compose config failed: ${r.stderr}`);
  return (JSON.parse(r.stdout) as { services: Record<string, Service> }).services;
}

function unexpected(gateway: Service, setup: Setup): string[] {
  const allowed = new Set([
    ...Object.keys(envFor(setup)),
    ...Object.keys(BASE_URLS),
    ...COMPOSE_VARS,
  ]);
  return Object.keys(gateway.environment ?? {}).filter((k) => !allowed.has(k));
}

describe.skipIf(!hasDocker)('e2e compose stack', () => {
  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'ca-e2e-test-'));
  });
  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  describe('never loads the repo-root .env', () => {
    it.each(SETUPS)('%s: the gateway gets only the e2e variables', async (setup) => {
      // On a developer machine the repo-root .env holds real keys; only a count is reported,
      // so no variable from it ends up in test output.
      const gateway = (await config(setup)).gateway!;
      expect(unexpected(gateway, setup).length, 'variables from outside the e2e env file').toBe(0);
      for (const [k, v] of Object.entries(envFor(setup))) {
        expect(gateway.environment?.[k] === v, `${k} from the e2e env file`).toBe(true);
      }
    });

    it.each(SETUPS)(
      '%s: a planted .env is ignored, for variables and interpolation',
      async (setup) => {
        const root = join(tmp, `root-${setup}`);
        await mkdir(join(root, 'e2e'), { recursive: true });
        for (const f of ['compose.yaml', 'compose.build.yaml', 'e2e/compose.e2e.yaml']) {
          await copyFile(join(ROOT, f), join(root, f));
        }
        await writeFile(
          join(root, '.env'),
          'E2E_LEAK_SENTINEL=leaked\nANTHROPIC_API_KEY=sk-ant-leaked\nWEB_PORT=9999\nCLOUDARCHITECT_VERSION=9.9.9\n',
        );
        const services = await config(setup, { images: 'ghcr', version: '0.3.0', root });
        expect(unexpected(services.gateway!, setup)).toEqual([]);
        expect(services.gateway!.image).toMatch(/:0\.3\.0$/);
        expect(services.web!.ports?.map((p) => p.published)).toEqual(['8080']);
      },
    );
  });

  it('points every provider at the fake server', async () => {
    for (const setup of SETUPS) {
      const env = (await config(setup)).gateway!.environment ?? {};
      for (const [k, v] of Object.entries(BASE_URLS)) expect(env[k], `${setup} ${k}`).toBe(v);
    }
  });

  it('publishes the control port on 127.0.0.1 only', async () => {
    const fake = (await config('claude'))['fake-ai']!;
    expect(fake.ports).toEqual([
      expect.objectContaining({ host_ip: '127.0.0.1', target: 8799, published: '8799' }),
    ]);
  });

  it('ghcr images use the given version', async () => {
    const services = await config('claude', { images: 'ghcr', version: '0.3.0' });
    expect(services.gateway!.image).toBe(
      'ghcr.io/aliaksandr-liapin/cloudarchitect-lite/gateway:0.3.0',
    );
    expect(services.web!.image).toBe('ghcr.io/aliaksandr-liapin/cloudarchitect-lite/web:0.3.0');
    const older = await config('claude', { images: 'ghcr', version: '0.2.0' });
    expect(older.gateway!.image).toBe(
      'ghcr.io/aliaksandr-liapin/cloudarchitect-lite/gateway:0.2.0',
    );
  });

  it('local images are built from this checkout', async () => {
    const services = await config('claude', { images: 'local' });
    expect(services.gateway!.image).toBe('cloudarchitect-gateway:local');
  });
});
