# Phase 2 AI Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate an editable, validated AWS diagram from a description: one round of clarifying questions, editable requirements, design-priority toggles, and automatic versions of the previous diagram. The eval harness runs the real generator, and Gate A is passed.

**Architecture:**

- **Shared generator.** A new `packages/generator` holds the two-call pipeline (extract on Haiku → generate on the chosen model, with a validator-driven repair turn). Both the gateway and the eval harness use it, so CI scores exactly what users get.
- **Gateway.** It wires the pipeline into the existing `/api/ai/generate` and `/continue` routes. Between the two calls it keeps no server state: an HMAC-signed operation token carries it.
- **Web app.** It adds the prompt panel, toggle chips, clarification card and IndexedDB versions.
- **Domain.** It gains toggles, the AI request/response contract, schema 1.3.0 and new rules.

**Tech Stack:** TypeScript 7, pnpm workspaces, Zod 4, Hono, `@anthropic-ai/sdk` (structured outputs via `output_config.format`), React 19 + React Flow, IndexedDB, Vitest 5, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-18-phase2-ai-generation-design.md`

## Global Constraints

- All repo content in English only. Commit messages are Conventional Commits and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Node ≥ 26, pnpm 10.32.1. Packages use `typescript@^7.0.2`, `vitest@^5.0.4`, `zod@^4.6.7`. Match existing package.json shapes (`"type": "module"`, `exports: { ".": "./src/index.ts" }`, `license: Apache-2.0`).
- `pnpm ci` (lint, format check, typecheck, test, build) must pass at the end of every task.
- Logs never contain prompts, answers, requirements, graphs or keys (NFR-006). Only request id, model, token counts, cost, latency and status.
- Prompt ≤ `LIMITS.maxPromptChars` (8000); graph ≤ `LIMITS.maxNodes` (150); request body ≤ 256 KiB (existing limit).
- Models: extraction always runs `claude-haiku-5-5`; generation uses `modelOption(choice).model` with `modelOption(choice).repairTurns`. Sonnet/Opus 5.5 reject forced `tool_choice`, so use `output_config.format` (`zodOutputFormat`) only: closed objects, ≤ 24 optional params.
- Clarification: at most **3** questions, **one** round, topics from a fixed list; "You decide" is always available; a credit is charged **once**, after a schema-valid project is returned.
- Versions: keep the last **10** per project; versions are not part of JSON export.
- API budget for the whole phase is **$5.59**. Ask the product owner before total spend passes **$4.50**. Every live run uses `--max-usd`. Report spend at each task that calls the API.
- Never type, log or echo the real API key. Local live runs read `ANTHROPIC_API_KEY` from env or repo-root `.env` (spike.ts pattern). CI reads the repository secret.
- Branch: `feat/phase2-ai-generation`. Main is protected; the PO merges PRs. Auto mode cannot run `gh pr merge`.

## Review Focus

1. **Two parallel Generate requests from one client with one credit left.** Only one returns a project. The other gets `402 no_credits` and no project, although its model cost still goes to the spend counters. Test owned by Task 7.
2. **A tampered, expired, or other-client operation token on `/continue`.** It is rejected (`400 invalid_operation` / `410 operation_expired`) before any model call, and no credit is used. Test owned by Task 6 (token) and Task 7 (route).
3. **The user cancels while the server is generating** (client disconnects). No credit is charged; spend is still recorded. Test owned by Task 7.
4. **Browser storage is blocked or full when saving the previous diagram as a version.** The replace does not proceed silently. The user is asked to export or replace anyway. Test owned by Task 10.
5. **Edited requirements on `/continue` that are empty, too long, or have duplicate ids.** They get `400 invalid_request`, and nothing is generated or charged. Test owned by Task 7 (schema in Task 1).

---

### Task 1: Domain contract — toggles, AI request/response types, schema 1.3.0

**Files:**

- Create: `packages/domain/src/toggles.ts`, `packages/domain/src/ai.ts`
- Modify: `packages/domain/src/project.ts`, `packages/domain/src/migrate.ts`, `packages/domain/src/index.ts`
- Test: `packages/domain/src/toggles.test.ts`, `packages/domain/src/domain.test.ts` (migration case)
- Modify: `packages/catalog/samples/myblog.project.json` and `eval/candidates/myblog.project.json` only if `Project.parse` requires it (it should not: migration handles 1.2.0)

**Interfaces:**

- Produces (`toggles.ts`):
  - `DesignToggles`: `z.object({ serverlessFirst, backups, highAvailability, costOptimized, securityHardening: z.boolean().optional(), disasterRecovery: z.enum(['multi-az','cross-region']).optional() }).strict()`; `type DesignToggles`.
  - `TOGGLE_REQUIREMENT_IDS`: `{ serverlessFirst: 'T-serverless-first', backups: 'T-backups', disasterRecovery: 'T-dr', highAvailability: 'T-ha', costOptimized: 'T-cost', securityHardening: 'T-security' }`.
  - `toggleRequirements(t: DesignToggles): Requirement[]`: one requirement per enabled toggle, `status: 'confirmed'`, `type: 'non-functional'`, `provenance: 'toggle'`, in key order above, with the texts below.
  - `toggleLabels(t: DesignToggles): string[]`: `'Serverless-first' | 'Backups' | 'DR: Multi-AZ' | 'DR: cross-region' | 'High availability' | 'Cost-optimized' | 'Security hardening'`, in the same order.
- Produces (`ai.ts`):
  - `GapTopic = z.enum(['auth-methods','user-scale','data-retention','region-residency','compliance','notifications','media-processing','integrations','availability-target'])`.
  - `Question = z.object({ topic: GapTopic, text: z.string().min(1).max(500), suggestions: z.array(z.string().min(1).max(120)).min(2).max(4) })`.
  - `YOU_DECIDE = 'you-decide'`.
  - `GenerateRequest = z.object({ prompt: z.string().min(1).max(LIMITS.maxPromptChars), catalogVersion: z.string(), model: ModelChoice.optional(), toggles: DesignToggles.default({}), reviewRequirements: z.boolean().default(false) })`.
  - `ContinueRequest = z.object({ operationId: z.string().uuid(), operationToken: z.string().max(64_000), answers: z.partialRecord(GapTopic, z.string().min(1).max(500)).default({}), requirements: z.array(Requirement).min(1).max(100).optional() })`, with a `.refine` that rejects duplicate requirement ids.
  - `GenerateResponse`: a union of `{ status: 'questions', operationId, operationToken, requirements: Requirement[], assumptions: string[], questions: Question[] }` and `{ status: 'done', project: Project, usage: { costUsd: number } }`. Export the types only; the gateway builds responses with them.
- Produces (`project.ts`):
  - `PROJECT_SCHEMA_VERSION = '1.3.0'`.
  - `Requirement.provenance` enum adds `'toggle'`.
  - `Project.generation: z.object({ toggles: DesignToggles, model: ModelChoice, generatedAt: z.iso.datetime(), contentHash: z.string() }).optional()`.
  - `graphContentHash(p: Pick<Project,'requirements'|'containers'|'nodes'|'edges'>): string` is a synchronous FNV-1a 32-bit hex hash of a canonical JSON. It covers requirements, containers, nodes and edges, with `position` and `size` removed and ids sorted. Put it in `project.ts`, or a new `hash.ts` re-exported from index.
- Note: `ai.ts` imports `ModelChoice` from `models.ts`; avoid an import cycle with `project.ts` (toggles.ts must not import ai.ts).

Toggle requirement texts (exact copy):

- serverlessFirst: `Prefer serverless and fully managed services (Lambda, API Gateway, DynamoDB, Fargate, Step Functions) over servers to manage.`
- backups: `Every data store has automated backups or point-in-time recovery; S3 buckets use versioning.`
- disasterRecovery multi-az: `Survive the loss of one Availability Zone: stateful services run Multi-AZ.`
- disasterRecovery cross-region: `Recover in a second AWS Region: data is replicated cross-region and the design can be restored there.`
- highAvailability: `No single point of failure: compute and data are spread across at least two Availability Zones.`
- costOptimized: `Minimize cost: choose the cheapest reasonable options and scale to zero where possible.`
- securityHardening: `Harden security: WAF on public entry points, KMS encryption at rest, private subnets for data, authenticated access on every public interface.`

- [ ] **Step 1: Write failing tests** in `toggles.test.ts`:
  - `toggleRequirements({})` → `[]`.
  - `toggleRequirements({ backups: true, disasterRecovery: 'cross-region' })` → ids `['T-backups','T-dr']`. The `T-dr` text starts with `Recover in a second AWS Region`. Every item has `provenance: 'toggle'` and `status: 'confirmed'`.
  - `toggleLabels({ serverlessFirst: true, disasterRecovery: 'multi-az' })` → `['Serverless-first','DR: Multi-AZ']`.
  - `DesignToggles.safeParse({ fooBar: true }).success === false`.
  - `ContinueRequest` rejects duplicate requirement ids and `requirements: []`.
  - `graphContentHash` is unchanged when only node positions or container sizes change, and changes when a node label changes.

  In `domain.test.ts`: a 1.2.0 project migrates to `'1.3.0'` unchanged otherwise, and `PROJECT_SCHEMA_VERSION === '1.3.0'`.

- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/domain test` → FAIL (missing exports).
- [ ] **Step 3: Implement** the files above. Add the migration `{ from: '1.2.0', to: '1.3.0', up: (p) => ({ ...p, schemaVersion: '1.3.0' }) }` and extend the doc comment.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck` from the repo root → PASS. The gateway, eval and web still compile: the spike writes `PROJECT_SCHEMA_VERSION` and still passes.
- [ ] **Step 5: Commit** `feat(domain): design toggles, AI contract and schema 1.3.0`.

---

### Task 2: Catalog features for toggles + remaining PRD rules VR-002, VR-003, VR-008, VR-011

**Files:**

- Modify: `packages/catalog/data/aws/features.json`, `packages/catalog/data/aws/validation-rules.json`, `packages/domain/src/validation.ts`, `docs/product/prd.md` (§11 note that all VR-001…018 are implemented)
- Test: `packages/domain/src/domain.test.ts`, `packages/catalog/src/catalog.test.ts`

**Interfaces:**

- Produces feature config keys (node-level, value is a string), each as one feature entry per service with a unique `id`:
  - `backup`: `aws.dynamodb` (`aws.dynamodb.pitr`, value `PITR`), `aws.rds` and `aws.aurora` (automated backups), `aws.efs` (AWS Backup), `aws.elasticache` (snapshots), `aws.s3` (`aws.s3.versioning`, value `versioning`).
  - `multiAz`: `aws.rds`, `aws.aurora`, `aws.elasticache`.
  - `replication`: `aws.s3` (cross-region replication), `aws.dynamodb` (global tables), `aws.aurora` (global database), `aws.rds` (cross-region read replica).
  - `encryption`: `aws.s3`, `aws.dynamodb`, `aws.rds`, `aws.aurora`, `aws.efs`, `aws.elasticache`, `aws.sqs`, `aws.sns`; value `KMS` or `AWS-managed`.
  - Every `documentationUrl` is a real docs.aws.amazon.com page for that feature. Open each URL (WebFetch) before committing; never guess.
- Produces `DATA_STORES = ['aws.s3','aws.dynamodb','aws.rds','aws.aurora','aws.efs','aws.elasticache']` exported from `validation.ts` (Task 3 uses it).
- Rule conditions (metadata titles/severities from PRD §11 table):
  - **VR-002 (warning):** an edge whose source is an `external` node of kind `user` or `client-app` and whose target is an S3 node that is also the target of a CloudFront `origin` edge.
  - **VR-003 (warning):** an `aws.apigateway` or `aws.alb` node with an incoming edge from an external node or from `aws.cloudfront`, but none of the following: `configuration.authorizer` on the node, `authorizer` on any incoming edge, or any edge between the node and `aws.cognito`.
  - **VR-008 (info):** a `DATA_STORES` node without `configuration.encryption`.
  - **VR-011 (warning):** an edge of kind `write` from an `external` node to an `aws.s3` node without `configuration.presignedUrl` on the edge, and no edge between that external node and `aws.cognito`.
  - Remove the "Rules not yet implemented" line from the RULES doc comment.

- [ ] **Step 1: Write failing tests.** Each rule gets one positive and one negative fixture in `domain.test.ts`, using the existing `service()`/`catalog` helpers (e.g. `it('VR-003 flags a public API without an authorizer')` and `it('VR-003 accepts an API with authorizer config')`). In `catalog.test.ts`, every feature `id` is unique, and `encryption` exists on all six data stores.
- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/domain test` → the four positive cases FAIL.
- [ ] **Step 3: Implement** the four rules in `validation.ts` (same `Rule` shape, before VR-004 in id order), the feature entries, and the metadata entries if missing.
- [ ] **Step 4: Run** `pnpm test`. The existing test `MyBlog sample passes validation with no errors or warnings` must still pass. If VR-003 or VR-011 fires on the sample, fix the sample's configuration, not the rule, and say so in the commit body. Then run `pnpm eval` → still exits 0.
- [ ] **Step 5: Commit** `feat(domain): VR-002/003/008/011 and data-store feature keys`.

