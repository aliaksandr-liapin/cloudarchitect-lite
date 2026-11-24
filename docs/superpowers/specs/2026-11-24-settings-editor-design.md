# 0.4 Settings editor: design

**Status:** approved by owner 2026-11-24 · **Date:** 2026-11-24 · **Release:** 0.4 (target Jan 2027)
**Follows:** [Edit by hand](2026-11-17-edit-by-hand-design.md) (merged in #56). This reverses its
non-goal "editing `configuration` / feature keys".

## Intent and why

Twelve validation rules read a component's or connector's `configuration` (encryption, authorizer,
dead-letter queue, failure destination, Multi-AZ, backup, replication, origin access, presigned
URL, API type). Edit by hand can add, connect and delete, but the Details panel shows no settings at
all, so a finding such as "has no stated encryption at rest" can only be cleared by asking the AI.
The owner decided on 20 Nov that 0.4 should let a user clear these by hand.

Success: select a DynamoDB table with VR-008, set Encryption to KMS, and the finding disappears,
with undo and export behaving as for every other hand edit.

## Goals

1. A **Settings** section in Details for the selected component or connector, listing the catalog
   features that apply to it.
2. Add, change and remove a setting; findings update immediately; undo/redo works.
3. Fixed choices where the catalog defines them (encryption, API type), free text elsewhere.
4. Settings the catalog doesn't know (imported files) stay visible and can be removed.

## Non-goals (0.4)

- A "fix it" button on a finding.
- Keys typed by the user (only catalog keys can be added).
- Settings on containers.
- Changing the AI prompt. The feature summaries the generator sends stay byte-identical.

## Anti-goals

- Free-text connector **Auth notes** must not clear VR-003 (owner decision, 20 Nov). Only the
  `authorizer` setting on the API Gateway component (or an incoming connector) does, as today.
- The editor must never write placeholder values ("none", "disabled", "false"): the generator
  contract forbids them (rule 11), and VR-004/008/020/021 treat any value as set.

## Approaches

- **A. Catalog list (picked by the owner, 24 Nov).** Rows come from `catalog.features` for the
  selected element's service. No typos possible; matches what the AI may produce. A feature missing
  from the catalog can't be added by hand.
- **B. Free key/value table with catalog suggestions.** Flexible, but a misspelt key silently
  clears nothing, which is the confusion the editor is meant to remove.
- **C. "Fix it" button on each finding.** Faster for one finding, but needs a mapping from every
  rule to a setting and value; bigger, and the finding's remediation already names the setting.

## Design

**Which features a row list shows.**

- Component: features with `appliesTo: 'node'` and `serviceId` equal to the node's service.
- Connector: features with `appliesTo: 'edge'` whose `serviceId` is the service of the source or
  the target node (e.g. `deadLetterQueue` on SQS → Lambda, `failureDestination` on SNS → Lambda,
  `originAccess` on CloudFront → S3, `presignedUrl` on Client → S3).
- One row per `configKey`: S3 has `backup` once (versioning). If two features share a key for the
  same element, the first in catalog order names the row.
- External and unresolved nodes have no catalog features; they show only "not in catalog" keys.

**Row.** Feature display name, the summary as a tooltip, a docs link, the value control, and a
remove (✕) button. Unset features show the name and an **Add** button; Add sets the first allowed
value, or opens an empty text field (nothing is written until a non-blank value is committed).

**Values.**

- New optional `values: string[]` on `ServiceFeature` (catalog data + zod schema). Set for the
  eight encryption features (`["KMS", "AWS-managed"]`) and `aws.apigateway.api-type`
  (`["REST", "HTTP", "WEBSOCKET"]`). Rows with `values` use a select.
- Other rows use a text field (max 200 characters), committed on blur or Enter like the existing
  fields. Placeholder: the catalog example where the summary gives one (builder's call to derive or
  hard-code; no prompt change).
- A blank value removes the key. A value of a non-string type (number or boolean from an imported
  file) is shown as text and written back as a string only if edited.

**Not in catalog.** Keys present in `configuration` that are not a row (unknown key, or a known key
of another service) are listed under "Not in catalog" as `key = value`, read-only, with ✕.

**Edits.** Each change is one `updateNode` / `updateEdge` op with `changes: { configuration }`
holding the whole new object (or omitting the field when it becomes empty), through the existing
`onEdit` → `commit()` path. Undo, saving, findings and exports need no change. Disabled when the
editor is disabled (generation running), like the other fields.

**Generator.** `contract.ts` builds its feature list from the catalog; it must not start sending
`values`. A test pins the prompt's FEATURES block.

## Tests

- Unit (web): rows for a DynamoDB node, an SQS → Lambda connector, an external node; select for
  encryption; Add/change/remove produce the expected ops; blank removes; unknown keys listed and
  removable; disabled state.
- Domain/catalog: `values` parses; every `values` entry is accepted by the rules that read the key
  (e.g. KMS clears VR-025).
- e2e: open the demo design, select a data store with VR-008, set Encryption, the finding is gone;
  undo brings it back.
- Generator: FEATURES block of the prompt unchanged.

## Left to the builder

Layout and styling within the Details panel's existing look; row order (catalog order); the
placeholder source; whether rows group under a collapsible heading.
