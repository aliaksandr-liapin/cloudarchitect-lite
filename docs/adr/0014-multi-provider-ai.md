# ADR-0014: Multiple AI providers

**Status:** Accepted · **Date:** 2026-11-05 · **Extends:** [ADR-0011](0011-model-selection.md)

**Context.** Through 0.2 CloudArchitect Lite used Claude only. Self-hosting users bring their own key ([ADR-0013](0013-self-hosted-only.md)), and many already have an OpenAI or Google key. The roadmap's 0.3 release asks which provider designs AWS architectures best. The design is in the [spec](../superpowers/specs/2026-10-26-multi-provider-ai-design.md); the measurements are in the [benchmark report](../product/phase3-provider-benchmark.md).

**Decision.**

- **Official SDK adapters behind `LlmClient`.** Anthropic, OpenAI (`openai`) and Gemini (`@google/genai`) each have an adapter; the generator, the repair loop and the gateway see one interface and one usage and cost model.
- **Price-matched tiers.** Each provider offers an economical and a best-quality model, matched by price class, not by name. Existing choice ids `haiku` and `sonnet` and saved 0.2 settings keep working.
- **Extraction on the selected provider's economical model** (`claude-haiku-5-5`, `gpt-6-luna`, `gemini-3.5-flash-lite`). One operation never mixes providers, so one key and one provider's terms cover it.
- **Per-provider key checks.** The setup wizard validates each key against its own provider; a key is sent only to its provider, is never logged and is never returned to the browser. A model whose provider has no key is dropped from the enabled list at startup and the editor shows "Add a key in setup".
- **Spending limits count all providers together.**
- **Three-provider blind review panel.** Designs are reviewed blind by three reviewers, one per provider (best-quality tier), and a design's score is the median of the three, so no provider grades itself alone.
- **Listing bar.** A model is listed in the wizard and the editor only when its measured pass rate is at least 85%, no-critical-defect rate at least 85% and blind median at least 2.0. Claude Haiku 5.5, Claude Sonnet 5.5, GPT-6.1 Sol and Gemini 4 Argon are listed; GPT-6 Luna and Gemini 3.5 Flash-Lite are supported but not listed.

**Consequences.**

- Each provider has its own schema dialect, handled inside its adapter: OpenAI strict mode (optional fields come back as `null` and are turned into absent fields, while required nullable fields keep `null`), the Gemini schema subset, and no integer `minimum`/`maximum` in Anthropic output schemas. Domain schemas stay provider-neutral.
- Two more runtime dependencies, both in `packages/generator`.
- Changing a model, the prompt or the repair loop still needs a new eval run and review ([ADR-0009](0009-eval-harness-release-gate.md)). A model that fails the listing bar can be re-measured and listed later.
- The AI review panel shares a known bias (each reviewer leaned toward its own provider on one pair); the report states this and a human spot check remains planned.
- Prices change; the cost shown for a model is as of the date in the report (Gemini 4 Argon uses its December price).
