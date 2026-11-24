import { awsCatalog } from '@cloudarchitect/catalog';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { contractFor, toProject } from './contract.js';

const contract = contractFor(awsCatalog);

/** Trimmed from a real Haiku answer (product-search-cost #1): every node came back without containerId. */
const rds = {
  id: 'n-rds',
  serviceId: 'aws.rds',
  label: 'Product database (source of truth)',
  purpose: 'Stores the 2 million products as the authoritative relational data',
  rationale: 'Relational source of truth, placed in a private subnet',
  requirementIds: ['R1'],
  configuration: [{ key: 'backup', value: 'automated' }],
};
const answer = (nodes: unknown[]) => ({
  name: 'Product search',
  inferredRequirements: [],
  assumptions: [],
  containers: [
    { id: 'c-aws', kind: 'aws-cloud', label: 'AWS Cloud' },
    { id: 'c-region', kind: 'region', parentId: 'c-aws', label: 'Region' },
  ],
  nodes,
  edges: [],
});

type Schema = Record<string, unknown>;
const root = (contract.format as { schema: Schema }).schema;
/** Walks `path` through the JSON schema, following `$ref`s into `$defs`. */
function at(...path: string[]): Schema {
  let s = root;
  for (const key of ['', ...path]) {
    if (key) s = s[key] as Schema;
    while (typeof s.$ref === 'string')
      s = (root.$defs as Schema)[s.$ref.split('/').pop()!] as Schema;
  }
  return s;
}
const node = (...path: string[]) => at('properties', 'nodes', 'items', ...path);

describe('output format', () => {
  it('keeps enums in the JSON schema, so the decoder can only emit catalog keys and ids', () => {
    // The SDK helper moved every `enum` into the description, so nothing constrained the
    // configuration key and Haiku emitted keys outside the catalog (myblog-backups #2).
    expect(node('properties', 'configuration', 'items', 'properties', 'key').enum).toEqual([
      ...new Set(awsCatalog.features.map((f) => f.configKey)),
    ]);
    expect(node('properties', 'serviceId').enum).toContain('aws.rds');
    expect(root.$schema).toBeUndefined();
  });

  it('has no parse hook, so a mismatch reaches parseOutput and keeps its usage', () => {
    // With a parse hook the SDK stream threw its own error inside the client: no usage, no text.
    expect('parse' in (contract.format as object)).toBe(false);
    expect(contract.format).toMatchObject({ type: 'json_schema' });
  });
});

describe('containerId', () => {
  it('is required on every node, so a placement is never silently omitted', () => {
    expect(node().required).toContain('containerId');
    expect(contract.schema.safeParse(answer([rds])).success).toBe(false);
  });

  it('accepts null and maps it to no container', () => {
    const g = contract.schema.parse(answer([{ ...rds, containerId: null }]));
    const p = toProject(g, {
      name: 'x',
      requirements: [],
      catalog: awsCatalog,
      generation: { toggles: {}, model: 'haiku', generatedAt: '', contentHash: '' },
    });
    expect(p.nodes[0]).not.toHaveProperty('containerId');
  });
});

describe('system prompt', () => {
  it('FEATURES block is unchanged by feature values (settings editor, 2026-11-24)', () => {
    // The catalog's `values` serve the settings editor only; the model never sees them.
    const lines = contract.system.split('\n');
    const start = lines.findIndex((l) => l.startsWith('FEATURES'));
    const block = lines.slice(start, lines.indexOf('', start)).join('\n');
    expect(block).not.toContain('values');
    const hash = createHash('sha256').update(block).digest('hex');
    expect(hash, `FEATURES block changed:\n${block}`).toBe(
      '77e26955d4034481c8ebbd46c1425e26f83608949adc23b1664c34dcdde70950',
    );
  });
});
