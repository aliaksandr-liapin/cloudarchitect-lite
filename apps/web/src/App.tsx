import { awsCatalog, samples } from '@cloudarchitect/catalog';
import {
  MODEL_OPTIONS,
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
  type Edge,
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
  keepFlowState,
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

type Toast = { text: string; restore?: ProjectVersion };

/** Fit the whole diagram with padding, never zooming past 100 %. */
const FIT: FitViewOptions = { padding: 0.12, maxZoom: 1 };
const NO_ROUTES: Routes = new Map();

export function App() {
  const [project, setProject] = useState<Project>();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selected, setSelected] = useState<string>();
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
  /** The diagram the replace step already confirmed and kept, so a retry or Continue does not ask again. */
  const preparedRef = useRef<Kept & { project: Project | undefined }>(undefined);

  const versionStore = () => (storageDownRef.current ? unavailableVersionStore : idbVersionStore);

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
      setEdges(flow.edges);
      if (opts.recover && !layout) {
        void recoverRoutes(laid).then(
          (recovered) => {
            // A newer commit owns the diagram (and its routes) now.
            if (projectRef.current !== laid) return;
            routesRef.current = recovered;
            setEdges(toFlow(laid, displayName, recovered).edges);
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
      return commit(project, false, { recover: true }).then(() => {
        if (!DEMO) return;
        const id = demoBootSelection(project);
        if (!id) return;
        setSelected(id);
        setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
      });
    });
  }, [commit]);

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

  // Typical wait for the chosen model (benchmark median), shown next to the timer.
  const typicalSeconds = Math.round(
    MODEL_OPTIONS.find((m) => m.id === (modelState.choice ?? 'haiku'))?.benchmark
      ?.medianLatencySeconds ?? 0,
  );

  /** A generation, a replace flow or a dialog is in progress: hold every other change to the diagram. */
  const busy = step !== undefined || replacing || dialog !== undefined;

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
      void commit(
        {
          ...project,
          revision: project.revision + 1,
          nodes: project.nodes.map((n) => (n.id === dragged.id ? { ...n, position } : n)),
          containers: project.containers.map((c) => (c.id === dragged.id ? { ...c, position } : c)),
        },
        false,
        { routes: dropRoutes(routesRef.current, project, [dragged.id]) },
      );
    },
    [project, commit],
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
      void commit(
        {
          ...p,
          revision: p.revision + 1,
          nodes: p.nodes.map((n) =>
            n.id === id
              ? { ...n, position, size }
              : n.containerId === id
                ? { ...n, position: shift(n.position) }
                : n,
          ),
          containers: p.containers.map((c) =>
            c.id === id
              ? { ...c, position, size }
              : c.parentId === id && c.position
                ? { ...c, position: shift(c.position) }
                : c,
          ),
        },
        false,
        { routes: dropRoutes(routesRef.current, p, [id]) },
      );
    },
    [commit],
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
    setSelected(id);
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
        <button disabled={busy} onClick={() => project && commit(project, true, { fit: true })}>
          Auto layout
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
                (p) => commit(p, false, { recover: true, fit: true }),
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
        <section className={step ? 'canvas is-busy' : 'canvas'} aria-label="Architecture canvas">
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
            onNodeDragStop={onNodeDragStop}
            onInit={(flow) => (flowRef.current = flow)}
            nodesDraggable={!busy}
            onSelectionChange={({ nodes: sel }) => setSelected(sel[0]?.id)}
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
