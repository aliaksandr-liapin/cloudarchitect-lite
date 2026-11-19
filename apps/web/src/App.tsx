import { awsCatalog, samples } from '@cloudarchitect/catalog';
import {
  MODEL_OPTIONS,
  Project,
  applyPatch,
  migrateProject,
  validateProject,
  type Container,
  type Finding,
  type GapTopic,
  type GenerateResponse,
  type PatchOp,
  type Requirement,
} from '@cloudarchitect/domain';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type FitViewOptions,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { errorCode, errorMessage, isTransient } from './errors';
import { ClarifyCard } from './ClarifyCard';
import { GeneratePanel, type GenerateInput } from './GeneratePanel';
import type { StepId } from './GenerationStatus';
import { edgeTypes } from './edges';
import {
  applyLayout,
  type ContainerNodeData,
  type ServiceNodeData,
  containerMinSize,
  dropRoutes,
  fitsChildren,
  needsLayout,
  recoverRoutes,
  keepEdgeState,
  keepFlowState,
  LEGACY_NODE_SIZE,
  NODE_SIZE,
  toFlow,
  type Routes,
} from './layout';
import { DEMO, DEMO_BANNER, REPO_URL, demoBootSelection, demoIconSource } from './demo';
import { AiModelPanel, useModelChoice } from './models';
import {
  containerIcon,
  loadIcons,
  nextIconStep,
  serviceIcon,
  type IconState,
  type IconUrls,
} from './icons';
import { nodeTypes, type EditableData, type ResizeRect } from './nodes';
import { EMPTY_HISTORY, record, redo, undo, type History } from './history';
import { Details, type Selection } from './Details';
import { AddPanel, DRAG_MIME, type AddItem } from './AddPanel';
import {
  absolutePosition,
  atNodeLimit,
  canNest,
  nestRefusal,
  connectionError,
  containerAt,
  deletionOps,
  newContainer,
  newEdge,
  newExternalNode,
  newServiceNode,
  NEW_CONTAINER_SIZE,
  reparentNode,
  selectedIds,
  shouldHandleShortcut,
} from './edit';
import { canExport, exportImage, type ImageFormat } from './exportImage';
import { bootProject, downloadJson, loadProject, readJsonFile, saveProject } from './storage';
import {
  idbVersionStore,
  keepCurrent,
  prepareReplace,
  unavailableVersionStore,
  type Kept,
  type ProjectVersion,
  type ReplaceUi,
} from './versions';
import {
  clampPanelWidth,
  maxPanelWidth,
  PANEL_MIN,
  PANEL_STEP,
  PANEL_WIDTH_KEY,
  readPanelWidth,
  readTheme,
  THEME_KEY,
  writePref,
  type Theme,
} from './prefs';
import { VersionsPanel } from './VersionsPanel';

const services = new Map(awsCatalog.services.map((s) => [s.id, s]));
const displayName = (id: string) => services.get(id)?.displayName ?? id;

type Questions = Extract<GenerateResponse, { status: 'questions' }>;

/** Extraction is quick; after this the request is almost always in the generation step. */
const DESIGNING_AFTER_MS = 8000;
const CANCELLED = 'Generation cancelled.';

