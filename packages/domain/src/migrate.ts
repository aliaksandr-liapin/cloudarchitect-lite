import { PROJECT_SCHEMA_VERSION, Project } from './project.js';

type Raw = Record<string, unknown>;
type Migration = { from: string; to: string; up: (p: Raw) => Raw };

/**
 * Ordered migrations (NFR-004). Each step must be pure and lossless where possible.
 * 1.0.0 → 1.1.0: introduce containers (wrap nodes in a default aws-cloud) and rename warnings → findings.
 * 1.1.0 → 1.2.0: add external actor nodes; existing nodes are unchanged.
 * 1.2.0 → 1.3.0: add optional `generation` metadata and the `toggle` requirement provenance; nothing to rewrite.
 * 1.3.0 → 1.4.0: add optional node `size` for the editor; nothing to rewrite.
 */
const MIGRATIONS: Migration[] = [
  {
    from: '1.0.0',
    to: '1.1.0',
    up: (p) => {
      const nodes = (p.nodes as Raw[] | undefined) ?? [];
      const rootId = 'container-aws-cloud';
      const { warnings, ...rest } = p;
      void warnings; // v1.0 warnings were free text; findings are recomputed by the validator.
      return {
        ...rest,
        schemaVersion: '1.1.0',
        revision: (p.revision as number | undefined) ?? 0,
        containers: [{ id: rootId, kind: 'aws-cloud', label: 'AWS' }],
        nodes: nodes.map((n) => ({ ...n, containerId: n.containerId ?? rootId })),
        findings: [],
      };
    },
  },
  { from: '1.1.0', to: '1.2.0', up: (p) => ({ ...p, schemaVersion: '1.2.0' }) },
  { from: '1.2.0', to: '1.3.0', up: (p) => ({ ...p, schemaVersion: '1.3.0' }) },
  { from: '1.3.0', to: '1.4.0', up: (p) => ({ ...p, schemaVersion: '1.4.0' }) },
];

export class UnsupportedSchemaError extends Error {
  constructor(version: unknown) {
    super(`Unsupported project schema version: ${String(version)}`);
    this.name = 'UnsupportedSchemaError';
  }
}

/** Upgrades an imported project JSON to the current schema, then validates it. */
export function migrateProject(input: unknown): Project {
  let current = { ...(input as Raw) };
  for (let guard = 0; current.schemaVersion !== PROJECT_SCHEMA_VERSION; guard++) {
    const step = MIGRATIONS.find((m) => m.from === current.schemaVersion);
    if (!step || guard > MIGRATIONS.length) throw new UnsupportedSchemaError(current.schemaVersion);
    current = step.up(current);
  }
  return Project.parse(current);
}
