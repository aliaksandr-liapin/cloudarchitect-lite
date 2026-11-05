import { listedModels, PROVIDERS } from '@cloudarchitect/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  ProvidersStep,
  effectiveSelection,
  hasKey,
  offeredModels,
  providerSummary,
  welcomeKeyLine,
} from './SetupWizard';

const none = { anthropic: 'none', openai: 'none', google: 'none' } as const;
const idle = { anthropic: 'unchecked', openai: 'unchecked', google: 'unchecked' } as const;
const empty = { anthropic: '', openai: '', google: '' };
const render = (over: Partial<Parameters<typeof ProvidersStep>[0]> = {}) =>
  renderToStaticMarkup(
    <ProvidersStep
      sources={none}
      keys={empty}
      checks={idle}
      onKey={vi.fn()}
      onCheck={vi.fn()}
      {...over}
    />,
  );

describe('AI providers step', () => {
  it('is titled "AI providers" with three cards, key pages and password fields', () => {
    const out = render();
    expect(out).toContain('AI providers');
    for (const label of ['Claude', 'OpenAI', 'Gemini']) expect(out).toContain(label);
    for (const url of [
      'https://platform.claude.com/settings/keys',
      'https://platform.openai.com/api-keys',
      'https://aistudio.google.com/apikey',
    ])
      expect(out).toContain(`href="${url}"`);
    expect(out.match(/type="password"/g)).toHaveLength(3);
    expect(out.match(/Check key/g)).toHaveLength(3);
  });

  it('shows the check results', () => {
    const out = render({
      checks: { anthropic: 'valid', openai: 'invalid', google: 'unreachable' },
    });
    expect(out).toContain('✓ Key works');
    expect(out).toContain('Key rejected');
    expect(out).toContain('Could not reach Gemini');
  });

  it('shows "Set by environment" without a field for an environment key', () => {
    const out = render({ sources: { ...none, openai: 'environment' } });
    expect(out).toContain('Set by environment');
    expect(out.match(/type="password"/g)).toHaveLength(2);
  });
});

describe('provider helpers', () => {
  it('counts environment, saved and checked keys, nothing else', () => {
    expect(hasKey(none, idle, 'openai')).toBe(false);
    expect(hasKey({ ...none, openai: 'saved' }, idle, 'openai')).toBe(true);
    expect(hasKey({ ...none, openai: 'environment' }, idle, 'openai')).toBe(true);
    expect(hasKey(none, { ...idle, openai: 'valid' }, 'openai')).toBe(true);
    expect(hasKey(none, { ...idle, openai: 'invalid' }, 'openai')).toBe(false);
  });

  it('offers only models of providers with a key', () => {
    expect(offeredModels([])).toEqual([]);
    expect(offeredModels(['openai']).map((o) => o.id)).toEqual(['gpt-sol']);
    expect(offeredModels(['anthropic']).map((o) => o.id)).toEqual(['haiku', 'sonnet']);
    expect(offeredModels([...PROVIDERS]).map((o) => o.id)).toEqual(listedModels().map((o) => o.id));
  });

  it('drops configured models without a key and repairs the default', () => {
    const offered = offeredModels(['anthropic']);
    expect(effectiveSelection(['gpt-luna', 'sonnet'], 'gpt-luna', offered)).toEqual({
      models: ['sonnet'],
      defaultModel: 'sonnet',
    });
    expect(effectiveSelection(['gpt-luna'], 'gpt-luna', offered)).toEqual({
      models: [],
      defaultModel: undefined,
    });
  });

  it('names the providers that have keys', () => {
    expect(welcomeKeyLine(['anthropic', 'google'])).toContain('Claude and Gemini');
    expect(welcomeKeyLine([])).toContain('Claude, OpenAI or Gemini');
    expect(
      providerSummary(
        { ...none, anthropic: 'environment', openai: 'saved' },
        {
          ...idle,
          google: 'valid',
        },
      ),
    ).toBe(
      'Claude (from environment), OpenAI (saved key kept), Gemini (checked ✓, stored on the server)',
    );
  });
});
