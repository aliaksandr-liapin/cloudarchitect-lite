# Settings Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Settings section in Details that lets a user add, change and remove the catalog
settings (`configuration` keys) of the selected component or connector, so setting-based findings
can be cleared by hand.

**Architecture:** The row list and the edit ops are pure functions in a new `apps/web/src/settings.ts`
(unit-tested); `Details.tsx` renders them and sends ops through the existing `onEdit` → `commit()`
path, so undo, saving, findings and exports need no change. The catalog gains an optional `values`
list per feature for fixed choices; the AI prompt does not change.

**Tech Stack:** TypeScript, React 19, zod, vitest (`renderToStaticMarkup` for markup tests),
Playwright e2e (`e2e/tests/claude.spec.ts`).

**Spec:** `docs/superpowers/specs/2026-11-24-settings-editor-design.md`

## Global Constraints

- Only catalog keys can be added; no user-typed keys. No settings on containers.
- Never write placeholder values ("none", "disabled", "false"); a blank value removes the key.
- Connector **Auth notes** must not clear VR-003 (no rule change in this plan).
- The generator's system prompt stays byte-identical (`contractFor(awsCatalog).system`).
- Encryption `values`: exactly `["KMS", "AWS-managed"]` (all 8 encryption features). API type
  `values`: exactly `["REST", "HTTP", "WEBSOCKET"]` (`aws.apigateway.api-type`).
- Text values max 200 characters, committed on blur or Enter (the existing `Field`).
- All repo content in English. `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test` pass.

## Review Focus

1. **Configuration becoming empty:** removing the last key must drop `configuration` (no `{}` left
   behind), so an untouched-looking design exports like before. → Task 2 test
   `removing the last setting drops configuration`.
2. **Imported non-string values** (`multiAz: true`, `backup: 7`): shown as text, not rewritten
   unless edited, and removable. → Task 2 test `non-string values are shown as text and kept`.
3. **A key valid for another service** (`encryption` on a Lambda node) must land under "not in
   catalog", not as a row. → Task 2 test `a key of another service is not in catalog`.
4. **Connector between two catalog services that both have edge features** (S3 → Lambda: S3
   `eventNotification`, Lambda `failureDestination`) shows both rows. → Task 2 test
   `connector rows come from both ends`.
5. **Whitespace-only text** counts as blank and removes the key; values are trimmed. → Task 2 test
   `blank or whitespace removes the key`.

---

### Task 1: Catalog `values` for fixed choices

**Files:**

- Modify: `packages/domain/src/catalog.ts` (`ServiceFeature`)
- Modify: `packages/catalog/data/aws/features.json`
- Test: `packages/catalog/src/catalog.test.ts`, `packages/generator/src/contract.test.ts`

**Interfaces:**

- Produces: `ServiceFeature.values?: string[]` (zod: `z.array(z.string().min(1)).min(1).optional()`).

- [ ] **Step 1: Pin the prompt before touching the catalog.** In `contract.test.ts` add
      `it('system prompt is unchanged by feature values')`: compute the sha256 of
      `contractFor(awsCatalog).system` and compare it with the hash printed on the current main
      (run once, paste the literal). Run `pnpm --filter @cloudarchitect/generator test` → PASS.
- [ ] **Step 2: Write the failing catalog tests** in `catalog.test.ts`:

```ts
it('fixed choices: encryption and API type', () => {
  const enc = awsCatalog.features.filter((f) => f.configKey === 'encryption');
  expect(enc).toHaveLength(8);
  for (const f of enc) expect(f.values, f.id).toEqual(['KMS', 'AWS-managed']);
  expect(awsCatalog.features.find((f) => f.id === 'aws.apigateway.api-type')?.values).toEqual([
    'REST',
    'HTTP',
    'WEBSOCKET',
  ]);
  expect(awsCatalog.features.filter((f) => f.values).length).toBe(9);
});
```

