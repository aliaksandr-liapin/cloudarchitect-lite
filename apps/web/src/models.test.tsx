import { MODEL_OPTIONS, listedModels, type ModelChoice } from '@cloudarchitect/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ModelComparison, ModelGroups, pickChoice } from './models';

const withBenchmark = (id: string) => MODEL_OPTIONS.find((o) => o.id === id)!;
const luna = { ...withBenchmark('gpt-luna') };
const lunaMeasured = {
  ...luna,
  benchmark: {
    measuredAt: '2026-11-05',
    runId: 'x',
    runs: 3,
    schemaValidRate: 1,
    passRate: 0.9,
    costPerOperationUsd: 0.002,
    medianLatencySeconds: 20,
  },
};
const all: Record<ModelChoice, boolean> = {
  haiku: true,
  sonnet: true,
  'gpt-luna': false,
  'gpt-sol': false,
  'gemini-flash-lite': false,
  'gemini-argon': false,
};

describe('ModelGroups', () => {
  const options = [...listedModels(), lunaMeasured];
  const html = (extra = {}) =>
    renderToStaticMarkup(
      <ModelGroups
        options={options}
        enabled={['haiku', 'gpt-luna']}
        onSelect={vi.fn()}
        {...extra}
      />,
    );

  it('renders one comparison table per provider, in provider order', () => {
    const out = html();
    expect(out.match(/<table/g)).toHaveLength(3);
    expect(out.indexOf('Claude')).toBeLessThan(out.indexOf('OpenAI'));
    expect(out.indexOf('OpenAI')).toBeLessThan(out.indexOf('<h3>Gemini'));
  });

  it('shows Not yet measured for rows without a value', () => {
    expect(html()).toContain('Not yet measured');
  });

  it('shows "Add a key in setup" instead of Use when the provider has no key', () => {
    const out = html({ available: all });
    expect(out).toContain('Add a key in setup');
    // Haiku has a key and is enabled; Sonnet is available but not enabled.
    expect(out).toContain('>Use<');
  });
});

describe('ModelComparison', () => {
  it('keeps a model with a key and enabled selectable', () => {
    const out = renderToStaticMarkup(
      <ModelComparison
        options={[withBenchmark('haiku')]}
        enabled={['haiku']}
        available={all}
        selected={undefined}
        onSelect={vi.fn()}
      />,
    );
    expect(out).toContain('>Use<');
    expect(out).not.toContain('Add a key in setup');
  });
});

describe('pickChoice', () => {
  const server = {
    enabled: ['haiku', 'gpt-luna'] as ModelChoice[],
    defaultModel: 'haiku' as const,
  };
  it('keeps a saved haiku choice', () => {
    expect(pickChoice('haiku', { ...server, available: all })).toBe('haiku');
  });
  it('falls back to the default when the saved model lost its key', () => {
    expect(pickChoice('gpt-luna', { ...server, available: all })).toBe('haiku');
  });
  it('resolves the model Generate sends: a saved choice without a key gives the server default', () => {
    const request = pickChoice('gpt-luna', { ...server, available: all });
    expect(request).toBe(server.defaultModel);
  });
  it('falls back to the default when the saved model is no longer enabled', () => {
    expect(pickChoice('sonnet', { ...server, available: all })).toBe('haiku');
  });
  it('selects nothing when there is no default', () => {
    expect(pickChoice(null, { enabled: [] })).toBeUndefined();
  });
});