---

### Task 3: Toggle rules VR-019 … VR-025

**Files:**

- Modify: `packages/domain/src/validation.ts`, `packages/catalog/data/aws/validation-rules.json`, `docs/product/prd.md` (§11 table: new rows marked "only when the toggle is enabled")
- Test: `packages/domain/src/domain.test.ts`

**Interfaces:**

- Consumes: `Project.generation.toggles` (Task 1), `DATA_STORES` and the feature keys (Task 2).
- Rules run only when `project.generation?.toggles` enables them; without `generation` they never fire. Each finding links `requirementIds` to the toggle requirement id from `TOGGLE_REQUIREMENT_IDS`:

| Rule   | Runs when                                    | Condition                                                                                                                                                                                       | Severity |
| ------ | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| VR-019 | `serverlessFirst`                            | `aws.ec2`, `aws.rds`, `aws.ecs`, `aws.eks` node not linked to a requirement with `provenance` `user` or `clarification` and `status` `confirmed`                                                | warning  |
| VR-020 | `backups`                                    | `DATA_STORES` node without `configuration.backup`                                                                                                                                               | warning  |
| VR-021 | `disasterRecovery === 'multi-az'`            | `aws.rds`/`aws.aurora`/`aws.elasticache` without `configuration.multiAz`                                                                                                                        | warning  |
| VR-022 | `disasterRecovery === 'cross-region'`        | fewer than 2 `region` containers, or a DATA_STORES node other than EFS/ElastiCache without `configuration.replication`                                                                          | warning  |
| VR-023 | `highAvailability` or any `disasterRecovery` | per VPC: VPC-bound nodes (`VPC_BOUND` + `aws.alb`, `aws.fargate`, `aws.nat-gateway`) not placed in ≥ 2 distinct `availability-zone` containers (also fires when they are in no AZ container)    | warning  |
| VR-024 | `costOptimized`                              | `aws.dax`, `aws.nat-gateway`, `aws.ec2`, `aws.eks` linked to no requirement other than toggle ones                                                                                              | info     |
| VR-025 | `securityHardening`                          | (a) `aws.apigateway`/`aws.alb`/`aws.cloudfront` node with an incoming edge from an external node and no edge to/from `aws.waf`; (b) DATA_STORES node whose `configuration.encryption !== 'KMS'` | warning  |

