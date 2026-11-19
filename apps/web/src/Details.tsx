import { awsCatalog } from '@cloudarchitect/catalog';
import { EdgeKind, type PatchOp, type Project } from '@cloudarchitect/domain';
import { useId } from 'react';
import { deletionOps, toggleRequirement } from './edit';

export type Selection = { kind: 'node' | 'edge'; id: string };

const services = new Map(awsCatalog.services.map((s) => [s.id, s]));

type Props = {
  project: Project;
  selection: Selection;
  disabled: boolean;
  onEdit: (ops: PatchOp[]) => void;
};

export function Details(props: Props) {
  const headingId = useId();
  const body = describe(props);
  return body ? (
    <section aria-labelledby={headingId}>
      <h2 id={headingId}>Details</h2>
      {body}
    </section>
  ) : null;
}

/** A text field that commits on blur or Enter; `commit` gets the raw text. */
function Field(props: {
  label: string;
  value: string;
  max: number;
  disabled: boolean;
  multiline?: boolean;
  commit: (text: string) => void;
}) {
  const { label, value, max, disabled, multiline, commit } = props;
  const common = {
    key: `${label}:${value}`,
    className: 'input',
    'aria-label': label,
    defaultValue: value,
    maxLength: max,
    disabled,
  };
  return multiline ? (
    <textarea {...common} rows={3} onBlur={(e) => commit(e.target.value)} />
  ) : (
    <input
      {...common}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

function describe({ project, selection, disabled, onEdit }: Props) {
  const { id } = selection;
  const del = (nodes: string[], edges: string[]) => (
    <button
      type="button"
      className="btn"
      disabled={disabled}
      onClick={() => onEdit(deletionOps(project, { nodes, edges }))}
    >
      Delete
    </button>
  );

  if (selection.kind === 'edge') {
    const edge = project.edges.find((e) => e.id === id);
    if (!edge) return undefined;
    const nameOf = (x: string) =>
      project.nodes.find((n) => n.id === x)?.label ??
      project.containers.find((c) => c.id === x)?.label ??
      x;
    const text = (field: 'label' | 'protocol' | 'authNotes') => (value: string) => {
      if (value === (edge[field] ?? '')) return;
      onEdit([{ op: 'updateEdge', id, changes: { [field]: value } }]);
    };
    return (
      <dl className="detail">
        <dt>Connection</dt>
        <dd>{`${nameOf(edge.source)} → ${nameOf(edge.target)}`}</dd>
        <dt>Label</dt>
        <dd>
          <Field
            label="Label"
            value={edge.label ?? ''}
            max={200}
            disabled={disabled}
            commit={text('label')}
          />
        </dd>
        <dt>Kind</dt>
        <dd>
          <select
            className="input"
            aria-label="Kind"
            value={edge.kind}
            disabled={disabled}
            onChange={(e) => onEdit([{ op: 'updateEdge', id, changes: { kind: e.target.value } }])}
          >
            {EdgeKind.options.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </dd>
        <dt>Protocol</dt>
        <dd>
          <Field
            label="Protocol"
            value={edge.protocol ?? ''}
            max={100}
            disabled={disabled}
            commit={text('protocol')}
          />
        </dd>
        <dt>Auth notes</dt>
        <dd>
          <Field
            label="Auth notes"
            value={edge.authNotes ?? ''}
            max={2000}
            disabled={disabled}
            multiline
            commit={text('authNotes')}
          />
        </dd>
        <dd>{del([], [id])}</dd>
      </dl>
    );
  }

  const node = project.nodes.find((n) => n.id === id);
  if (!node) {
    const c = project.containers.find((x) => x.id === id);
    if (!c) return undefined;
    return (
      <dl className="detail">
        <dt>Name</dt>
        <dd>
          <Field
            label="Name"
            value={c.label}
            max={200}
            disabled={disabled}
            commit={(v) => {
              const label = v.trim();
              if (!label || label === c.label) return;
              onEdit([{ op: 'updateContainer', id, changes: { label } }]);
            }}
          />
        </dd>
        <dt>Type</dt>
        <dd>{c.kind}</dd>
        {c.kind === 'subnet' && (
          <>
            <dt>Subnet type</dt>
            <dd>
              <select
                className="input"
                aria-label="Subnet type"
                value={c.properties?.subnetType ?? 'private'}
                disabled={disabled}
                onChange={(e) =>
                  onEdit([
                    {
                      op: 'updateContainer',
                      id,
                      changes: { properties: { ...c.properties, subnetType: e.target.value } },
                    },
                  ])
                }
              >
                <option value="public">public</option>
                <option value="private">private</option>
              </select>
            </dd>
          </>
        )}
        <dd>{del([id], [])}</dd>
      </dl>
    );
  }

  const svc = node.serviceId ? services.get(node.serviceId) : undefined;
  return (
    <dl className="detail">
      <dt>Component</dt>
      <dd>
        <Field
          label="Component name"
          value={node.label}
          max={200}
          disabled={disabled}
          commit={(v) => {
            const label = v.trim();
            if (!label || label === node.label) return;
            onEdit([{ op: 'updateNode', id, changes: { label } }]);
          }}
        />
      </dd>
      <dt>Service</dt>
      <dd>
        {svc
          ? svc.displayName
          : node.external
            ? `${node.external.name} (external ${node.external.kind}, outside the AWS account)`
            : `${node.unresolved?.name} (not in verified catalog)`}
      </dd>
      {svc && (
        <>
          <dt>Verification</dt>
          <dd>
            {svc.lifecycle} · {svc.reviewStatus.replace('_', ' ')}
          </dd>
          <dt>Docs</dt>
          <dd>
            <a href={svc.documentationUrl} target="_blank" rel="noreferrer">
              {svc.documentationUrl}
            </a>
          </dd>
        </>
      )}
      <dt>Requirements</dt>
      <dd>
        {project.requirements.length === 0 && <span>No requirements in this design</span>}
        {project.requirements.map((r) => (
          <div key={r.id}>
            <label>
              <input
                type="checkbox"
                checked={node.requirementIds.includes(r.id)}
                disabled={disabled}
                onChange={() =>
                  onEdit([
                    {
                      op: 'updateNode',
                      id,
                      changes: { requirementIds: toggleRequirement(node.requirementIds, r.id) },
                    },
                  ])
                }
              />{' '}
              {`${r.id}: ${r.text}`}
            </label>
          </div>
        ))}
      </dd>
      <dd>{del([id], [])}</dd>
    </dl>
  );
}
