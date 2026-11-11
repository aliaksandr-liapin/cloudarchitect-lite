import { listedModels, PROVIDERS } from '@cloudarchitect/domain';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  ProvidersStep,
  afterRemovals,
  effectiveSelection,
  hasKey,
  keyedProviders,
  offeredModels,
  providerSummary,
  removalSummary,
  removedKeys,
  welcomeKeyLine,
} from './SetupWizard';

const none = { anthropic: 'none', openai: 'none', google: 'none' } as const;
const idle = { anthropic: 'unchecked', openai: 'unchecked', google: 'unchecked' } as const;
const empty = { anthropic: '', openai: '', google: '' };
const kept = { anthropic: false, openai: false, google: false };
const render = (over: Partial<Parameters<typeof ProvidersStep>[0]> = {}) =>
  renderToStaticMarkup(
    <ProvidersStep
      sources={none}
      keys={empty}
      checks={idle}
      removed={kept}
      onKey={vi.fn()}
      onCheck={vi.fn()}
      onRemove={vi.fn()}
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
    expect(out).not.toContain('Remove saved key');
  });

  it('offers to remove a saved key, and to undo that', () => {
    const saved = render({ sources: { ...none, openai: 'saved' } });
    expect(saved).toContain('Saved key');
    expect(saved.match(/Remove saved key/g)).toHaveLength(1);
    expect(saved).not.toContain('Undo');
    const marked = render({
      sources: { ...none, openai: 'saved' },
      removed: { ...kept, openai: true },
    });
    expect(marked).toContain('Will be removed when you finish setup');
    expect(marked).toContain('Undo');
    expect(marked).not.toContain('Remove saved key');
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

  it('selects the only offered model when none of the configured ones has a key', () => {
    // Gemini-only install: the default configuration names Haiku, which has no key.
    expect(effectiveSelection(['haiku'], 'haiku', offeredModels(['google']))).toEqual({
      models: ['gemini-argon'],
      defaultModel: 'gemini-argon',
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

  it('treats a saved key marked for removal as gone unless a new key was checked', () => {
    const sources = {
      ...none,
      anthropic: 'saved',
      openai: 'saved',
      google: 'environment',
    } as const;
    const removed = { anthropic: true, openai: true, google: true };
    const after = afterRemovals(sources, removed);
    // An environment key cannot be removed.
    expect(after).toEqual({ anthropic: 'none', openai: 'none', google: 'environment' });
    expect(keyedProviders(after, idle)).toEqual(['google']);
    expect(keyedProviders(after, { ...idle, openai: 'valid' })).toEqual(['openai', 'google']);
    expect(removedKeys(sources, removed)).toEqual(['anthropic', 'openai']);
    expect(removalSummary(sources, removed, { ...idle, openai: 'valid' })).toBe('Claude');
    expect(removalSummary(sources, kept, idle)).toBe('');
  });
});