Plus: `KMS clears VR-025 and VR-008` — a DynamoDB node with `configuration: { encryption: 'KMS' }`
has neither finding from `validateProject`; with `'AWS-managed'` it has no VR-008.

- [ ] **Step 3: Run** `pnpm --filter @cloudarchitect/catalog test` → FAIL (`values` undefined).
- [ ] **Step 4: Implement:** add `values` to `ServiceFeature`; add the arrays to the 9 features in
      `features.json`. Do not edit any `summary`.
- [ ] **Step 5: Run** catalog, domain and generator tests → PASS (prompt hash unchanged).
- [ ] **Step 6: Commit** `feat(catalog): fixed values for encryption and API type features`.

### Task 2: Pure settings model

**Files:**

- Create: `apps/web/src/settings.ts`
- Test: `apps/web/src/settings.test.ts`

**Interfaces:**

- Consumes: `ServiceFeature.values` (Task 1).
- Produces:

```ts
export type SettingRow = {
  key: string; // configKey
  feature: ServiceFeature; // first feature in catalog order for this key and element
  value?: string; // current value as text; undefined when unset
};
export type SettingsView = { rows: SettingRow[]; other: { key: string; value: string }[] };
export function settingsView(
  project: Project,
  selection: Selection,
  catalog: CatalogSnapshot,
): SettingsView | undefined;
export function setSettingOps(
  project: Project,
  selection: Selection,
  key: string,
  value: string,
): PatchOp[];
```

`settingsView` returns `undefined` for containers and unknown ids. `setSettingOps` trims `value`;
blank removes the key; returns `[]` when nothing changes; otherwise one `updateNode`/`updateEdge`
op with `changes: { configuration }` (the whole new object), or `changes: { configuration: undefined }`
when it becomes empty. `Selection` is the type exported by `Details.tsx`; move it into
`settings.ts` only if an import cycle appears.

- [ ] **Step 1: Write the failing tests** (`settings.test.ts`), building small projects inline:
  - `node rows follow the catalog`: DynamoDB node → row keys `['backup', 'replication', 'encryption']`
    in catalog order (assert against `awsCatalog.features` filtered the same way, not a literal, and
    that `encryption` is included); `encryption` row has `feature.values` set.
  - `connector rows come from both ends`: SQS → Lambda edge rows include `deadLetterQueue` and
    `failureDestination`; S3 → Lambda includes `eventNotification` and `failureDestination`.
  - `external and unresolved nodes have no rows`: rows `[]`, `other` lists their keys.
  - `a key of another service is not in catalog`: Lambda node with `{ encryption: 'KMS' }` → no
    `encryption` row; `other` = `[{ key: 'encryption', value: 'KMS' }]`.
  - `non-string values are shown as text and kept`: RDS node `{ multiAz: true, backup: 7 }` →
    row values `'true'` and `'7'`; `setSettingOps(..., 'encryption', 'KMS')` keeps `multiAz: true`
    and `backup: 7` with their original types.
  - `set, change and remove produce one update op`: exact op shapes for node and edge.
  - `removing the last setting drops configuration`: op `changes` is `{ configuration: undefined }`.
  - `blank or whitespace removes the key` and `unchanged value gives no ops` (`[]`).
- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/web exec vitest run src/settings.test.ts` → FAIL.
- [ ] **Step 3: Implement** `settings.ts`. Feature lookup: node → `appliesTo === 'node'` and
      `serviceId === node.serviceId`; edge → `appliesTo === 'edge'` and `serviceId` is the source's or
      target's `serviceId` (look the ends up in `project.nodes`). Dedupe by `configKey`, first wins.
      `other` = configuration keys not in `rows`, values via `String(v)`.
- [ ] **Step 4: Run** the test → PASS.
- [ ] **Step 5: Commit** `feat(web): settings model for the Details panel`.

### Task 3: Settings section in Details

**Files:**

- Modify: `apps/web/src/Details.tsx` (node branch and edge branch, before the Delete button)
- Modify: `apps/web/src/styles.css` (only if the rows need a class)
- Test: `apps/web/src/details.test.tsx`

**Interfaces:**

- Consumes: `settingsView`, `setSettingOps` (Task 2); `awsCatalog` already imported in Details.

Markup per row (accessible names are what tests and e2e use):

- Heading text `Settings` (a `<dt>`, like the other sections).
- Set row with `values`: `<select aria-label="{displayName}">` with one option per value.
- Set row without `values`: the existing `Field` with `label={displayName}`, `max={200}`.
- Each set row: a docs link (`documentationUrl`, `target="_blank" rel="noreferrer"`), the summary as
  `title`, and a button `aria-label="Remove {displayName}"`.
- Unset row: name plus a button `aria-label="Add {displayName}"`. With `values`, Add calls
  `setSettingOps(…, values[0])`; without, it shows an empty `Field` (local state) and writes
  nothing until a non-blank commit.
- `other`: a "Not in catalog" label, `key = value` text, button `aria-label="Remove {key}"`.
- Every control has `disabled={disabled}`.

- [ ] **Step 1: Write the failing tests** in `details.test.tsx` (static markup):
  - `component shows its catalog settings`: DynamoDB node with `{ encryption: 'KMS' }` → contains
    `Settings`, `aria-label="Encryption at rest"` select (use the feature's actual `displayName` from
    `awsCatalog`) with `<option value="KMS" selected="">`, `aria-label="Remove …"`, and
    `aria-label="Add …"` for an unset feature.
  - `connector shows settings from both ends`: SQS → Lambda edge → `Add` buttons for the DLQ and
    failure-destination features.
  - `unknown keys are listed and removable`: `Not in catalog`, `legacyFlag = true`,
    `aria-label="Remove legacyFlag"`.
  - `disabled editor disables settings`: with `disabled` true, every settings control has `disabled=""`.
  - `container shows no settings`: subnet view has no `Settings`.
- [ ] **Step 2: Run** `pnpm --filter @cloudarchitect/web test` → FAIL.
- [ ] **Step 3: Implement** a `Settings` component in `Details.tsx` (props: `project`, `selection`,
      `disabled`, `onEdit`) and render it in both branches. A handler that gets `[]` from
      `setSettingOps` does not call `onEdit`.
- [ ] **Step 4: Run** web tests → PASS; `pnpm typecheck` and `pnpm lint` clean.
- [ ] **Step 5: Commit** `feat(web): edit component and connector settings in Details`.

### Task 4: Browser test, docs, changelog

**Files:**

- Modify: `e2e/tests/claude.spec.ts` (new test after `'linking a requirement clears it'`)
- Modify: `CHANGELOG.md` (Unreleased → Added), `docs/product/technical-architecture.md` if it lists
  what Details can edit (grep "Details")

- [ ] **Step 1: Write the e2e test** `'a setting clears its finding, and undo brings it back'`:
      search `dynamodb`, click `Add Amazon DynamoDB` (it is selected); count `.findings` entries with
      text `VR-008` (= n ≥ 1); in Details click `Add Encryption at rest` (actual displayName); expect the
      select to show `KMS` and VR-008 count `n − 1`; export JSON (`download(page, 'JSON project')`) has
      that node's `configuration.encryption === 'KMS'`; `ControlOrMeta+z` → count back to `n`.
- [ ] **Step 2: Run** `pnpm e2e` (Docker via Rancher Desktop; local images) → PASS. If Docker is not
      available, say so in the PR; CI runs it on every pull request.
- [ ] **Step 3: Docs:** CHANGELOG line under Unreleased → Added:
      "Edit by hand: a Settings section in Details sets, changes and removes catalog settings
      (encryption, authorizer, dead-letter queue, Multi-AZ, backup, …) on the selected component or
      connector; findings update as you edit." Update other docs only where they say settings can't be
      edited.
- [ ] **Step 4: Verify** `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` → all pass.
- [ ] **Step 5: Commit** `test(e2e): a setting clears its finding; docs`.