- [ ] **Step 1: Write failing tests:** a positive and a negative fixture per rule. Include one test that a project with the same violation but **without** `generation` produces none of VR-019…025.
- [ ] **Step 2: Run** domain tests → FAIL.
- [ ] **Step 3: Implement** with a small helper `toggles(ctx): DesignToggles` (returns `{}` when absent). Add metadata entries with titles phrased like the existing ones.
- [ ] **Step 4: Run** `pnpm test` → PASS. The catalog test `has metadata for every implemented rule` covers the new ids.
- [ ] **Step 5: Commit** `feat(domain): validation rules for design toggles (VR-019…025)`.

---

### Task 4: Generator package — LLM client, prices, extraction

**Files:**

- Create: `packages/generator/package.json`, `tsconfig.json`, `src/index.ts`, `src/llm.ts`, `src/prices.ts`, `src/extract.ts`
- Test: `packages/generator/src/extract.test.ts`, `src/prices.test.ts`
- Modify: `pnpm-lock.yaml` (via `pnpm install`)

**Interfaces:**

- Produces (`llm.ts`):
  ```ts
  export interface TokenUsage {
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
  }
  export interface LlmRequest {
    model: string;
    system: string;
    maxTokens: number;
    format: unknown; // value of output_config.format
    messages: { role: 'user' | 'assistant'; content: string }[];
    signal?: AbortSignal;
  }
  export interface LlmResponse {
    text: string;
    usage: TokenUsage;
    stopReason: string | null;
  }
  export type LlmClient = (req: LlmRequest) => Promise<LlmResponse>;
  export function anthropicClient(apiKey: string): LlmClient; // @anthropic-ai/sdk, maxRetries 2, system as one cached text block (cache_control ephemeral), as in spike.ts
  export interface CallUsage {
    model: string;
    usage: TokenUsage;
    costMicroUsd: number;
  }
  ```
- Produces (`prices.ts`):
  - `PRICES`: USD per MTok keyed by model id, copied from `eval/src/spike.ts` `MODELS` with its source-URL comment. Haiku, Sonnet and Opus 5.5.
  - `costMicroUsd(model: string, u: TokenUsage): number`: integer, `Math.ceil`. It throws for an unknown model.
  - `EXTRACTION_MODEL = 'claude-haiku-5-5'`.
