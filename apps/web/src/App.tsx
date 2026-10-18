import { awsCatalog, samples } from '@cloudarchitect/catalog';
import {
  migrateProject,
  validateProject,
  type Finding,
  type GapTopic,
  type GenerateResponse,
  type Project,
  type Requirement,
} from '@cloudarchitect/domain';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  applyNodeChanges,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { ClarifyCard } from './ClarifyCard';
import { GeneratePanel, type GenerateInput } from './GeneratePanel';
import { applyLayout, needsLayout, toFlow } from './layout';
import { AiModelPanel, readModelChoice } from './models';
import { nodeTypes } from './nodes';
import { downloadJson, loadProject, readJsonFile, saveProject } from './storage';
import { idbVersionStore, replaceDecision, saveVersion, type ProjectVersion } from './versions';
import { VersionsPanel } from './VersionsPanel';

const services = new Map(awsCatalog.services.map((s) => [s.id, s]));
const displayName = (id: string) => services.get(id)?.displayName ?? id;

type Questions = Extract<GenerateResponse, { status: 'questions' }>;

const STAGE = {
  reading: 'Reading your requirements…',
  designing: 'Designing…',
  checking: 'Checking…',
} as const;
/** Extraction is quick; after this the request is almost always in the generation step. */
const DESIGNING_AFTER_MS = 8000;
const CANCELLED = 'Generation cancelled — no credit used.';
const SETUP_REQUIRED = 'AI features are not set up yet — see the setup notice above.';

/** Plain messages for gateway error codes (spec §5); manual editing stays available for all of them. */
const ERROR_MESSAGES: Record<string, string> = {
  no_credits: 'Free generations used up. Bring your own key arrives in a later version.',
  model_not_enabled: 'This model needs your own API key.',
  free_ai_unavailable: 'AI generation is paused right now. Manual editing still works.',
  setup_required: SETUP_REQUIRED,
  generation_failed: 'Generation failed — no credit used. Try again.',
  provider_error: 'Generation failed — no credit used. Try again.',
  operation_expired: 'The questions expired. Generate again.',
  catalog_mismatch: 'Reload the page to get the latest service catalog.',
};
const GENERIC_ERROR = 'Something went wrong — try again';

interface DialogSpec {
  message: string;
  actions: { label: string; value: string; primary?: boolean }[];
}
const EDITED_DIALOG: DialogSpec = {
  message: 'You edited this diagram by hand. Replace it? Your edited version is kept in Versions.',
  actions: [
    { label: 'Cancel', value: 'cancel' },
    { label: 'Replace', value: 'replace', primary: true },
  ],
};
const STORAGE_DIALOG: DialogSpec = {
  message:
    'Could not keep a copy of the current diagram in browser storage. Export it as JSON first, or replace it anyway?',
  actions: [
    { label: 'Cancel', value: 'cancel' },
    { label: 'Replace anyway', value: 'replace' },
    { label: 'Export JSON', value: 'export', primary: true },
  ],
};

type Toast = { text: string; restore?: ProjectVersion };