interface DialogSpec {
  message: string;
  actions: { label: string; value: string; primary?: boolean }[];
}
const EDITED_DIALOG: DialogSpec = {
  message:
    'You edited this diagram by hand. Generating replaces it; your edited version is kept in Versions.',
  actions: [
    { label: 'Cancel', value: 'cancel' },
    { label: 'Generate', value: 'replace', primary: true },
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

type Toast = { text: string; restore?: ProjectVersion; undo?: boolean };

/** Fit the whole diagram with padding, never zooming past 100 %. */
const FIT: FitViewOptions = { padding: 0.12, maxZoom: 1 };
const NO_ROUTES: Routes = new Map();

export function App() {
  const [project, setProject] = useState<Project>();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selected, setSelected] = useState<Selection>();
  const [error, setError] = useState<string>();
  const [setupPending, setSetupPending] = useState(false);
  const modelState = useModelChoice();
  const [step, setStep] = useState<StepId>();
  const [startedAt, setStartedAt] = useState<number>();
  /** Startup could not read browser storage: edit in memory only, never save over the stored project. */
  const [storageDown, setStorageDown] = useState(false);
  const storageDownRef = useRef(false);
  const [clarify, setClarify] = useState<Questions>();
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [toast, setToast] = useState<Toast>();
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [panelWidth, setPanelWidth] = useState(readPanelWidth);
  const [winWidth, setWinWidth] = useState(() => window.innerWidth);
  /** Counts versions saved by the replace step or Restore; opens the Versions section. */
  const [versionsAdded, setVersionsAdded] = useState(0);
  const [dialog, setDialog] = useState<DialogSpec & { resolve(value: string): void }>();
  /** The request can still be aborted (false once its response has arrived). */
  const [cancellable, setCancellable] = useState(false);
  /** A replace flow (generated result, Restore) is running; see `exclusive`. */
  const [replacing, setReplacing] = useState(false);
  /** Auto layout's ELK pass is running: the latest project is not committed yet. */
  const [layingOut, setLayingOut] = useState(false);
  const [iconState, setIconState] = useState<IconState>();
  const [iconUrls, setIconUrls] = useState<IconUrls>({});
  const [iconTick, setIconTick] = useState(0);
  const replacingRef = useRef(false);
  const dialogOpenRef = useRef(false);
  const flowRef = useRef<ReactFlowInstance>(undefined);
  /** Fit the viewport once the next committed nodes render (generation, Restore, Import, Auto layout). */
  const fitPendingRef = useRef(false);
  /** ELK edge routes of the last layout pass, minus those a hand move or resize made stale. */
  const routesRef = useRef<Routes>(NO_ROUTES);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const abortRef = useRef<AbortController>(undefined);
  /** Latest committed project, for async flows that outlive a render. */
  const projectRef = useRef<Project>(undefined);
  const historyRef = useRef<History>(EMPTY_HISTORY);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  /** The diagram the replace step already confirmed and kept, so a retry or Continue does not ask again. */
  const preparedRef = useRef<Kept & { project: Project | undefined }>(undefined);

  const versionStore = () => (storageDownRef.current ? unavailableVersionStore : idbVersionStore);

  const setHistory = useCallback((h: History) => {
    historyRef.current = h;
    setCanUndo(h.past.length > 0);
    setCanRedo(h.future.length > 0);
  }, []);

  /** A different design was loaded: nothing before it can be undone. */
  const clearHistory = useCallback(() => setHistory(EMPTY_HISTORY), [setHistory]);

  /**
   * Single entry point for project changes: lay out if needed, persist, re-render. A layout pass
   * replaces the routes; otherwise `opts.routes` (default: the current ones) is drawn. `opts.recover`
   * (a loaded, imported or restored diagram) starts without routes and draws the ones
   * `recoverRoutes` finds still valid. `opts.fit` fits the viewport once the result renders.
   */
  const commit = useCallback(
    async (
      next: Project,
      forceLayout = false,
      opts: { routes?: Routes; recover?: boolean; fit?: boolean } = {},
    ) => {
      let laid = next;
      let routes = opts.recover ? NO_ROUTES : (opts.routes ?? routesRef.current);
      const layout = forceLayout || needsLayout(next);
      if (layout) ({ project: laid, routes } = await applyLayout(next));
      routesRef.current = routes;
      projectRef.current = laid;
      if (opts.fit) fitPendingRef.current = true;
      const flow = toFlow(laid, displayName, routes);
      setProject(laid);
      // Keep the selection (and so the resize handles and Details) and measured sizes across a commit.
      setNodes((current) => keepFlowState(current, flow.nodes));
      setEdges((current) => keepEdgeState(current, flow.edges));
      if (opts.recover && !layout) {
        void recoverRoutes(laid).then(
          (recovered) => {
            // A newer commit owns the diagram (and its routes) now.
            if (projectRef.current !== laid) return;
            routesRef.current = recovered;
            const { edges: next } = toFlow(laid, displayName, recovered);
            setEdges((current) => keepEdgeState(current, next));
          },
          () => undefined,
        );
      }
      if (storageDownRef.current) return;
      await saveProject(laid).catch(() =>
        setError('Could not save to browser storage — export JSON as a backup.'),
      );
    },
    [],
  );

  useEffect(() => {
    const sample = migrateProject(samples.myblog);
    void bootProject(() => loadProject(sample.projectId), sample).then(({ project, storage }) => {
      storageDownRef.current = storage === 'unavailable';
      setStorageDown(storageDownRef.current);
      clearHistory();
      return commit(project, false, { recover: true }).then(() => {
        if (!DEMO) return;
        const id = demoBootSelection(project);
        if (!id) return;
        setSelected({ kind: 'node', id });
        setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
      });
    });
  }, [commit, clearHistory]);

  useEffect(() => {
    // Self-hosted installs: point to the wizard, but never block the local-first editor.
    if (DEMO) return;
    api.setupStatus().then(
      (s) => setSetupPending(s.available && !s.configured),
      () => undefined,
    );
  }, []);

  const projectId = project?.projectId;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    writePref(THEME_KEY, next);
  };

  const sideWidth = clampPanelWidth(panelWidth, winWidth);
  // Persist the width the user chose (not one a narrow window merely clamped), and only if a gesture changed it.
  const widthChangedRef = useRef(false);
  const chooseWidth = (width: number) => {
    widthChangedRef.current = true;
    setPanelWidth(width);
  };
  const persistWidth = () => {
    if (!widthChangedRef.current) return;
    widthChangedRef.current = false;
    writePref(PANEL_WIDTH_KEY, String(Math.round(panelWidth)));
  };

  const refreshVersions = useCallback(async (id: string) => {
    setVersions(
      await versionStore()
        .list(id)
        .catch(() => []),
    );
  }, []);
  useEffect(() => {
    if (!projectId) return;
    versionStore()
      .list(projectId)
      .then(setVersions, () => setVersions([]));
  }, [projectId]);

  useEffect(() => {
    if (dialog) dialogRef.current?.showModal();
  }, [dialog]);

  useEffect(() => {
    if (!fitPendingRef.current) return;
    fitPendingRef.current = false;
    // React Flow queues this until the new nodes are measured.
    void flowRef.current?.fitView({ ...FIT, duration: 300 });
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

  const replaceUi: ReplaceUi = {
    confirmEdits: async () => (await ask(EDITED_DIALOG)) === 'replace',
    storageFailed: async () => (await ask(STORAGE_DIALOG)) as 'cancel' | 'replace' | 'export',
    exportJson: downloadJson,
  };

  /**
   * Replace step (spec §2.4), before any request: confirm hand edits and keep the current diagram
   * as a version. False means "do not generate": no request is sent.
   */
  const prepare = async (): Promise<boolean> => {
    const current = projectRef.current;
    if (preparedRef.current && preparedRef.current.project === current) return true;
    const kept = await prepareReplace(versionStore(), current, replaceUi);
    if (!kept) return false;
    if (kept.saved && current) {
      await refreshVersions(current.projectId);
      setVersionsAdded((n) => n + 1);
    }
    preparedRef.current = { ...kept, project: current };
    return true;
  };

  /** Shows a generated (already charged) project. Nothing here can discard it. */
  const showGenerated = async (generated: Project) => {
    const current = projectRef.current;
    const saved = preparedRef.current?.saved ?? undefined;
    preparedRef.current = undefined;
    setStep('checking');
    clearHistory();
    await commit(
      {
        ...migrateProject(generated),
        projectId: current?.projectId ?? generated.projectId,
        revision: (current?.revision ?? 0) + 1,
      },
      true,
      { fit: true },
    );
    setToast({ text: 'New diagram generated', restore: saved });
  };

  /** Restores a kept version; the diagram it replaces is kept as a version too. */
  const restore = (v: ProjectVersion) =>
    exclusive(async () => {
      const current = projectRef.current;
      setToast(undefined);
      const kept = await keepCurrent(versionStore(), current, replaceUi);
      if (!kept) return;
      if (kept.saved && current) {
        await refreshVersions(current.projectId);
        setVersionsAdded((n) => n + 1);
      }
      clearHistory();
      await commit(
        {
          ...migrateProject(v.project),
          projectId: current?.projectId ?? v.project.projectId,
          revision: (current?.revision ?? 0) + 1,
        },
        false,
        { recover: true, fit: true },
      );
    }).catch(showError);

  const showError = (err: unknown) => {
    if (errorCode(err) === 'setup_required') setSetupPending(true);
    setError(errorMessage(err));
  };

  /**
   * Runs one gateway call with step status and Cancel; handles questions, results and errors.
   * `fromClarify` (Continue): the clarification card, with the user's answers and edits, stays
   * until the call succeeds, and also after an error a retry can fix.
   */
  const run = async (
    call: (signal: AbortSignal) => Promise<GenerateResponse>,
    first: StepId,
    fromClarify = false,
  ) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setError(undefined);
    setToast(undefined);
    if (!fromClarify) setClarify(undefined);
    setStep(first);
    setStartedAt(Date.now());
    setCancellable(true);
    const timer =
      first === 'reading'
        ? setTimeout(() => !ac.signal.aborted && setStep('designing'), DESIGNING_AFTER_MS)
        : undefined;
    try {
      const res = await call(ac.signal);
      clearTimeout(timer);
      if (ac.signal.aborted) return;
      // The response is here: nothing left to cancel, the rest happens in the browser.
      abortRef.current = undefined;
      setCancellable(false);
      setStep((s) => (s === 'reading' ? 'designing' : s));
      setClarify(res.status === 'questions' ? res : undefined);
      if (res.status === 'done') await showGenerated(res.project);
    } catch (err) {
      if (ac.signal.aborted) return; // cancel() already reported it
      if (fromClarify && !isTransient(err)) setClarify(undefined);
      if (err instanceof ApiError && err.code === 'client_closed') setToast({ text: CANCELLED });
      else showError(err);
    } finally {
      clearTimeout(timer);
      // A newer run owns the step; otherwise this run is over.
      if (abortRef.current === ac || abortRef.current === undefined) {
        abortRef.current = undefined;
        setCancellable(false);
        setStep(undefined);
      }
    }
  };

  /** Generate and Continue: the replace step first, then the request, as one exclusive flow. */
  const generateFlow = (request: () => Promise<void>) =>
    exclusive(async () => {
      if (await prepare()) await request();
    }).catch(showError);

  const generate = (input: GenerateInput) =>
    generateFlow(() =>
      run(
        (signal) =>
          api.generate(
            {
              prompt: input.prompt,
              toggles: input.toggles,
              reviewRequirements: input.reviewRequirements,
              catalogVersion: awsCatalog.manifest.catalogVersion,
              model: modelState.choice,
            },
            signal,
          ),
        'reading',
      ),
    );

  const continueWith = (
    op: Questions,
    answers: Partial<Record<GapTopic, string>>,
    requirements: Requirement[],
  ) =>
    generateFlow(() =>
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
        'designing',
        true,
      ),
    );

  const cancel = () => {
    if (!abortRef.current && !clarify) return;
    abortRef.current?.abort();
    abortRef.current = undefined;
    setCancellable(false);
    setStep(undefined);
    setClarify(undefined);
    setToast({ text: CANCELLED });
  };

  // Typical wait for the chosen model (benchmark median), shown next to the timer.
  const typicalSeconds = Math.round(
    MODEL_OPTIONS.find((m) => m.id === (modelState.choice ?? 'haiku'))?.benchmark
      ?.medianLatencySeconds ?? 0,
  );

  /** What to select once the commit that added it has rendered. */
  const pendingSelect = useRef<Selection | undefined>(undefined);
  const canvasRef = useRef<HTMLElement>(null);

  /**
   * A generation, a replace flow, a dialog or Auto layout is in progress: hold every other change to
   * the diagram.
   */
  const busy = step !== undefined || replacing || dialog !== undefined || layingOut;

  /**
   * Every hand edit goes through here: the current design is remembered for Undo, then the change
   * is applied (patch ops, or a function of the latest project) and committed. Resolves once the
   * commit has landed (at once when nothing was changed).
   */
  const edit = useCallback(
    (
      change: PatchOp[] | ((p: Project) => Project),
      opts: { routes?: Routes; forceLayout?: boolean; fit?: boolean; toast?: string } = {},
    ): Promise<void> => {
      const current = projectRef.current;
      if (busy || !current) return Promise.resolve();
      let next: Project;
      try {
        next = Array.isArray(change)
          ? applyPatch(current, { baseRevision: current.revision, ops: change })
          : Project.parse({ ...change(current), revision: current.revision + 1 });
      } catch (err) {
        pendingSelect.current = undefined;
        setError(errorMessage(err));
        return Promise.resolve();
      }
      setHistory(record(historyRef.current, current));
      // A toast's Undo belongs to the edit that raised it: a later edit takes it away.
      setToast((t) => (opts.toast ? { text: opts.toast, undo: true } : t?.undo ? undefined : t));
      return commit(next, opts.forceLayout ?? false, {
        ...(opts.routes ? { routes: opts.routes } : {}),
        ...(opts.fit ? { fit: true } : {}),
      });
    },
    [busy, commit, setHistory],
  );

  // The item to select once the commit that added it has rendered.
  useEffect(() => {
    const pending = pendingSelect.current;
    if (!pending) return;
    const { kind, id } = pending;
    if (!(kind === 'edge' ? edges : nodes).some((x) => x.id === id)) return;
    pendingSelect.current = undefined;
    setEdges((es) => es.map((e) => ({ ...e, selected: kind === 'edge' && e.id === id })));
    setNodes((ns) => ns.map((n) => ({ ...n, selected: kind === 'node' && n.id === id })));
    setSelected({ kind, id });
  }, [nodes, edges]);

  // React Flow never deletes anything itself: the selected items go through edit(), then it is told no.
  const onBeforeDelete = useCallback(
    async ({ nodes: ns, edges: es }: { nodes: Node[]; edges: Edge[] }) => {
      const current = projectRef.current;
      if (busy || !current) return false;
      const ids = selectedIds(ns, es);
      const ops = deletionOps(current, ids);
      if (ops.length === 0) return false;
      const container = ops.some((o) => o.op === 'removeContainer');
      void edit(ops, container ? { toast: 'Container deleted' } : {});
      setSelected(undefined);
      return false;
    },
    [busy, edit],
  );

  const onConnect = useCallback(
    ({ source, target }: Connection) => {
      const current = projectRef.current;
      if (busy || !current) return;
      const problem = connectionError(current, source, target);
      if (problem) {
        setToast({ text: problem });
        return;
      }
      const edge = newEdge(source, target);
      pendingSelect.current = { kind: 'edge', id: edge.id };
      void edit([{ op: 'addEdge', edge }]);
    },
    [busy, edit],
  );

  const onReconnect = useCallback(
    (old: Edge, { source, target }: Connection) => {
      const current = projectRef.current;
      if (busy || !current) return;
      if (old.source === source && old.target === target) return;
      const without = { ...current, edges: current.edges.filter((e) => e.id !== old.id) };
      const problem = connectionError(without, source, target);
      if (problem) {
        setToast({ text: problem });
        return;
      }
      const routes = new Map(routesRef.current);
      routes.delete(old.id);
      void edit([{ op: 'updateEdge', id: old.id, changes: { source, target } }], { routes });
    },
    [busy, edit],
  );

  /**
   * Adds a catalog item. `drop` is an absolute flow point (the pointer); without it the item goes
   * inside the selected container, or at the centre of the canvas.
   */
  const addItem = (item: AddItem, drop?: { x: number; y: number }) => {
    const current = projectRef.current;
    const flow = flowRef.current;
    if (busy || !current || !flow) return;
    if (item.type !== 'container' && atNodeLimit(current)) {
      setToast({ text: 'This design has the maximum of 150 components.' });
      return;
    }
    const isContainer = item.type === 'container';
    const size = isContainer ? NEW_CONTAINER_SIZE : NODE_SIZE;
    let parent: Container | undefined;
    let at: { x: number; y: number };
    if (drop) {
      parent = containerAt(current, drop);
      const origin = absolutePosition(current, parent?.id);
      at = { x: drop.x - origin.x, y: drop.y - origin.y };
      if (!isContainer) {
        at = { x: at.x - size.width / 2, y: at.y - size.height / 2 };
      }
      // Keep it below the container's header, like the Add button does.
      if (parent) at = { x: Math.max(8, at.x), y: Math.max(32, at.y) };
    } else {
      const sel = selected?.kind === 'node' ? selected.id : undefined;
      parent = current.containers.find((c) => c.id === sel);
      if (parent?.size) {
        at = isContainer
          ? { x: 16, y: 32 }
          : {
              x: Math.max(8, (parent.size.width - size.width) / 2),
              y: Math.max(32, (parent.size.height - size.height) / 2),
            };
      } else {
        parent = undefined;
        const rect = canvasRef.current?.getBoundingClientRect();
        const centre = flow.screenToFlowPosition({
          x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2,
          y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2,
        });
        at = { x: centre.x - size.width / 2, y: centre.y - size.height / 2 };
      }
    }
    at = { x: Math.round(at.x), y: Math.round(at.y) };
    if (item.type === 'container') {
      if (!canNest(item.kind, parent?.kind)) {
        setToast({ text: nestRefusal(item.kind) });
        return;
      }
      const container = newContainer(item.kind, at, parent?.id);
      pendingSelect.current = { kind: 'node', id: container.id };
      void edit([{ op: 'addContainer', container }]);
      return;
    }
    const node =
      item.type === 'service'
        ? newServiceNode(item.serviceId, at, parent?.id)
        : newExternalNode(item.kind, at, parent?.id);
    pendingSelect.current = { kind: 'node', id: node.id };
    void edit([{ op: 'addNode', node }]);
  };

  const onCanvasDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onCanvasDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    let item: AddItem;
    try {
      item = JSON.parse(raw) as AddItem;
    } catch {
      return;
    }
    const flow = flowRef.current;
    if (!flow) return;
    addItem(item, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  const stepHistory = (move: typeof undo) => {
    const current = projectRef.current;
    if (busy || !current) return;
    const moved = move(historyRef.current, current);
    if (!moved) return;
    setHistory(moved.history);
    void commit(moved.project, false, { recover: true });
  };
  const undoEdit = () => stepHistory(undo);
  const redoEdit = () => stepHistory(redo);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = shouldHandleShortcut(e, busy);
      if (!action) return;
      e.preventDefault();
      if (action === 'undo') undoEdit();
      else redoEdit();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const findings: Finding[] = useMemo(
    () => (project ? validateProject(project, awsCatalog) : []),
    [project],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );

  // Edges take select changes only: removing or adding one is an edit of the Project.
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      setEdges((es) =>
        applyEdgeChanges(
          changes.filter((c) => c.type === 'select'),
          es,
        ),
      ),
    [],
  );

  /**
   * A drag commits the new position of every node React Flow moved, so nothing moves on screen
   * without being in the Project. Only a single service node re-parents: the container under its
   * dragged centre becomes the parent.
   */
  const onNodeDragStop = useCallback(
    (_: unknown, dragged: Node, draggedNodes: Node[]) => {
      const p = projectRef.current;
      if (!p) return;
      const all = draggedNodes.length > 0 ? draggedNodes : [dragged];
      const moved = new Map<string, { x: number; y: number }>();
      for (const d of all) {
        const box = p.nodes.find((n) => n.id === d.id) ?? p.containers.find((c) => c.id === d.id);
        if (!box) continue;
        const old = box.position ?? { x: 0, y: 0 };
        if (old.x !== d.position.x || old.y !== d.position.y) moved.set(d.id, d.position);
      }
      let reparent: { id: string; target: string | undefined } | undefined;
      const single = all.length === 1 ? all[0] : undefined;
      const node = single && p.nodes.find((n) => n.id === single.id);
      if (single && node && single.type === 'service') {
        const size = node.size ?? LEGACY_NODE_SIZE;
        const origin = absolutePosition(p, node.containerId);
        const target = containerAt(p, {
          x: origin.x + single.position.x + size.width / 2,
          y: origin.y + single.position.y + size.height / 2,
        })?.id;
        if (target !== node.containerId) reparent = { id: node.id, target };
      }
      if (!reparent && moved.size === 0) return;
      void edit(
        (q) => {
          const placed = {
            ...q,
            nodes: q.nodes.map((n) => {
              const position = moved.get(n.id);
              return position ? { ...n, position } : n;
            }),
            containers: q.containers.map((c) => {
              const position = moved.get(c.id);
              return position ? { ...c, position } : c;
            }),
          };
          return reparent ? reparentNode(placed, reparent.id, reparent.target) : placed;
        },
        {
          routes: dropRoutes(routesRef.current, p, [
            ...new Set([...moved.keys(), ...(reparent ? [reparent.id] : [])]),
          ]),
        },
      );
    },
    [edit],
  );

  /**
   * A resize is a hand edit like a drag. Left and top handles move the box too; React Flow then shifts
   * a container's children back by the same amount so they stay put on screen, and so does this.
   */
  const onResized = useCallback(
    (id: string, { x, y, width, height }: ResizeRect) => {
      const p = projectRef.current;
      if (!p) return;
      const box = p.nodes.find((n) => n.id === id) ?? p.containers.find((c) => c.id === id);
      if (!box) return;
      const old = box.position ?? { x: 0, y: 0 };
      if (old.x === x && old.y === y && box.size?.width === width && box.size?.height === height)
        return;
      const position = { x, y };
      const size = { width, height };
      const shift = (pos: { x: number; y: number }) => ({
        x: pos.x - (x - old.x),
        y: pos.y - (y - old.y),
      });
      void edit(
        (q) => ({
          ...q,
          nodes: q.nodes.map((n) =>
            n.id === id
              ? { ...n, position, size }
              : n.containerId === id
                ? { ...n, position: shift(n.position) }
                : n,
          ),
          containers: q.containers.map((c) =>
            c.id === id
              ? { ...c, position, size }
              : c.parentId === id && c.position
                ? { ...c, position: shift(c.position) }
                : c,
          ),
        }),
        { routes: dropRoutes(routesRef.current, p, [id]) },
      );
    },
    [edit],
  );

  /** Loads the official icons, polling every 3 s only while a download is plausibly running (see `nextIconStep`). */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop = false;
    const run = async (attempts: number) => {
      try {
        const { state, urls } = await loadIcons(DEMO ? demoIconSource : () => api.icons());
        if (stop) return;
        const step = nextIconStep(state, attempts);
        if (state === 'ready') setIconUrls(urls);
        // 'missing' shows no notice; giving up leaves generic tiles without one either.
        setIconState(step === 'give-up' || state === 'missing' ? undefined : state);
        if (step === 'retry' && !DEMO) await api.retryIcons().catch(() => undefined);
        if (step === 'retry' || step === 'poll')
          timer = setTimeout(() => void run(attempts + 1), 3000);
      } catch {
        if (!stop) setIconState(undefined); // gateway unreachable: generic tiles, no notice
      }
    };
    void run(0);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [iconTick]);

  const retryIcons = () => {
    setIconState('fetching');
    api.retryIcons().then(
      () => setIconTick((t) => t + 1),
      () => setIconState('failed'),
    );
  };

  /** Nodes as drawn: resize handles only while nothing else is running; containers know their minimum. */
  const shownNodes = useMemo(
    () =>
      nodes.map((n): Node => {
        const editable: EditableData = {
          resizable: !busy,
          onResized,
          ...(n.type === 'container' && project
            ? {
                minSize: containerMinSize(project, n.id),
                fits: (rect: ResizeRect) => fitsChildren(project, n.id, rect),
              }
            : {}),
        };
        const data = n.data as Partial<ServiceNodeData & ContainerNodeData>;
        const iconUrl = data.node
          ? serviceIcon(data.node, iconUrls)
          : data.container
            ? containerIcon(data.container, iconUrls)
            : undefined;
        return { ...n, data: { ...n.data, ...editable, ...(iconUrl ? { iconUrl } : {}) } };
      }),
    [nodes, busy, onResized, project, iconUrls],
  );

  /** Selects and highlights what a finding is about; edge findings point at the consuming node. */
  const locate = (f: Finding) => {
    const id =
      f.nodeIds[0] ??
      f.containerIds[0] ??
      project?.edges.find((e) => e.id === f.edgeIds[0])?.target;
    if (!id) return;
    setSelected({ kind: 'node', id });
    setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
  };

  const exportMenu = useRef<HTMLDetailsElement>(null);
  // The Export menu is a <details>; close it on a click outside it and on Escape, like a menu.
  useEffect(() => {
    const menu = exportMenu.current;
    if (!menu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menu.open && !menu.contains(e.target as globalThis.Node)) menu.open = false;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !menu.open) return;
      menu.open = false;
      menu.querySelector('summary')?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const exportAs = async (format: ImageFormat) => {
    if (exportMenu.current) exportMenu.current.open = false;
    const viewport = document.querySelector<HTMLElement>('.canvas .react-flow__viewport');
    const flow = flowRef.current;
    if (!project || !viewport || !flow) return;
    // Selection highlighting is editing state, not part of the diagram: drop it for the render and
    // put it back afterwards (the demo opens with a node selected).
    const selectedNodes = new Set(
      flow
        .getNodes()
        .filter((n) => n.selected)
        .map((n) => n.id),
    );
    const selectedEdges = new Set(
      flow
        .getEdges()
        .filter((e) => e.selected)
        .map((e) => e.id),
    );
    const detailsFor = selected;
    const hadSelection = selectedNodes.size > 0 || selectedEdges.size > 0;
    if (hadSelection) {
      setNodes((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
      setEdges((es) => es.map((e) => (e.selected ? { ...e, selected: false } : e)));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    try {
      await exportImage(format, viewport, flow.getNodes(), {
        background: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),
        fileName: project.name,
      });
    } catch (err) {
      setError(`Could not export the image: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (hadSelection) {
        setNodes((ns) => ns.map((n) => (selectedNodes.has(n.id) ? { ...n, selected: true } : n)));
        setEdges((es) => es.map((e) => (selectedEdges.has(e.id) ? { ...e, selected: true } : e)));
        setSelected(detailsFor);
      }
    }
  };

  return (
    <div className="app">
      <header className="bar">
        <strong>CloudArchitect Lite</strong>
        <span className="muted">{project?.name}</span>
        <span className="spacer" />
        <button aria-pressed={theme === 'dark'} onClick={toggleTheme}>
          Dark mode
        </button>
        <button
          disabled={busy}
          onClick={() => {
            setLayingOut(true);
            void edit((p) => p, { forceLayout: true, fit: true }).finally(() =>
              setLayingOut(false),
            );
          }}
        >
          Auto layout
        </button>
        <button
          aria-label="Undo"
          title="Undo (⌘Z / Ctrl+Z)"
          aria-keyshortcuts="Meta+Z Control+Z"
          disabled={busy || !canUndo}
          onClick={undoEdit}
        >
          Undo
        </button>
        <button
          aria-label="Redo"
          title="Redo (⇧⌘Z / Ctrl+Shift+Z)"
          aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z Control+Y"
          disabled={busy || !canRedo}
          onClick={redoEdit}
        >
          Redo
        </button>
        <details className="menu" ref={exportMenu}>
          <summary>Export</summary>
          <div className="menu-items">
            <button disabled={!project || !canExport(project)} onClick={() => void exportAs('png')}>
              PNG image
            </button>
            <button disabled={!project || !canExport(project)} onClick={() => void exportAs('svg')}>
              SVG image
            </button>
            <button
              disabled={!project}
              onClick={() => {
                if (project) downloadJson(project);
                if (exportMenu.current) exportMenu.current.open = false;
              }}
            >
              JSON project
            </button>
          </div>
        </details>
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
                (p) => {
                  clearHistory();
                  return commit(p, false, { recover: true, fit: true });
                },
                (err: Error) => setError(err.message),
              );
          }}
        />
      </header>
      {DEMO && (
        <div className="notice">
          {DEMO_BANNER}{' '}
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            View on GitHub
          </a>
        </div>
      )}
      {setupPending && (
        <div className="notice">
          AI features are not set up yet. Open the setup link printed in the server log (
          <code>docker compose logs gateway</code>) to finish setup; manual editing works meanwhile.
        </div>
      )}
      {iconState === 'fetching' && (
        <div role="status" className="notice">
          Downloading the official AWS icons (first start only)…
        </div>
      )}
      {iconState === 'failed' && !DEMO && (
        <div role="alert" className="notice">
          The official AWS icons could not be downloaded, so diagrams show generic tiles.{' '}
          <button type="button" className="link" onClick={retryIcons}>
            Retry
          </button>
        </div>
      )}
      {storageDown && (
        <div role="alert" className="notice">
          Browser storage is unavailable — close other CloudArchitect tabs and reload. Changes are
          not being saved.
        </div>
      )}
      {error && (
        <div role="alert" className="alert" onClick={() => setError(undefined)}>
          {error}
        </div>
      )}
      <main
        className="main"
        style={{ '--panel-w': `${Math.round(sideWidth)}px` } as React.CSSProperties}
      >
        <section
          ref={canvasRef}
          className={step ? 'canvas is-busy' : 'canvas'}
          aria-label="Architecture canvas"
          onDragOver={onCanvasDragOver}
          onDrop={onCanvasDrop}
        >
          {clarify && (
            <div className="overlay">
              <ClarifyCard
                key={clarify.operationId}
                questions={clarify.questions}
                requirements={clarify.requirements}
                assumptions={clarify.assumptions}
                onContinue={(answers, reqs) => continueWith(clarify, answers, reqs)}
                onCancel={cancel}
                disabled={busy}
              />
            </div>
          )}
          <ReactFlow
            nodes={shownNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={onNodeDragStop}
            deleteKeyCode={['Backspace', 'Delete']}
            onBeforeDelete={onBeforeDelete}
            onConnect={onConnect}
            onReconnect={onReconnect}
            nodesConnectable={!busy}
            edgesReconnectable={!busy}
            onInit={(flow) => (flowRef.current = flow)}
            nodesDraggable={!busy}
            onSelectionChange={({ nodes: ns, edges: es }) =>
              setSelected(
                ns[0]
                  ? { kind: 'node', id: ns[0].id }
                  : es[0]
                    ? { kind: 'edge', id: es[0].id }
                    : undefined,
              )
            }
            fitView
            fitViewOptions={FIT}
            minZoom={0.2}
            colorMode={theme}
          >
            <Background />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
        </section>
        <aside className="side">
          <div
            className="resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            aria-valuenow={Math.round(sideWidth)}
            aria-valuemin={PANEL_MIN}
            aria-valuemax={maxPanelWidth(winWidth)}
            tabIndex={0}
            onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                chooseWidth(clampPanelWidth(window.innerWidth - e.clientX, window.innerWidth));
            }}
            onPointerUp={persistWidth}
            onPointerCancel={persistWidth}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              const delta = e.key === 'ArrowLeft' ? PANEL_STEP : -PANEL_STEP;
              chooseWidth(clampPanelWidth(sideWidth + delta, window.innerWidth));
            }}
            onKeyUp={persistWidth}
          />
          <div className="side-scroll">
            <GeneratePanel
              hasDiagram={Boolean(project?.nodes.length)}
              busy={busy}
              cancellable={cancellable}
              step={step}
              startedAt={startedAt}
              typicalSeconds={typicalSeconds}
              onGenerate={generate}
              onCancel={cancel}
            />
            {project && selected && (
              <Details
                project={project}
                selection={selected}
                disabled={busy}
                onEdit={(ops) => {
                  const removing = ops.some((o) => o.op === 'removeContainer');
                  void edit(ops, removing ? { toast: 'Container deleted' } : {});
                  if (ops.some((o) => o.op.startsWith('remove'))) setSelected(undefined);
                }}
              />
            )}
            {project && (
              <AddPanel
                disabled={busy}
                atLimit={atNodeLimit(project)}
                iconUrls={iconUrls}
                onAdd={(item) => addItem(item)}
              />
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
            <VersionsPanel
              versions={versions}
              onRestore={restore}
              disabled={busy}
              openSignal={versionsAdded}
            />
            <AiModelPanel state={modelState} />
            <p className="muted small">
              Generated designs require professional review before production use.{' '}
              {iconState === 'ready'
                ? 'Official AWS icons are shown unmodified; generic tiles mark anything without one.'
                : 'Icons shown are generic placeholders until the official icons are downloaded.'}
            </p>
          </div>
        </aside>
      </main>
      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <>
              {' · '}
              <button className="link" disabled={busy} onClick={undoEdit}>
                Undo
              </button>
            </>
          )}
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
