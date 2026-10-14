import { awsCatalog, samples } from '@cloudarchitect/catalog';
import {
  migrateProject,
  validateProject,
  type Finding,
  type Project,
} from '@cloudarchitect/domain';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { applyLayout, needsLayout, toFlow } from './layout';
import { AiModelPanel } from './models';
import { nodeTypes } from './nodes';
import { downloadJson, loadProject, readJsonFile, saveProject } from './storage';

const services = new Map(awsCatalog.services.map((s) => [s.id, s]));
const displayName = (id: string) => services.get(id)?.displayName ?? id;

export function App() {
  const [project, setProject] = useState<Project>();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState<string>();
  const [setupPending, setSetupPending] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  /** Single entry point for project changes: lay out if needed, persist, re-render. */
  const commit = useCallback(async (next: Project, forceLayout = false) => {
    const laid = forceLayout || needsLayout(next) ? await applyLayout(next) : next;
    setProject(laid);
    setNodes(toFlow(laid, displayName).nodes);
    await saveProject(laid).catch(() =>
      setError('Could not save to browser storage — export JSON as a backup.'),
    );
  }, []);

  useEffect(() => {
    const sample = migrateProject(samples.myblog);
    loadProject(sample.projectId)
      .catch(() => undefined)
      .then((stored) => commit(stored ?? sample));
  }, [commit]);

  useEffect(() => {
    // Self-hosted installs: point to the wizard, but never block the local-first editor.
    api.setupStatus().then(
      (s) => setSetupPending(s.available && !s.configured),
      () => undefined,
    );
  }, []);

  const edges = useMemo(() => (project ? toFlow(project, displayName).edges : []), [project]);
  const findings: Finding[] = useMemo(
    () => (project ? validateProject(project, awsCatalog) : []),
    [project],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, dragged: Node) => {
      if (!project) return;
      const position = dragged.position;
      void commit({
        ...project,
        revision: project.revision + 1,
        nodes: project.nodes.map((n) => (n.id === dragged.id ? { ...n, position } : n)),
        containers: project.containers.map((c) => (c.id === dragged.id ? { ...c, position } : c)),
      });
    },
    [project, commit],
  );

  /** Selects and highlights what a finding is about; edge findings point at the consuming node. */
  const locate = (f: Finding) => {
    const id =
      f.nodeIds[0] ??
      f.containerIds[0] ??
      project?.edges.find((e) => e.id === f.edgeIds[0])?.target;
    if (!id) return;
    setSelected(id);
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
  };

  const detail = project && selected ? describe(project, selected) : undefined;

  return (
    <div className="app">
      <header className="bar">
        <strong>CloudArchitect Lite</strong>
        <span className="muted">{project?.name}</span>
        <span className="spacer" />
        <button onClick={() => project && commit(project, true)}>Auto layout</button>
        <button onClick={() => project && downloadJson(project)}>Export JSON</button>
        <button onClick={() => fileInput.current?.click()}>Import JSON</button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              readJsonFile(file).then(
                (p) => commit(p),
                (err: Error) => setError(err.message),
              );
          }}
        />
      </header>
      {setupPending && (
        <div className="notice">
          AI features are not set up yet. Open the setup link printed in the server log (
          <code>docker compose logs gateway</code>) to finish setup; manual editing works meanwhile.
        </div>
      )}
      {error && (
        <div role="alert" className="alert" onClick={() => setError(undefined)}>
          {error}
        </div>
      )}
      <main className="main">
        <section className="canvas" aria-label="Architecture canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onSelectionChange={({ nodes: sel }) => setSelected(sel[0]?.id)}
            fitView
            minZoom={0.2}
            colorMode="system"
          >
            <Background />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
        </section>
        <aside className="side">
          {detail && (
            <section>
              <h2>Details</h2>
              {detail}
            </section>
          )}
          <section>
            <h2>Findings ({findings.length})</h2>
            {findings.length === 0 && <p className="muted">No rule findings.</p>}
            <ul className="findings">
              {findings.map((f) => (
                <li key={f.id} className={`sev-${f.severity}`}>
                  <button className="link" onClick={() => locate(f)}>
                    <span className="badge">{f.severity}</span> {f.ruleId}
                  </button>
                  <div>{f.explanation}</div>
                  {f.remediation && <div className="muted">{f.remediation}</div>}
                </li>
              ))}
            </ul>
          </section>
          <AiModelPanel />
          <p className="muted small">
            Generated designs require professional review before production use. Icons shown are
            generic placeholders until the official packs are imported.
          </p>
        </aside>
      </main>
    </div>
  );
}

function describe(project: Project, id: string) {
  const node = project.nodes.find((n) => n.id === id);
  if (!node) {
    const c = project.containers.find((x) => x.id === id);
    return c ? <p>{`${c.label} (${c.kind})`}</p> : undefined;
  }
  const svc = node.serviceId ? services.get(node.serviceId) : undefined;
  const reqs = project.requirements.filter((r) => node.requirementIds.includes(r.id));
  return (
    <dl className="detail">
      <dt>Component</dt>
      <dd>{node.label}</dd>
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
      <dd>{reqs.length ? reqs.map((r) => `${r.id}: ${r.text}`).join('; ') : 'None linked'}</dd>
    </dl>
  );
}