export function App() {
  const [project, setProject] = useState<Project>();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState<string>();
  const [setupPending, setSetupPending] = useState(false);
  const [stage, setStage] = useState<string>();
  const [clarify, setClarify] = useState<Questions>();
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [toast, setToast] = useState<Toast>();
  const [dialog, setDialog] = useState<DialogSpec & { resolve(value: string): void }>();
  /** The request can still be aborted (false once its response has arrived). */
  const [cancellable, setCancellable] = useState(false);
  /** A replace flow (generated result, Restore) is running; see `exclusive`. */
  const [replacing, setReplacing] = useState(false);
  const replacingRef = useRef(false);
  const dialogOpenRef = useRef(false);
  const flowRef = useRef<ReactFlowInstance>(undefined);
  /** Fit the viewport once the next committed nodes render (new diagram from generation or Restore). */
  const fitPendingRef = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const abortRef = useRef<AbortController>(undefined);
  /** Latest committed project, for async flows that outlive a render. */
  const projectRef = useRef<Project>(undefined);

  /** Single entry point for project changes: lay out if needed, persist, re-render. */
  const commit = useCallback(async (next: Project, forceLayout = false) => {
    const laid = forceLayout || needsLayout(next) ? await applyLayout(next) : next;
    projectRef.current = laid;
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

  const projectId = project?.projectId;
  const refreshVersions = useCallback(async (id: string) => {
    setVersions(await idbVersionStore.list(id).catch(() => []));
  }, []);
  useEffect(() => {
    if (!projectId) return;
    idbVersionStore.list(projectId).then(setVersions, () => setVersions([]));
  }, [projectId]);

  useEffect(() => {
    if (dialog) dialogRef.current?.showModal();
  }, [dialog]);

  useEffect(() => {
    if (!fitPendingRef.current) return;
    fitPendingRef.current = false;
    // React Flow queues this until the new nodes are measured.
    void flowRef.current?.fitView();
  }, [nodes]);

  /** In-app confirmation; resolves with the chosen action's value ('cancel' on Escape). Rejects if one is open. */
  const ask = (spec: DialogSpec) =>
    new Promise<string>((resolve, reject) => {
      if (dialogOpenRef.current) return reject(new Error('A dialog is already open'));
      dialogOpenRef.current = true;
      setDialog({
        ...spec,
        resolve: (value) => {
          dialogOpenRef.current = false;
          dialogRef.current?.close();
          setDialog(undefined);
          resolve(value);
        },
      });
    });

  /** Runs one replace flow at a time, so two flows never version the same diagram or race their commits. */
  const exclusive = async (flow: () => Promise<void>) => {
    if (replacingRef.current) return;
    replacingRef.current = true;
    setReplacing(true);
    try {
      await flow();
    } finally {
      replacingRef.current = false;
      setReplacing(false);
    }
  };

  /**
   * Stores the current diagram as a version before something replaces it. Returns the version, `null`
   * when storage failed and the user chose to go on anyway, or `undefined` when the user cancelled.
   */
  const keepCurrent = async (current: Project): Promise<ProjectVersion | null | undefined> => {
    try {
      const saved = await saveVersion(idbVersionStore, current);
      await refreshVersions(current.projectId);
      return saved;
    } catch {
      const choice = await ask(STORAGE_DIALOG);
      if (choice === 'cancel') return undefined;
      if (choice === 'export') downloadJson(current);
      return null;
    }
  };

  /** Replace step (spec §2.4): confirm hand edits, keep the current diagram, then show the result. */
  const replaceWith = async (generated: Project) => {
    const current = projectRef.current;
    if (replaceDecision(current) === 'confirm-edits' && (await ask(EDITED_DIALOG)) !== 'replace')
      return;
    const saved = current ? await keepCurrent(current) : null;
    if (saved === undefined) return;
    setStage(STAGE.checking);
    fitPendingRef.current = true;
    await commit(
      {
        ...migrateProject(generated),
        projectId: current?.projectId ?? generated.projectId,
        revision: (current?.revision ?? 0) + 1,
      },
      true,
    );
    setToast({ text: 'New diagram generated', restore: saved ?? undefined });
  };

  /** Restores a kept version; the diagram it replaces is kept as a version too. */
  const restore = (v: ProjectVersion) =>
    exclusive(async () => {
      const current = projectRef.current;
      setToast(undefined);
      if (current && (await keepCurrent(current)) === undefined) return;
      fitPendingRef.current = true;
      await commit({
        ...migrateProject(v.project),
        projectId: current?.projectId ?? v.project.projectId,
        revision: (current?.revision ?? 0) + 1,
      });
    }).catch(showError);

  const showError = (err: unknown) => {
    const code = err instanceof ApiError ? err.code : undefined;
    if (code === 'setup_required') setSetupPending(true);
    setError((code && ERROR_MESSAGES[code]) ?? GENERIC_ERROR);
  };

  /** Runs one gateway call with stage text and Cancel; handles questions, results and errors. */
  const run = async (call: (signal: AbortSignal) => Promise<GenerateResponse>, first: string) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setError(undefined);
    setToast(undefined);
    setClarify(undefined);
    setStage(first);
    setCancellable(true);
    const timer =
      first === STAGE.reading
        ? setTimeout(() => !ac.signal.aborted && setStage(STAGE.designing), DESIGNING_AFTER_MS)
        : undefined;
    try {
      const res = await call(ac.signal);
      clearTimeout(timer);
      if (ac.signal.aborted) return;
      // The response is here: nothing left to cancel, the rest happens in the browser.
      abortRef.current = undefined;
      setCancellable(false);
      if (res.status === 'questions') setClarify(res);
      else await exclusive(() => replaceWith(res.project));
    } catch (err) {
      if (ac.signal.aborted) return; // cancel() already reported it
      if (err instanceof ApiError && err.code === 'client_closed') setToast({ text: CANCELLED });
      else showError(err);
    } finally {
      clearTimeout(timer);
      // A newer run owns the stage text; otherwise this run is over.
      if (abortRef.current === ac || abortRef.current === undefined) {
        abortRef.current = undefined;
        setCancellable(false);
        setStage(undefined);
      }
    }
  };

  const generate = (input: GenerateInput) =>
    run(
      (signal) =>
        api.generate(
          {
            prompt: input.prompt,
            toggles: input.toggles,
            reviewRequirements: input.reviewRequirements,
            catalogVersion: awsCatalog.manifest.catalogVersion,
            model: readModelChoice(),
          },
          signal,
        ),
      STAGE.reading,
    );

  const continueWith = (
    op: Questions,
    answers: Partial<Record<GapTopic, string>>,
    requirements: Requirement[],
  ) =>
    run(
      (signal) =>
        api.continueGenerate(
          {
            operationId: op.operationId,
            operationToken: op.operationToken,
            answers,
            requirements,
          },
          signal,
        ),
      STAGE.designing,
    );

  const cancel = () => {
    if (!abortRef.current && !clarify) return;
    abortRef.current?.abort();
    abortRef.current = undefined;
    setCancellable(false);
    setStage(undefined);
    setClarify(undefined);
    setToast({ text: CANCELLED });
  };

  /** A hand edit: after this, generating again asks before replacing (replaceDecision). */
  const rename = (id: string, label: string) => {
    const node = project?.nodes.find((n) => n.id === id);
    if (!project || !node || !label.trim() || label.trim() === node.label) return;
    void commit({
      ...project,
      revision: project.revision + 1,
      nodes: project.nodes.map((n) => (n.id === id ? { ...n, label: label.trim() } : n)),
    });
  };

  /** A generation, a replace flow or a dialog is in progress: hold every other change to the diagram. */
  const busy = stage !== undefined || replacing || dialog !== undefined;

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

  return (
    <div className="app">
      <header className="bar">
        <strong>CloudArchitect Lite</strong>
        <span className="muted">{project?.name}</span>
        <span className="spacer" />
        <button disabled={busy} onClick={() => project && commit(project, true)}>
          Auto layout
        </button>
        <button onClick={() => project && downloadJson(project)}>Export JSON</button>
        <button disabled={busy} onClick={() => fileInput.current?.click()}>
          Import JSON
        </button>
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
          {clarify && (
            <div className="overlay">
              <ClarifyCard
                key={clarify.operationId}
                questions={clarify.questions}
                requirements={clarify.requirements}
                assumptions={clarify.assumptions}
                onContinue={(answers, reqs) => continueWith(clarify, answers, reqs)}
                onCancel={cancel}
              />
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStop={onNodeDragStop}
            onInit={(flow) => (flowRef.current = flow)}
            nodesDraggable={!busy}
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
          <GeneratePanel
            hasDiagram={Boolean(project?.nodes.length)}
            busy={busy}
            cancellable={cancellable}
            stage={stage}
            onGenerate={generate}
            onCancel={cancel}
          />
          {project && selected && (
            <Details project={project} id={selected} onRename={rename} disabled={busy} />
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
          <VersionsPanel versions={versions} onRestore={restore} disabled={busy} />
          <AiModelPanel />
          <p className="muted small">
            Generated designs require professional review before production use. Icons shown are
            generic placeholders until the official packs are imported.
          </p>
        </aside>
      </main>
      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.restore && (
            <>
              {' · '}
              <button
                className="link"
                disabled={busy}
                onClick={() => toast.restore && restore(toast.restore)}
              >
                Restore previous
              </button>
            </>
          )}
          <button className="link muted" aria-label="Dismiss" onClick={() => setToast(undefined)}>
            ×
          </button>
        </div>
      )}
      <dialog
        ref={dialogRef}
        className="confirm"
        onCancel={(e) => {
          e.preventDefault();
          dialog?.resolve('cancel');
        }}
      >
        {dialog && (
          <>
            <p>{dialog.message}</p>
            <div className="row">
              <span className="spacer" />
              {dialog.actions.map((a) => (
                <button
                  key={a.value}
                  className={a.primary ? 'primary' : undefined}
                  onClick={() => dialog.resolve(a.value)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}

function Details(props: {
  project: Project;
  id: string;
  onRename: (id: string, label: string) => void;
  disabled: boolean;
}) {
  const body = describe(props);
  return body ? (
    <section>
      <h2>Details</h2>
      {body}
    </section>
  ) : null;
}

function describe({
  project,
  id,
  onRename,
  disabled,
}: {
  project: Project;
  id: string;
  onRename: (id: string, label: string) => void;
  disabled: boolean;
}) {
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
      <dd>
        <input
          key={`${node.id}:${node.label}`}
          className="input"
          aria-label="Component name"
          defaultValue={node.label}
          maxLength={200}
          disabled={disabled}
          onBlur={(e) => onRename(node.id, e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
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
      <dd>{reqs.length ? reqs.map((r) => `${r.id}: ${r.text}`).join('; ') : 'None linked'}</dd>
    </dl>
  );
}