- Produces (`extract.ts`):
  ```ts
  export const Extraction: z.ZodObject; // { name: string; requirements: {id,text,type,status: 'confirmed'|'inferred'}[]; assumptions: string[]; questions: {topic: GapTopic, text, suggestions: string[]}[] }
  export interface ExtractInput {
    prompt: string;
    toggles: DesignToggles;
    signal?: AbortSignal;
  }
  export interface ExtractResult {
    name: string;
    requirements: Requirement[];
    assumptions: string[];
    questions: Question[];
    usage: CallUsage[];
  }
  export function allowedTopics(t: DesignToggles): GapTopic[]; // drops 'availability-target' when highAvailability or disasterRecovery is set
  export async function extract(llm: LlmClient, input: ExtractInput): Promise<ExtractResult>;
  ```
  - One call on `EXTRACTION_MODEL`, `maxTokens: 4000`, format `zodOutputFormat(Extraction)`. The schema's topic enum is `allowedTopics(toggles)`.
  - The system prompt says:
    - Extract confirmed and inferred requirements close to the user's wording.
    - Ask only about the listed gap topics, and only where best practice says the request is incomplete or very broad and the answer would change the architecture.
    - Each question gets 2–4 concrete suggestions.
    - No filler questions. Ask zero questions when the request is clear.
    - The enabled toggles (passed as a list) are already decided; don't ask about them.
  - Post-processing:
    - Drop questions whose topic is not allowed.
    - Keep the first question per topic, and at most 3 questions.
    - Requirements get `provenance: 'ai'`.
    - On a schema-invalid response, throw `GenerationError('schema_invalid', usage)`, exported from `llm.ts`; the class carries `usage: CallUsage[]`.
- Dependencies: `@anthropic-ai/sdk` at the same version as `eval/package.json` (`^0.133.0`, moved to `dependencies`), `@cloudarchitect/domain`, `@cloudarchitect/catalog`, `zod`.

- [ ] **Step 1: Write failing tests** with a fake `LlmClient` that records requests and returns canned JSON:
  - `extract returns questions with stable topics and caps them at 3`: the fake returns 5 questions, two of them `auth-methods` → result has 3, with topics unique.
  - `extract drops availability-target when highAvailability is on`: `allowedTopics({ highAvailability: true })` excludes it, and a returned `availability-target` question is dropped.
  - `extract always uses Haiku`: the recorded request has `model === 'claude-haiku-5-5'`.
  - `extract throws GenerationError on invalid JSON` and the error carries usage.
  - `costMicroUsd('claude-haiku-5-5', {input:1e6, output:0, cacheWrite:0, cacheRead:0}) === 100000`.
- [ ] **Step 2: Run** `pnpm install && pnpm --filter @cloudarchitect/generator test` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `pnpm ci` → PASS.
- [ ] **Step 5: Commit** `feat(generator): LLM client, price table and requirement extraction`.

---

### Task 5: Generator — architecture generation with repair turn

**Files:**

- Create: `packages/generator/src/generate.ts`, `src/contract.ts` (the `Generation` schema and `toProject`, ported from `eval/src/spike.ts`)
- Test: `packages/generator/src/generate.test.ts`
- Do not modify `eval/src/spike.ts`. It stays as the frozen Phase 0 reproduction.

**Interfaces:**

- Consumes: `LlmClient`, `CallUsage`, `GenerationError`, `costMicroUsd` (Task 4); `toggleRequirements`, `graphContentHash`, `Question`, `YOU_DECIDE` (Task 1); `validateProject`.
- Produces:
  ```ts
  export interface GenerateInput {
    prompt: string;
    toggles: DesignToggles;
    model: ModelChoice;
    name: string;
    requirements: Requirement[];
    assumptions: string[];
    questions: Question[];
    answers: Partial<Record<GapTopic, string>>;
    signal?: AbortSignal;
    now?: Date;
  }
  export interface GenerateResult {
    project: Project;
    usage: CallUsage[];
  }
  export function buildRequirements(
    input: Pick<GenerateInput, 'requirements' | 'questions' | 'answers' | 'toggles'>,
  ): Requirement[];
  export async function generateArchitecture(
    llm: LlmClient,
    catalog: CatalogSnapshot,
    input: GenerateInput,
  ): Promise<GenerateResult>; // throws GenerationError('schema_invalid', usage)
  ```
- `buildRequirements` returns, in order:
  1. the given requirements;
  2. for each question:
     - answered → `{ id: 'C-<topic>', text: '<question text> <answer>', status: 'confirmed', provenance: 'clarification' }`;
     - `YOU_DECIDE` or unanswered → the same id with `status: 'inferred'` and text `'<question text> (decided by the architect)'`;
  3. `toggleRequirements(toggles)`.
- Generation contract: port `Generation` from spike.ts, but **without** `requirements` and `openQuestions`. It adds `inferredRequirements: {id,text,type}[]` (ids must start with `I`) and keeps `assumptions`. The user message lists the fixed requirements as `id: text` and says that every node and edge must reference these ids or the inferred ones.
- System prompt: port spike.ts `SYSTEM` rules 2–9 and the catalog text. Rule 1 becomes: "The requirements are fixed; add `inferredRequirements` only for important implied needs." Add rule 10: "Requirements whose id starts with `T-` are design priorities the user enabled. Honour each one: set `backup`, `multiAz`, `replication` or `encryption` configuration where they ask for it. When none are present, keep the simplest design (rule 3)." Keep the cached system block identical across calls, so prompt caching works.
- Repair: if `modelOption(model).repairTurns > 0` and `validateProject` on the draft (with `generation.toggles` set) has non-info findings, send one repair turn with the spike's exact repair message.
- Output `Project`:
  - `projectId: 'generated'`, `revision: 0`, positions `{x:0,y:0}`;
  - `requirements = buildRequirements(...)` plus the inferred ones (`status: 'inferred'`, `provenance: 'ai'`);
  - `findings: []`;
  - `generation: { toggles, model, generatedAt: (now ?? new Date()).toISOString(), contentHash: graphContentHash(project) }`.

  Parse it through `Project.parse`; a failure there throws `GenerationError('schema_invalid', usage)`.

- [ ] **Step 1: Write failing tests** with a fake LLM:
  - `buildRequirements maps answers, you-decide and toggles`: answers `{ 'auth-methods': 'Email and Google' }` plus a `notifications` question left unanswered, with `{ backups: true }` → ids `[...given, 'C-auth-methods', 'C-notifications', 'T-backups']`, statuses `confirmed, inferred, confirmed`.
  - `generateArchitecture runs one repair turn for Haiku when warnings exist`: the first canned graph has an SQS→Lambda event edge without a DLQ (VR-004); the second is fixed → 2 LLM calls, and the result has no VR-004.
  - `generateArchitecture does not repair for Sonnet` → 1 call.
  - `generated project carries generation metadata and a content hash equal to graphContentHash(project)`.
  - `throws GenerationError when the repaired output is still schema-invalid`, carrying the usage of both calls.
- [ ] **Step 2: Run** generator tests → FAIL.
- [ ] **Step 3: Implement**, exporting from `index.ts`.
- [ ] **Step 4: Run live smoke (spends ≈ $0.02).** Add a dev script `packages/generator/scripts/smoke.ts`: it reads `.env`, then runs extract + generate for the myblog prompt with `{ backups: true }`, and prints the question topics, node count, findings by rule and total cost. Run it once. Expected: a schema-valid project and no VR-020 finding. Report the cost.
- [ ] **Step 5: Run** `pnpm ci` → PASS. **Commit** `feat(generator): constrained architecture generation with repair turn`.

---

### Task 6: Gateway — signed operation token

**Files:**

- Create: `apps/gateway/src/operation-token.ts`
- Test: `apps/gateway/src/operation-token.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export interface OperationState {
    operationId: string;
    clientKey: string;
    model: ModelChoice;
    toggles: DesignToggles;
    prompt: string;
    name: string;
    requirements: Requirement[];
    assumptions: string[];
    questions: Question[];
    exp: number; // epoch ms
  }
  export const OPERATION_TTL_MS = 15 * 60_000;
  export async function signOperation(state: OperationState, secret: string): Promise<string>; // base64url(JSON) + '.' + base64url(HMAC-SHA256)
  export async function verifyOperation(
    token: string,
    secret: string,
    now?: number,
  ): Promise<OperationState>; // throws OperationTokenError('invalid' | 'expired')
  ```
- Uses Web Crypto (`crypto.subtle`, HMAC SHA-256) only, so it runs on Workers and Node. The key derives from config: the secret is `` `operation-token:${CLIENT_KEY_SALT}` `` (no new config key). Verify the signature with a constant-time comparison (`crypto.subtle.verify`).

- [ ] **Step 1: Write failing tests:** round-trip; a flipped payload byte → `invalid`; `now > exp` → `expired`; a different secret → `invalid`; a malformed string without `.` → `invalid`.
- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/gateway test` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(gateway): HMAC-signed operation tokens for the clarification round`.

---

### Task 7: Gateway — real `/api/ai/generate` and `/api/ai/generate/continue`

**Files:**

- Create: `apps/gateway/src/generate.ts`
- Modify: `apps/gateway/src/app.ts` (replace the `aiOperation(GenerateBody)` and continue routes; keep edit/review/ask at 501), `apps/gateway/package.json` (add `@cloudarchitect/generator`), `docs/product/technical-architecture.md` §5–6 (concrete contract, token, charging rules)
- Test: `apps/gateway/src/generate.test.ts`. Update `app.test.ts` expectations that assumed `501` for generate.

**Interfaces:**

- Consumes: `GenerateRequest`, `ContinueRequest`, `GenerateResponse` (Task 1); `extract`, `generateArchitecture`, `GenerationError`, `LlmClient`, `anthropicClient` (Tasks 4–5); `signOperation`/`verifyOperation` (Task 6); `CreditStore`.
- Produces: `Deps.llm?: (apiKey: string) => LlmClient` (default `anthropicClient`), and `registerGenerateRoutes(app, deps)` in `generate.ts`.
- Route behaviour, in order. Keep the existing checks: `invalid_request` 400, `setup_required` 503, `model_not_enabled` 403, `free_ai_unavailable` 503, `no_credits` 402.
  - **`/generate`:**
    1. `extract`.
    2. If questions exist or `reviewRequirements` is set → `200 { status: 'questions', operationId: crypto.randomUUID(), operationToken, requirements, assumptions, questions }`, with no credit charged.
    3. Otherwise → `generateArchitecture` with no answers → charge → `200 { status: 'done', project, usage: { costUsd } }`.
  - **`/continue`:**
    1. Validate the body.
    2. `verifyOperation`: invalid → `400 invalid_operation`; expired → `410 operation_expired`.
    3. `state.clientKey !== clientKey` or `state.operationId !== body.operationId` → `400 invalid_operation`.
    4. Re-check the credit, kill switch and `model_not_enabled` against `state.model`.
    5. Generate with `body.requirements` (each marked `provenance: 'user'` when its text differs from the token's requirement with the same id, or when the id is new), otherwise the token's requirements.
    6. Charge → `done`.
  - **Charging:**
    - After every model call, `store.addSpend(sum costMicroUsd)`, including failures and extraction-only operations.
    - Credit: only after a schema-valid project, and only if `c.req.raw.signal.aborted` is false. Then `store.consume(clientKey)`; if that returns false → `402 no_credits` and **no project in the body**.
  - **Failures:**
    - `GenerationError('schema_invalid')` → `502 generation_failed`, no credit.
    - Anthropic SDK errors (any thrown non-`GenerationError`) → `502 provider_error`, no credit.
  - **Logging:** each AI request logs one event: `{ requestId, event: 'ai_generate' | 'ai_continue', model, calls, inputTokens, outputTokens, costMicroUsd, outcome }`. Nothing else.
  - The `catalogVersion` mismatch with `awsCatalog.manifest.catalogVersion` → `409 catalog_mismatch`.

- [ ] **Step 1: Write failing tests** in `generate.test.ts` with a fake `llm` factory (canned extraction and graph JSON, call counter) and `MemoryCreditStore`:
  - `generate without questions returns a project and charges one credit` (remaining 3→2; spend > 0).
  - `generate with questions returns a token and charges nothing; continue returns the project and charges once`.
  - `continue with edited requirements uses them and marks changed ones as user provenance`.
  - `continue rejects a token from another client` (different `x-forwarded-for`) → 400 `invalid_operation`, LLM not called.
  - `continue rejects an expired token` → 410 (inject `now` via a `Deps.now?: () => number` used by verify).
  - `continue rejects duplicate edited requirement ids` → 400 `invalid_request`, LLM not called.
  - `two parallel generates with one credit: exactly one 200 done, one 402 without a project`, with spend counted for both.
  - `aborted request is not charged`: the fake LLM aborts the request's `AbortController` before resolving; remaining unchanged and spend recorded.
  - `schema-invalid output returns 502 generation_failed and no charge`.
  - `logs contain no prompt text`: assert that `JSON.stringify(logs)` does not include the prompt string or any requirement text.
- [ ] **Step 2: Run** gateway tests → FAIL.
- [ ] **Step 3: Implement** and update `app.ts`. Keep the comment on edit/review/ask that they are Phase 3.
- [ ] **Step 4: Run** `pnpm ci` → PASS. Then `pnpm --filter @cloudarchitect/gateway build` and run the built `node dist/node.js` once with `FREE_AI_DISABLED=true` → it starts. The Worker build still type-checks (`wrangler deploy --dry-run` if available offline; otherwise typecheck only, and say so).
- [ ] **Step 5: Commit** `feat(gateway): AI generation with clarification round, credits and spend`.

---

### Task 8: Eval — live generator run, toggle scenarios, regression gate

**Files:**

- Create: `eval/src/live.ts`, `eval/src/gate.ts`, and 7 scenario files: `eval/scenarios/myblog-backups.json`, `saas-containers-multi-az.json`, `order-events-cross-region.json`, `nightly-reports-serverless.json`, `k8s-microservices-ha.json`, `product-search-cost.json`, `regulated-portal-security.json`
- Modify: `eval/src/harness.ts`, `eval/package.json` (script `"live": "tsx src/live.ts"`, dependency `@cloudarchitect/generator`), root `package.json` (script `"eval:live": "pnpm --filter @cloudarchitect/eval run live"`), `docs/engineering/testing.md`
- Test: `eval/src/harness.test.ts`, `eval/src/gate.test.ts`

**Interfaces:**

- `Scenario` adds:
  - `toggles: DesignToggles.default({})`
  - `answers: z.partialRecord(GapTopic, z.string()).default({})`
  - `forbiddenRules: z.array(z.string()).default([])`
- `ScenarioResult` adds `forbiddenRuleHits: string[]`. `passed` also requires it to be empty. The rule ids come from `validateProject(p, awsCatalog)`.
- Each toggle scenario copies `prompt`, `expectedRequirements` and `expectedServices` from its base scenario (the file name without the suffix), then sets:

  | Scenario                   | Toggle                             | `forbiddenRules` |
  | -------------------------- | ---------------------------------- | ---------------- |
  | myblog-backups             | `backups`                          | VR-020           |
  | saas-containers-multi-az   | `disasterRecovery: 'multi-az'`     | VR-021, VR-023   |
  | order-events-cross-region  | `disasterRecovery: 'cross-region'` | VR-022           |
  | nightly-reports-serverless | `serverlessFirst`                  | VR-019           |
  | k8s-microservices-ha       | `highAvailability`                 | VR-023           |
  | product-search-cost        | `costOptimized`                    | VR-024           |
  | regulated-portal-security  | `securityHardening`                | VR-025           |

  If a base scenario's expectations contradict the toggle (e.g. a required EC2 under serverless-first), adjust that toggle scenario only and note it in the file `title`.

- `gate.ts`:
  - `export interface LiveSummary { model: string; runs: number; schemaValidRate: number; passRate: number; forbiddenServiceHits: number; meanCostUsd: number; medianLatencyS: number; totalCostUsd: number }`
  - `export const LIVE_GATE = { schemaValidRate: 1, passRate: 0.9, forbiddenServiceHits: 0, maxCostFactor: 1.5 }`
  - `export function evaluateGate(s: LiveSummary, benchmarkCostUsd: number): { passed: boolean; failures: string[] }`. Use `modelOption('haiku').benchmark.costPerOperationUsd` as the benchmark.
- `live.ts` CLI: `--models haiku` (default `haiku`), `--repeats 1`, `--scenarios`, `--concurrency 4`, `--max-usd 0.50`, `--gate`.
  - For each job: `extract`, answer every question from `scenario.answers[topic]` or `YOU_DECIDE`, then `generateArchitecture`. Score with `scoreCandidate`. Cost is the sum of `costMicroUsd`.
  - Stop scheduling new jobs when spend reaches `--max-usd`. A run cut short by the cap fails the gate.
  - Write `eval/results/live/<runId>/{records.json,summary.json}` and print a table.
  - With `--gate`: `evaluateGate` per model, and exit 1 on any failure.
  - Without `ANTHROPIC_API_KEY`: print `ANTHROPIC_API_KEY not set — live eval skipped` and exit 0.

- [ ] **Step 1: Write failing tests:**
  - `harness.test.ts`: `scoreCandidate fails a candidate that hits a forbidden rule`. Build a project with `generation.toggles.backups` and a DynamoDB node without `backup`, with `forbiddenRules: ['VR-020']` → `forbiddenRuleHits = ['VR-020']`, `passed = false`.
  - `gate.test.ts`:
    - passes at `{schemaValidRate:1, passRate:0.91, cost 0.009}`;
    - fails at schema 0.95, at pass 0.85, and at cost `0.0061*1.5 + 0.0001`;
    - every failure is listed.
  - All scenario files parse (extend the existing scenario-parse test if present, else add one).
- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/eval test` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Live run (spends ≈ $0.20):** `pnpm eval:live --gate`. Expected: a summary table with 22 runs and the gate verdict. If the gate fails, adjust the prompt in `packages/generator` (not the thresholds), then re-run only the failing scenarios (`--scenarios`). Stop and report to the PO if total phase spend would pass $2.00 at this point. Report spend.
- [ ] **Step 5: Run** `pnpm ci` → PASS. **Commit** `feat(eval): live generator run, toggle scenarios and regression gate`.

---

### Task 9: CI — live eval workflow

**Files:**

- Create: `.github/workflows/live-eval.yml`
- Modify: `docs/engineering/testing.md` (how and when it runs, and what it costs)

**Interfaces:**

- Triggers:
  - `pull_request` with `paths`: `packages/generator/**`, `packages/catalog/data/**`, `packages/domain/src/models.ts`, `packages/domain/src/validation.ts`, `eval/scenarios/**`, `eval/src/live.ts`, `eval/src/gate.ts`;
  - `workflow_dispatch` with inputs `models` (default `haiku`), `repeats` (default `1`), `max_usd` (default `0.50`).
- `permissions: contents: read`. `concurrency: { group: live-eval-${{ github.ref }}, cancel-in-progress: true }`. `timeout-minutes: 20`.
- Steps: the same pinned checkout/pnpm/setup-node SHAs as `ci.yml`'s `eval` job, then `pnpm install --frozen-lockfile`, then `pnpm eval:live --gate --models … --repeats … --max-usd …`. `ANTHROPIC_API_KEY` comes from `secrets.ANTHROPIC_API_KEY`. Upload `eval/results/live/` as an artifact.
- When the secret is empty (forks, Dependabot), the script's skip path exits 0. Do not add this workflow to required checks (path-filtered workflows cannot be required).

- [ ] **Step 1:** Write the workflow. Lint it with `actionlint` if installed; otherwise check the YAML with `pnpm prettier --check .github/workflows/live-eval.yml`.
- [ ] **Step 2:** Push the branch and open a **draft PR** to `main` titled `feat: Phase 2 AI generation (draft)` (body ends with the attribution line). The PR touches generator paths, so the workflow runs. Watch it with `gh run watch` → green, about $0.20 spent. Report spend.
- [ ] **Step 3: Commit** `ci: live eval on generator, catalog and model changes` (commit before pushing in Step 2).

---

### Task 10: Web — API client and versions store

**Files:**

- Create: `apps/web/src/versions.ts`
- Modify: `apps/web/src/api.ts`, `apps/web/src/storage.ts` (DB version 2), `apps/web/src/models.tsx` (export `readModelChoice()`)
- Test: `apps/web/src/versions.test.ts`

**Interfaces:**

- `api.ts` adds:
  - `generate(body: GenerateRequestInput, signal?: AbortSignal): Promise<GenerateResponse>`
  - `continueGenerate(body: ContinueRequestInput, signal?: AbortSignal): Promise<GenerateResponse>`

  Types come from `@cloudarchitect/domain` (`z.input<typeof GenerateRequest>` etc.); `request()` gains a `signal` passthrough.

- `models.tsx`: `export function readModelChoice(): ModelChoice | undefined` reads `localStorage['cloudarchitect.model']` in a try/catch.
- `versions.ts`:
  ```ts
  export interface ProjectVersion {
    projectId: string;
    createdAt: string;
    label: string;
    toggles: DesignToggles;
    project: Project;
  }
  export interface VersionStore {
    list(projectId: string): Promise<ProjectVersion[]>;
    put(v: ProjectVersion): Promise<void>;
    remove(projectId: string, createdAt: string): Promise<void>;
  }
  export const MAX_VERSIONS = 10;
  export function versionLabel(at: Date, toggles: DesignToggles): string; // 'HH:MM' (24h, local time), plus ' · ' + toggleLabels joined by ', ' when any are on
  export async function saveVersion(
    store: VersionStore,
    project: Project,
    now?: Date,
  ): Promise<ProjectVersion>; // puts, then prunes the oldest beyond MAX_VERSIONS; list() returns newest first
  export type ReplaceDecision = 'replace' | 'confirm-edits';
  export function replaceDecision(current: Project | undefined): ReplaceDecision; // 'confirm-edits' only when current.generation exists and graphContentHash(current) !== current.generation.contentHash
  export class MemoryVersionStore implements VersionStore {}
  export const idbVersionStore: VersionStore; // object store 'versions', keyPath ['projectId','createdAt'], index 'byProject' on projectId
  ```
- `storage.ts`: `indexedDB.open(DB_NAME, 2)`. `onupgradeneeded` creates `projects` and `versions` only when they are missing (`objectStoreNames.contains`), so existing v1 databases upgrade in place. Export the shared `open()` for `versions.ts`.
- The version label uses the toggles of the project being saved (`project.generation?.toggles ?? {}`).

- [ ] **Step 1: Write failing tests** (pure, using `MemoryVersionStore`; no DOM):
  - `saveVersion keeps the newest 10`: save 12 versions with increasing `now` → `list` has 10, newest first; the two oldest are gone.
  - `versionLabel formats time and toggles`: `new Date(2026,9,18,14,32)` + `{ serverlessFirst: true, backups: true }` → `'14:32 · Serverless-first, Backups'`; with `{}` → `'14:32'`.
  - `replaceDecision`:
    - `undefined` → `replace`;
    - a sample without generation → `replace`;
    - a generated project with only positions moved → `replace`;
    - a generated project with a renamed node → `confirm-edits`.
  - `saveVersion propagates store failures`: a store whose `put` rejects → `saveVersion` rejects. The App relies on this for Review Focus 4.
- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/web test` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `pnpm ci` → PASS.
- [ ] **Step 5: Commit** `feat(web): AI generate client and project versions store`.

---

### Task 11: Web — Generate panel, toggles, clarification card, versions UI

**Files:**

- Create: `apps/web/src/GeneratePanel.tsx`, `apps/web/src/ClarifyCard.tsx`, `apps/web/src/VersionsPanel.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/styles.css`, `tools/screenshots.ts` (mock `/api/ai/generate` and `/continue`, and add a screenshot of the clarification card), `README.md` (status line: AI generation works; Phase 2), `CHANGELOG.md` (Unreleased: Added)
- Test: manual and screenshot verification. The web package has no DOM test setup, and this plan does not add one; the logic lives in Task 10.

**Interfaces:**

- Consumes: `api.generate`/`continueGenerate`, `readModelChoice`, `saveVersion`, `replaceDecision`, `idbVersionStore`, `versionLabel` (Task 10); `toggleLabels`, `DesignToggles`, `YOU_DECIDE`, `Question` (Task 1).
- `GeneratePanel` props: `{ hasDiagram: boolean; busy: boolean; onGenerate(input: { prompt: string; toggles: DesignToggles; reviewRequirements: boolean }): void; onCancel(): void; stage?: string }`.
  - A textarea with a character counter up to 8000.
  - Six toggle chips (`aria-pressed`). Disaster recovery cycles Off → Multi-AZ → Cross-region → Off and shows its current value.
  - A checkbox "Review requirements before drawing".
  - When `hasDiagram`: the line **"Generating replaces the current diagram. The current one is kept in Versions."** (exact copy).
  - While busy: the stage text and a Cancel button.
- `ClarifyCard` props: `{ questions: Question[]; requirements: Requirement[]; assumptions: string[]; onContinue(answers: Partial<Record<GapTopic,string>>, requirements: Requirement[]): void; onCancel(): void }`.
  - Per question: suggestion chips, a "You decide" chip (selected by default) and a free-text field.
  - An editable requirements list: edit text, delete, and add (new ids `U1`, `U2`, …).
  - Buttons "Skip questions" (all you-decide) and "Continue".
- `VersionsPanel` props: `{ versions: ProjectVersion[]; onRestore(v: ProjectVersion): void }`. A side-panel section "Versions (n)" lists labels newest first.
- App flow (`App.tsx`):
  1. **Generate.** Call `api.generate` with `catalogVersion: awsCatalog.manifest.catalogVersion` and `model: readModelChoice()`. Show stage text: "Reading your requirements…", switching to "Designing…" after 8 s, then "Checking…" while layout runs.
  2. **Questions.** On `questions`, show `ClarifyCard`. Continue calls `api.continueGenerate`.
  3. **Replace step on `done`:**
     - `replaceDecision(current) === 'confirm-edits'` → an in-app dialog (not `window.confirm`): "You edited this diagram by hand. Replace it? Your edited version is kept in Versions." with Replace / Cancel.
     - Then `saveVersion(idbVersionStore, current)`. If that throws → dialog: "Could not keep a copy of the current diagram in browser storage. Export it as JSON first, or replace it anyway?" with Export JSON / Replace anyway / Cancel.
     - Then `commit({ ...migrateProject(res.project), projectId: current?.projectId ?? res.project.projectId, revision: (current?.revision ?? 0) + 1 }, true)`.
     - Show the toast **"New diagram generated · Restore previous"**; Restore re-applies the version just saved (after saving the current one as a version too).
  4. **Restore from Versions.** Save the current diagram as a version, then commit the chosen one.
  5. **Cancel.** `AbortController.abort()`, back to idle, and show "Generation cancelled — no credit used."
  6. **Errors.** Map these codes to plain messages, keeping manual editing available:
     - `no_credits`: "Free generations used up. Bring your own key arrives in a later version."
     - `model_not_enabled`: "This model needs your own API key."
     - `free_ai_unavailable`: "AI generation is paused right now. Manual editing still works."
     - `setup_required`: points to the setup notice.
     - `generation_failed` / `provider_error`: "Generation failed — no credit used. Try again."
     - `operation_expired`: "The questions expired. Generate again."
     - `catalog_mismatch`: "Reload the page to get the latest service catalog."

- [ ] **Step 1: Implement** the components and the App wiring. Styling follows `styles.css` tokens and works in light and dark mode.
- [ ] **Step 2: Run** `pnpm ci` → PASS.
- [ ] **Step 3: Verify in the real app** with the `run` skill: `pnpm dev` with the gateway on the real key, myblog prompt, Backups on. Check each of these:
  - questions appear (or the review pause when the checkbox is set);
  - Continue draws a diagram with backup config;
  - the Versions list shows the previous diagram;
  - Restore previous works;
  - renaming a node and generating again shows the confirm dialog;
  - Cancel mid-run shows the cancelled message.

  Spends ≈ $0.03; report it. Then run `pnpm screenshots` and check the new images.

- [ ] **Step 4: Commit** `feat(web): generate panel, design toggles, clarification and versions`.

---

### Task 12: Gate A — live benchmark, blind review, benchmark update

**Files:**

- Create: `docs/product/phase2-gate-a.md`, `eval/reviews/phase2-gate-a-2026-10-<dd>/` (`key.json` plus `review-g*.json`, same format as `eval/reviews/phase0-round2-2026-10-14/`)
- Modify: `packages/domain/src/models.ts` (`ROUND_3` → a new Phase 2 measurement constant; benchmark numbers from this run only), `docs/product/roadmap.md` (Phase 2 status), `CHANGELOG.md`

**Interfaces:**

- Consumes: `pnpm eval:live` (Task 8), the Phase 0 blind-review procedure (anonymized A/B packets, isolated Claude reviewer sessions, PRD §14 rubric). See `docs/product/phase0-spike.md` for the procedure and packet format.

- [ ] **Step 1: Budget check.** Sum the spend reported so far and add the planned Haiku run (≈ $0.40) and Sonnet run (≈ $1.30). If the total would pass $4.50, ask the PO before running.
- [ ] **Step 2: Run** `pnpm eval:live --gate --models haiku --repeats 2 --max-usd 0.80`, then `pnpm eval:live --models sonnet --repeats 1 --max-usd 1.60 --scenarios <the 15 base scenario ids>`. Expected: the Haiku gate passes. Report the actual spend.
- [ ] **Step 3: Blind review.**
  - Choose ≥ 10 distinct scenarios, at least 3 of them toggle scenarios.
  - Build anonymized packets (Haiku vs Sonnet outputs as A/B, plus the prompt, toggles and answers).
  - Dispatch one isolated reviewer subagent per packet with the PRD §14 rubric. Reviewers must not see model names or this plan.
  - Save the reviews and the key.
- [ ] **Step 4: Write** `docs/product/phase2-gate-a.md`, covering:
  - the metrics table per model;
  - the rubric medians and critical/major defects;
  - toggle effects (forbidden-rule hits per toggle scenario);
  - total spend;
  - the verdict against Gate A (Haiku median ≥ 2.0, no critical defect in ≥ 90%, live gate green).

  Wording: "isolated Claude reviewer sessions", never "expert review".

- [ ] **Step 5:** Update `MODEL_OPTIONS` benchmarks from this run (Haiku and Sonnet), the roadmap Phase 2 row status and the CHANGELOG. `pnpm ci` → PASS. The live eval re-runs on the PR because `models.ts` changed; accept that ≈ $0.20.
- [ ] **Step 6: Commit** `docs: Phase 2 Gate A results and updated model benchmarks`. Mark the draft PR ready for review and tell the PO it is ready to merge.
