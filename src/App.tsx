import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BpmnPane } from './components/BpmnPane';
import { ConflictDialog } from './components/ConflictDialog';
import { HoverCard, type HoverCardContent } from './components/HoverCard';
import { PromptDialog } from './components/PromptDialog';
import { Sidebar } from './components/Sidebar';
import { SettingsDialog } from './components/SettingsDialog';
import { TextPane, type LineRange } from './components/TextPane';
import { VsmPane } from './components/VsmPane';
import { api, unwrap } from './lib/api';
import { geometryKey, structuralKey, type ReadResult } from './lib/bpmnRead';
import {
  applyProcessTranslation,
  breadcrumbFor,
  diagramChoices,
  pushCommit,
} from './lib/commit';
import { computeConflicts } from './model/diff';
import { explainChannel, explainNodeType, explainVsmType } from './model/glossary';
import { diagramId, nodeId, projectId } from './model/ids';
import { layoutProcessFull, layoutVsm } from './model/layout';
import { createSeedProject } from './model/seed';
import { applyVsmResolutions, computeVsmConflicts } from './model/vsmDiff';
import type {
  Conflict,
  ConflictResolution,
  Mode,
  ProcessDiagram,
  Project,
  ProjectSummary,
  VsmDiagram,
} from './model/types';
import type { ProviderInfo, PublicConfig } from './types/globals';

type Banner = { tone: 'info' | 'error' | 'ok'; message: string } | null;

interface ProcessConflictSession {
  kind: 'process';
  conflicts: Conflict[];
  fromText: { nodes: ProcessDiagram['nodes']; edges: ProcessDiagram['edges'] };
  fromDiagram: { nodes: ProcessDiagram['nodes']; edges: ProcessDiagram['edges'] };
  baseText: string;
  editedText: string;
  diagramId: string;
}

interface VsmConflictSession {
  kind: 'vsm';
  conflicts: Conflict[];
  fromText: { nodes: VsmDiagram['nodes']; edges: VsmDiagram['edges'] };
  fromDiagram: { nodes: VsmDiagram['nodes']; edges: VsmDiagram['edges'] };
  editedText: string;
}

type ConflictSession = ProcessConflictSession | VsmConflictSession;

const VSM_DRAFT_KEY = '__vsm__';

export default function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('process');
  const [focusId, setFocusId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<Record<string, ReadResult>>({});
  const [workingVsm, setWorkingVsm] = useState<VsmDiagram | null>(null);
  const [revision, setRevision] = useState(0);

  const [hover, setHover] = useState<{ content: HoverCardContent; point: { x: number; y: number } } | null>(
    null,
  );
  const [hoverIds, setHoverIds] = useState<string[]>([]);
  const [hoverLines, setHoverLines] = useState<LineRange[]>([]);

  const [session, setSession] = useState<ConflictSession | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, ConflictResolution>>({});
  const [activeConflictId, setActiveConflictId] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [namingProject, setNamingProject] = useState(false);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);

  const adoptConfig = useCallback((config: PublicConfig) => {
    setProvider(config.providers.find((p) => p.id === config.provider) ?? null);
  }, []);

  useEffect(() => {
    void unwrap(api.config.get()).then(adoptConfig).catch(() => undefined);
  }, [adoptConfig]);

  // ------------------------------------------------------------------ derived

  const viewingCommit = project?.history[historyIndex] ?? null;
  const atHead = project ? historyIndex === project.history.length - 1 : true;
  const content = viewingCommit?.snapshot ?? project?.content ?? null;

  const committedDiagram: ProcessDiagram | null = content
    ? content.diagrams[focusId] ?? content.diagrams[content.rootDiagramId] ?? null
    : null;
  const committedVsm = content?.vsm ?? null;

  const draftKey = mode === 'vsm' ? VSM_DRAFT_KEY : committedDiagram?.id ?? '';
  const committedText = (mode === 'vsm' ? committedVsm?.text : committedDiagram?.text) ?? '';
  const draftText = atHead ? drafts[draftKey] ?? committedText : committedText;

  const canvasModel = committedDiagram
    ? working[committedDiagram.id] ?? {
        nodes: committedDiagram.nodes,
        edges: committedDiagram.edges,
      }
    : null;

  const displayDiagram: ProcessDiagram | null =
    committedDiagram && canvasModel && atHead
      ? { ...committedDiagram, nodes: canvasModel.nodes, edges: canvasModel.edges }
      : committedDiagram;

  const displayVsm = atHead ? workingVsm ?? committedVsm : committedVsm;

  const textDirty = atHead && draftText.trim() !== committedText.trim();
  const structureDirty =
    atHead &&
    mode === 'process' &&
    !!committedDiagram &&
    !!canvasModel &&
    structuralKey(canvasModel.nodes, canvasModel.edges) !==
      structuralKey(committedDiagram.nodes, committedDiagram.edges);
  const geometryDirty =
    atHead &&
    mode === 'process' &&
    !!committedDiagram &&
    !!canvasModel &&
    geometryKey(canvasModel.nodes, canvasModel.edges) !==
      geometryKey(committedDiagram.nodes, committedDiagram.edges);
  const vsmDirty =
    atHead &&
    mode === 'vsm' &&
    !!committedVsm &&
    !!workingVsm &&
    JSON.stringify(stripVsm(workingVsm)) !== JSON.stringify(stripVsm(committedVsm));

  const diagramDirty = mode === 'vsm' ? vsmDirty : structureDirty || geometryDirty;
  const anythingDirty = textDirty || diagramDirty;

  const breadcrumb = content && committedDiagram ? breadcrumbFor(content, committedDiagram.id) : [];

  // ---------------------------------------------------------------- highlights

  const activeConflict = session?.conflicts.find((c) => c.id === activeConflictId) ?? null;
  const commitHighlightIds = !atHead && viewingCommit ? viewingCommit.changes.map((c) => c.id) : [];

  const highlightIds = activeConflict
    ? [activeConflict.elementId]
    : commitHighlightIds.length
      ? commitHighlightIds
      : hoverIds;

  const highlightLines: LineRange[] = activeConflict
    ? activeConflict.textLines
      ? [{ from: activeConflict.textLines[0], to: activeConflict.textLines[1], tone: 'active' }]
      : []
    : hoverLines;

  // ------------------------------------------------------------------ loading

  const refreshProjects = useCallback(async () => {
    setProjects(await unwrap(api.projects.list()));
  }, []);

  const openProject = useCallback(async (id: string) => {
    const loaded = await unwrap(api.projects.read(id));
    if (!loaded) return;
    setProject(loaded);
    setHistoryIndex(loaded.history.length - 1);
    setFocusId(loaded.content.rootDiagramId);
    setMode('process');
    setDrafts({});
    setWorking({});
    setWorkingVsm(null);
    setSession(null);
    setBanner(null);
    setRevision((r) => r + 1);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        let list = await unwrap(api.projects.list());
        if (!list.length) {
          // First launch: the example project is the tutorial.
          await unwrap(api.projects.write(createSeedProject()));
          list = await unwrap(api.projects.list());
        }
        setProjects(list);
        if (list[0]) await openProject(list[0].id);
        // Positive proof the renderer mounted and reached the main process.
        // Visible in the terminal when launched with ELECTRON_ENABLE_LOGGING=1.
        console.info(`[vsm] ready — ${list.length} project(s) loaded`);
      } catch (error) {
        setBanner({ tone: 'error', message: messageOf(error) });
      }
    })();
  }, [openProject]);

  // ------------------------------------------------------------------ persist

  const persist = useCallback(
    async (
      next: Project,
      focus: string,
      nextMode: Mode,
      options: { preserveDrafts?: boolean } = {},
    ) => {
      const saved = await unwrap(api.projects.write(next));
      setProject(saved);
      setHistoryIndex(saved.history.length - 1);
      setFocusId(focus);
      setMode(nextMode);
      // A structural commit (drilling in) leaves the author's unsaved prose alone.
      if (!options.preserveDrafts) setDrafts({});
      setWorking({});
      setWorkingVsm(null);
      setSession(null);
      setRevision((r) => r + 1);
      await refreshProjects();
    },
    [refreshProjects],
  );

  // ------------------------------------------------------------------- commit

  const runCommit = useCallback(
    async (auto = false, overrideResolutions?: Record<string, ConflictResolution>) => {
      if (!project || !content || !atHead || busy) return;
      setBanner(null);

      try {
        if (mode === 'vsm') {
          await commitVsm(auto, overrideResolutions);
        } else {
          await commitProcess(auto, overrideResolutions);
        }
      } catch (error) {
        setBanner({ tone: 'error', message: messageOf(error) });
      } finally {
        setBusy(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, content, atHead, busy, mode, draftText, canvasModel, workingVsm, session, resolutions],
  );

  async function commitProcess(
    auto: boolean,
    overrideResolutions?: Record<string, ConflictResolution>,
  ) {
    if (!project || !content || !committedDiagram || !canvasModel) return;
    const base = committedDiagram;

    // Resuming from the conflict dialog.
    if (session?.kind === 'process') {
      setBusy('Merging both sides…');
      const merged = await unwrap(
        api.translate.merge({
          diagramName: base.name,
          baseText: session.baseText,
          editedText: session.editedText,
          base: { nodes: base.nodes, edges: base.edges },
          fromText: session.fromText,
          fromDiagram: session.fromDiagram,
          conflicts: session.conflicts,
          resolutions: Object.values(overrideResolutions ?? resolutions),
          auto,
        }),
      );
      const applied = applyProcessTranslation(
        { nodes: merged.nodes, edges: merged.edges },
        { ...base, nodes: session.fromDiagram.nodes, edges: session.fromDiagram.edges },
        merged.text,
      );
      await commitDiagram(applied, 'merge', 'merged text and diagram');
      if (merged.notes.length) {
        setBanner({ tone: 'ok', message: merged.notes.join(' · ') });
      }
      return;
    }

    if (!textDirty && !structureDirty && !geometryDirty) {
      setBanner({ tone: 'info', message: 'Nothing to commit — both sides already match.' });
      return;
    }

    // Layout-only change: no translation needed, and none should happen.
    if (!textDirty && !structureDirty) {
      await commitDiagram(
        {
          diagram: { ...base, nodes: canvasModel.nodes, edges: canvasModel.edges },
          newDiagrams: {},
        },
        'structural',
        'repositioned elements',
      );
      return;
    }

    if (textDirty && !structureDirty) {
      setBusy('Translating text into the diagram…');
      const translated = await unwrap(
        api.translate.textToProcess({
          text: draftText,
          current: { nodes: base.nodes, edges: base.edges },
          diagramName: base.name,
        }),
      );
      const applied = applyProcessTranslation(
        translated,
        { ...base, nodes: canvasModel.nodes, edges: canvasModel.edges },
        draftText,
      );
      await commitDiagram(applied, 'text->diagram', 'updated from the text');
      return;
    }

    if (!textDirty && structureDirty) {
      setBusy('Describing the diagram in words…');
      const text = await unwrap(
        api.translate.processToText({
          nodes: canvasModel.nodes,
          edges: canvasModel.edges,
          diagramName: base.name,
          previousText: base.text,
        }),
      );
      const applied = applyProcessTranslation(
        { nodes: canvasModel.nodes, edges: canvasModel.edges },
        base,
        text,
      );
      await commitDiagram(applied, 'diagram->text', 'updated from the diagram');
      return;
    }

    // Both sides moved: find out exactly how they disagree before touching anything.
    setBusy('Comparing your text against your diagram…');
    const fromText = await unwrap(
      api.translate.textToProcess({
        text: draftText,
        current: { nodes: base.nodes, edges: base.edges },
        diagramName: base.name,
      }),
    );
    const conflicts = computeConflicts(
      { nodes: base.nodes, edges: base.edges },
      fromText,
      canvasModel,
    );
    const nextSession: ProcessConflictSession = {
      kind: 'process',
      conflicts,
      fromText,
      fromDiagram: canvasModel,
      baseText: base.text,
      editedText: draftText,
      diagramId: base.id,
    };

    if (!conflicts.length) {
      // Nothing genuinely disagrees — merge without interrupting.
      setSession(nextSession);
      setBusy('Merging both sides…');
      const merged = await unwrap(
        api.translate.merge({
          diagramName: base.name,
          baseText: base.text,
          editedText: draftText,
          base: { nodes: base.nodes, edges: base.edges },
          fromText,
          fromDiagram: canvasModel,
          conflicts: [],
          resolutions: [],
          auto: true,
        }),
      );
      const applied = applyProcessTranslation(
        { nodes: merged.nodes, edges: merged.edges },
        { ...base, nodes: canvasModel.nodes, edges: canvasModel.edges },
        merged.text,
      );
      await commitDiagram(applied, 'merge', 'merged text and diagram');
      return;
    }

    setBusy(null);
    setSession(nextSession);
    setResolutions(
      Object.fromEntries(
        conflicts.map((c) => [c.id, { conflictId: c.id, choice: c.suggested } as ConflictResolution]),
      ),
    );
    setActiveConflictId(conflicts[0]?.id ?? null);
  }

  async function commitDiagram(
    applied: ReturnType<typeof applyProcessTranslation>,
    direction: Parameters<typeof pushCommit>[2]['direction'],
    fallback: string,
  ) {
    if (!project || !content) return;
    const nextContent = {
      ...content,
      diagrams: {
        ...content.diagrams,
        [applied.diagram.id]: applied.diagram,
        ...applied.newDiagrams,
      },
    };
    const next = pushCommit(project, nextContent, {
      direction,
      mode: 'process',
      focusDiagramId: applied.diagram.id,
      fallbackSummary: fallback,
    });
    await persist(next, applied.diagram.id, 'process');
  }

  async function commitVsm(
    auto: boolean,
    overrideResolutions?: Record<string, ConflictResolution>,
  ) {
    if (!project || !content || !committedVsm) return;
    const base = committedVsm;
    const canvas = workingVsm ?? base;

    if (session?.kind === 'vsm') {
      const chosen = auto
        ? Object.fromEntries(
            session.conflicts.map((c) => [
              c.id,
              { conflictId: c.id, choice: c.suggested } as ConflictResolution,
            ]),
          )
        : (overrideResolutions ?? resolutions);
      const applied = applyVsmResolutions(
        base,
        session.fromText,
        session.fromDiagram,
        session.conflicts,
        chosen,
      );
      setBusy('Describing the merged model in words…');
      const text = await unwrap(
        api.translate.vsmToText({
          nodes: applied.nodes,
          edges: applied.edges,
          previousText: session.editedText,
        }),
      );
      await commitVsmDiagram(
        { ...base, text, nodes: layoutVsm(applied.nodes), edges: applied.edges },
        'merge',
        'merged text and VSM diagram',
      );
      return;
    }

    if (!textDirty && !vsmDirty) {
      setBanner({ tone: 'info', message: 'Nothing to commit — both sides already match.' });
      return;
    }

    if (textDirty && !vsmDirty) {
      setBusy('Translating text into the VSM diagram…');
      const translated = await unwrap(
        api.translate.textToVsm({
          text: draftText,
          current: { nodes: base.nodes, edges: base.edges },
          availableDiagrams: diagramChoices(content),
        }),
      );
      const positioned = layoutVsm(carryVsmGeometry(translated.nodes, base.nodes));
      await commitVsmDiagram(
        { ...base, text: draftText, nodes: positioned, edges: translated.edges },
        'text->diagram',
        'updated the VSM from the text',
      );
      return;
    }

    if (!textDirty && vsmDirty) {
      setBusy('Describing the VSM in words…');
      const text = await unwrap(
        api.translate.vsmToText({
          nodes: canvas.nodes,
          edges: canvas.edges,
          previousText: base.text,
        }),
      );
      await commitVsmDiagram(
        { ...base, text, nodes: canvas.nodes, edges: canvas.edges },
        'diagram->text',
        'updated the description from the VSM',
      );
      return;
    }

    setBusy('Comparing your text against your VSM diagram…');
    const translated = await unwrap(
      api.translate.textToVsm({
        text: draftText,
        current: { nodes: base.nodes, edges: base.edges },
        availableDiagrams: diagramChoices(content),
      }),
    );
    const fromText = {
      nodes: carryVsmGeometry(translated.nodes, base.nodes),
      edges: translated.edges,
    };
    const conflicts = computeVsmConflicts(base, fromText, canvas);
    const nextSession: VsmConflictSession = {
      kind: 'vsm',
      conflicts,
      fromText,
      fromDiagram: canvas,
      editedText: draftText,
    };

    if (!conflicts.length) {
      const applied = applyVsmResolutions(base, fromText, canvas, [], {});
      setBusy('Describing the merged model in words…');
      const text = await unwrap(
        api.translate.vsmToText({
          nodes: applied.nodes,
          edges: applied.edges,
          previousText: draftText,
        }),
      );
      await commitVsmDiagram(
        { ...base, text, nodes: layoutVsm(applied.nodes), edges: applied.edges },
        'merge',
        'merged text and VSM diagram',
      );
      return;
    }

    setBusy(null);
    setSession(nextSession);
    setResolutions(
      Object.fromEntries(
        conflicts.map((c) => [c.id, { conflictId: c.id, choice: c.suggested } as ConflictResolution]),
      ),
    );
    setActiveConflictId(conflicts[0]?.id ?? null);
  }

  async function commitVsmDiagram(
    vsm: VsmDiagram,
    direction: Parameters<typeof pushCommit>[2]['direction'],
    fallback: string,
  ) {
    if (!project || !content) return;
    const next = pushCommit(
      project,
      { ...content, vsm },
      { direction, mode: 'vsm', focusDiagramId: focusId, fallbackSummary: fallback },
    );
    await persist(next, focusId, 'vsm');
  }

  // ------------------------------------------------------------------ actions

  const drillInto = useCallback(
    async (targetId: string) => {
      if (!project || !content || !committedDiagram || !canvasModel) return;
      const node = canvasModel.nodes.find((n) => n.id === targetId);
      if (!node) return;

      // Already has a child diagram: just navigate.
      if (node.childDiagramId && content.diagrams[node.childDiagramId]) {
        setFocusId(node.childDiagramId);
        setMode('process');
        setRevision((r) => r + 1);
        return;
      }
      if (!atHead) return;

      // First time in: give the box a real child diagram and commit that, so the
      // nesting survives a restart rather than living only in memory. Any prose
      // you were part-way through writing is left untouched.
      const childId = diagramId();
      const child: ProcessDiagram = {
        id: childId,
        name: node.name || 'Sub-process',
        parentDiagramId: committedDiagram.id,
        parentNodeId: node.id,
        text: '',
        nodes: [],
        edges: [],
      };
      const parent: ProcessDiagram = {
        ...committedDiagram,
        nodes: canvasModel.nodes.map((n) =>
          n.id === targetId ? { ...n, type: 'subProcess' as const, childDiagramId: childId } : n,
        ),
        edges: canvasModel.edges,
      };
      const next = pushCommit(
        project,
        {
          ...content,
          diagrams: { ...content.diagrams, [parent.id]: parent, [childId]: child },
        },
        {
          direction: 'structural',
          mode: 'process',
          focusDiagramId: parent.id,
          fallbackSummary: `opened “${node.name || 'a step'}” as a sub-process`,
        },
      );
      await persist(next, childId, 'process', { preserveDrafts: true });
    },
    [project, content, committedDiagram, canvasModel, atHead, persist],
  );

  const expandToSubProcess = useCallback(
    (targetId: string) => {
      if (!committedDiagram) return;
      setWorking((current) => {
        const model = current[committedDiagram.id] ?? {
          nodes: committedDiagram.nodes,
          edges: committedDiagram.edges,
        };
        return {
          ...current,
          [committedDiagram.id]: {
            ...model,
            nodes: model.nodes.map((n) =>
              n.id === targetId ? { ...n, type: 'subProcess' as const } : n,
            ),
          },
        };
      });
      setRevision((r) => r + 1);
      setBanner({
        tone: 'info',
        message: 'Turned into a sub-process. Double-click it to drill in and fill it out.',
      });
    },
    [committedDiagram],
  );

  const tidy = useCallback(() => {
    if (!atHead) return;
    if (mode === 'vsm') {
      const vsm = displayVsm;
      if (!vsm) return;
      setWorkingVsm({ ...vsm, nodes: layoutVsm(vsm.nodes.map((n) => ({ ...n, width: 0, height: 0 })), false) });
      return;
    }
    if (!committedDiagram || !canvasModel) return;
    setWorking((current) => ({
      ...current,
      [committedDiagram.id]: {
        nodes: layoutProcessFull(
          canvasModel.nodes.map((n) => ({ ...n, x: undefined, y: undefined })),
          canvasModel.edges,
        ),
        edges: canvasModel.edges.map(({ waypoints, ...rest }) => rest),
      },
    }));
    setRevision((r) => r + 1);
  }, [atHead, mode, displayVsm, committedDiagram, canvasModel]);

  const createProject = useCallback(async (name: string) => {
    const rootId = diagramId();
    const startId = nodeId();
    const fresh: Project = {
      id: projectId(),
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      content: {
        rootDiagramId: rootId,
        diagrams: {
          [rootId]: {
            id: rootId,
            name,
            text: '',
            nodes: layoutProcessFull(
              [{ id: startId, type: 'startEvent', name: 'Start' }],
              [],
            ),
            edges: [],
          },
        },
        vsm: { id: `Vsm_${rootId}`, name: `${name} as a viable system`, text: '', nodes: [], edges: [] },
      },
      history: [],
    };
    const seeded = pushCommit(fresh, fresh.content, {
      direction: 'init',
      mode: 'process',
      focusDiagramId: rootId,
      fallbackSummary: 'created the project',
    });
    await unwrap(api.projects.write(seeded));
    await refreshProjects();
    await openProject(seeded.id);
  }, [openProject, refreshProjects]);

  const newProject = useCallback(() => setNamingProject(true), []);

  const deleteProject = useCallback(
    async (id: string) => {
      const removed = await unwrap(api.projects.remove(id));
      if (!removed) return;
      const list = await unwrap(api.projects.list());
      setProjects(list);
      if (project?.id === id) {
        if (list[0]) await openProject(list[0].id);
        else setProject(null);
      }
    },
    [openProject, project],
  );

  const restoreCommit = useCallback(async () => {
    if (!project || !viewingCommit || atHead) return;
    // Restoring appends rather than truncates — nothing in the history is lost.
    const next = pushCommit(project, viewingCommit.snapshot, {
      direction: 'restore',
      mode: viewingCommit.mode,
      focusDiagramId: viewingCommit.focusDiagramId,
      fallbackSummary: `restored “${viewingCommit.summary}”`,
    });
    await persist(next, viewingCommit.focusDiagramId, viewingCommit.mode);
  }, [project, viewingCommit, atHead, persist]);

  // -------------------------------------------------------------------- hover

  const hoverFromLine = useCallback(
    (line: number | null, point: { x: number; y: number } | null) => {
      if (session) return;
      if (!line || !point) {
        setHover(null);
        setHoverIds([]);
        return;
      }

      if (mode === 'vsm' && displayVsm) {
        const nodes = displayVsm.nodes.filter(
          (n) => n.sourceLines && line >= n.sourceLines[0] && line <= n.sourceLines[1],
        );
        if (!nodes.length) {
          setHover(null);
          setHoverIds([]);
          return;
        }
        const first = nodes[0];
        const explainer = explainVsmType(first.type);
        setHoverIds(nodes.map((n) => n.id));
        setHover({
          point,
          content: {
            eyebrow: 'This line became',
            title: nodes.map((n) => n.name).join(', '),
            short: explainer.label,
            body: explainer.short,
            footer: nodes.length > 1 ? `${nodes.length} elements from this line` : undefined,
          },
        });
        return;
      }

      if (!displayDiagram) return;
      const nodes = displayDiagram.nodes.filter(
        (n) => n.sourceLines && line >= n.sourceLines[0] && line <= n.sourceLines[1],
      );
      const edges = displayDiagram.edges.filter(
        (e) => e.sourceLines && line >= e.sourceLines[0] && line <= e.sourceLines[1],
      );
      if (!nodes.length && !edges.length) {
        setHover(null);
        setHoverIds([]);
        return;
      }
      setHoverIds([...nodes.map((n) => n.id), ...edges.map((e) => e.id)]);
      const primary = nodes[0];
      setHover({
        point,
        content: primary
          ? {
              eyebrow: 'This line became',
              title: primary.name || explainNodeType(primary.type).label,
              short: explainNodeType(primary.type).label,
              body: primary.note ?? explainNodeType(primary.type).short,
              footer: [
                primary.actor ? `Performed by ${primary.actor}` : null,
                primary.type === 'subProcess' ? 'Double-click the box to drill in' : null,
                nodes.length + edges.length > 1
                  ? `${nodes.length + edges.length} elements from this line`
                  : null,
              ]
                .filter(Boolean)
                .join(' · '),
            }
          : {
              eyebrow: 'This line became',
              title: edges[0].name ? `Flow “${edges[0].name}”` : 'A sequence flow',
              short: 'Sequence flow',
              body: 'The connection between two steps. Its label is the condition under which it is taken.',
            },
      });
    },
    [session, mode, displayVsm, displayDiagram],
  );

  const hoverFromElement = useCallback(
    (id: string | null, point: { x: number; y: number } | null) => {
      if (session) return;
      if (!id || !point) {
        setHover(null);
        setHoverLines([]);
        return;
      }

      if (mode === 'vsm' && displayVsm) {
        const node = displayVsm.nodes.find((n) => n.id === id);
        if (node) {
          const explainer = explainVsmType(node.type);
          setHoverLines(
            node.sourceLines ? [{ from: node.sourceLines[0], to: node.sourceLines[1] }] : [],
          );
          setHover({
            point,
            content: {
              eyebrow: explainer.label,
              title: node.name,
              short: explainer.short,
              body: node.note ?? explainer.long,
              provenance: node.sourceText,
              footer: node.linkedDiagramId
                ? 'Double-click to open the process running inside this unit'
                : undefined,
            },
          });
          return;
        }
        const edge = displayVsm.edges.find((e) => e.id === id);
        if (edge) {
          const explainer = explainChannel(edge.channel);
          setHoverLines(
            edge.sourceLines ? [{ from: edge.sourceLines[0], to: edge.sourceLines[1] }] : [],
          );
          setHover({
            point,
            content: {
              eyebrow: explainer.label,
              title: edge.name ?? explainer.label,
              short: explainer.short,
              body: explainer.long,
              provenance: edge.sourceText,
            },
          });
        }
        return;
      }

      if (!displayDiagram) return;
      const node = displayDiagram.nodes.find((n) => n.id === id);
      if (node) {
        const explainer = explainNodeType(node.type);
        setHoverLines(
          node.sourceLines ? [{ from: node.sourceLines[0], to: node.sourceLines[1] }] : [],
        );
        setHover({
          point,
          content: {
            eyebrow: explainer.label,
            title: node.name || '(unnamed)',
            short: explainer.short,
            body: node.note ?? explainer.long,
            provenance: node.sourceText,
            footer: [
              node.actor ? `Performed by ${node.actor}` : null,
              node.type === 'subProcess' ? 'Double-click to drill in' : null,
            ]
              .filter(Boolean)
              .join(' · '),
          },
        });
        return;
      }
      const edge = displayDiagram.edges.find((e) => e.id === id);
      if (edge) {
        setHoverLines(
          edge.sourceLines ? [{ from: edge.sourceLines[0], to: edge.sourceLines[1] }] : [],
        );
        setHover({
          point,
          content: {
            eyebrow: 'Sequence flow',
            title: edge.name ? `“${edge.name}”` : 'Sequence flow',
            short: 'The path work takes from one step to the next.',
            body: edge.name
              ? 'A labelled flow out of a gateway — this is the condition under which this path is taken.'
              : undefined,
            provenance: edge.sourceText,
          },
        });
      }
    },
    [session, mode, displayVsm, displayDiagram],
  );

  // --------------------------------------------------------------- menu wiring

  const commitRef = useRef(runCommit);
  commitRef.current = runCommit;

  useEffect(() => {
    return api.onMenu((command) => {
      switch (command) {
        case 'menu:settings':
          setSettingsOpen(true);
          break;
        case 'menu:new-project':
          newProject();
          break;
        case 'menu:commit':
          void commitRef.current(false);
          break;
        case 'menu:history-back':
          setHistoryIndex((index) => Math.max(0, index - 1));
          break;
        case 'menu:history-forward':
          setHistoryIndex((index) =>
            Math.min((project?.history.length ?? 1) - 1, index + 1),
          );
          break;
        case 'menu:toggle-mode':
          setMode((current) => (current === 'process' ? 'vsm' : 'process'));
          break;
        case 'menu:go-up': {
          const parent = committedDiagram?.parentDiagramId;
          if (parent) {
            setFocusId(parent);
            setRevision((r) => r + 1);
          }
          break;
        }
        default:
          break;
      }
    });
  }, [newProject, project, committedDiagram]);

  useEffect(() => {
    setRevision((r) => r + 1);
  }, [historyIndex]);

  // --------------------------------------------------------------------- view

  if (!project || !content || !committedDiagram || !committedVsm) {
    return (
      <div className="app app-loading">
        <p>Loading…</p>
        {banner && <p className={`status status-${banner.tone}`}>{banner.message}</p>}
      </div>
    );
  }

  const importToken = [project.id, committedDiagram.id, historyIndex, revision].join('|');

  return (
    <div className="app">
      <div className="titlebar">
        <span className="titlebar-name">VSM Translator</span>
        <span className="titlebar-project">{project.name}</span>
      </div>

      <div className="body">
        <Sidebar
          projects={projects}
          activeProjectId={project.id}
          history={project.history}
          historyIndex={historyIndex}
          onSelectProject={(id) => {
            if (anythingDirty && !window.confirm('You have uncommitted changes. Switch anyway?')) return;
            void openProject(id);
          }}
          onNewProject={newProject}
          onDeleteProject={(id) => void deleteProject(id)}
          onSelectCommit={setHistoryIndex}
          onRestore={() => void restoreCommit()}
          onReturnToLatest={() => setHistoryIndex(project.history.length - 1)}
        />

        <main className="workspace">
          <header className="toolbar">
            <div className="mode-toggle" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'process'}
                className={mode === 'process' ? 'is-on' : ''}
                onClick={() => setMode('process')}
              >
                Process
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'vsm'}
                className={mode === 'vsm' ? 'is-on' : ''}
                onClick={() => setMode('vsm')}
              >
                VSM
              </button>
            </div>

            {mode === 'process' ? (
              <nav className="breadcrumb">
                {breadcrumb.map((crumb, index) => (
                  <span key={crumb.id}>
                    {index > 0 && <span className="crumb-sep">›</span>}
                    <button
                      type="button"
                      className={crumb.id === committedDiagram.id ? 'is-current' : ''}
                      onClick={() => {
                        setFocusId(crumb.id);
                        setRevision((r) => r + 1);
                      }}
                    >
                      {crumb.name}
                    </button>
                  </span>
                ))}
              </nav>
            ) : (
              <nav className="breadcrumb">
                <span>
                  <button type="button" className="is-current">
                    {committedVsm.name}
                  </button>
                </span>
              </nav>
            )}

            <div className="toolbar-right">
              <span className={`dirty ${textDirty ? 'is-on' : ''}`}>text</span>
              <span className={`dirty ${diagramDirty ? 'is-on' : ''}`}>diagram</span>
              <button type="button" className="btn" onClick={tidy} disabled={!atHead}>
                Tidy
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void runCommit(false)}
                disabled={!atHead || !!busy || !anythingDirty}
                title="Commit (⌘↵)"
              >
                {busy ? 'Working…' : 'Commit'}
              </button>
              <button
                type="button"
                className={`provider-chip ${provider?.offline ? 'is-offline' : ''}`}
                onClick={() => setSettingsOpen(true)}
                title={provider ? `${provider.label} — ${provider.blurb}` : 'Choose a translator'}
              >
                {provider?.offline ? '⦿' : '☁'} {shortProvider(provider)}
              </button>
              <button type="button" className="btn" onClick={() => setSettingsOpen(true)}>
                ⚙
              </button>
            </div>
          </header>

          {!atHead && (
            <div className="notice notice-history">
              Viewing commit {historyIndex + 1} of {project.history.length} — “
              {viewingCommit?.summary}”. Editing is off until you restore or return to latest.
            </div>
          )}
          {busy && <div className="notice notice-busy">{busy}</div>}
          {banner && (
            <div className={`notice notice-${banner.tone}`} onClick={() => setBanner(null)}>
              {banner.message}
            </div>
          )}

          <div className="panes">
            <section className="pane pane-text">
              <div className="pane-header">
                <h3>{mode === 'vsm' ? 'The organisation, in words' : 'The process, in words'}</h3>
                <span className="muted">
                  {mode === 'vsm'
                    ? 'Describe the units, who coordinates, controls, scans and sets policy.'
                    : 'Numbered steps. @Actor, IF…THEN…ELSE and indentation are understood, never required.'}
                </span>
              </div>
              <TextPane
                value={draftText}
                readOnly={!atHead}
                placeholder={
                  mode === 'vsm'
                    ? '1. Three teams do the actual work: …\n2. A shared calendar keeps them from clashing.\n3. …'
                    : '1. A customer submits a request.\n2. @Support triages it.\n3. IF it is a billing issue THEN …'
                }
                highlights={highlightLines}
                onChange={(value) => setDrafts((d) => ({ ...d, [draftKey]: value }))}
                onHoverLine={hoverFromLine}
              />
            </section>

            {mode === 'process' && displayDiagram ? (
              <BpmnPane
                diagram={displayDiagram}
                importToken={importToken}
                readOnly={!atHead}
                highlightIds={highlightIds}
                onModelChange={(model) =>
                  setWorking((current) => ({ ...current, [committedDiagram.id]: model }))
                }
                onHoverElement={hoverFromElement}
                onSelectElement={() => undefined}
                onDrillIn={(id) => void drillInto(id)}
                onExpandToSubProcess={expandToSubProcess}
              />
            ) : (
              displayVsm && (
                <VsmPane
                  diagram={displayVsm}
                  readOnly={!atHead}
                  highlightIds={highlightIds}
                  availableDiagrams={diagramChoices(content)}
                  onChange={setWorkingVsm}
                  onHoverElement={hoverFromElement}
                  onOpenLinkedDiagram={(id) => {
                    setMode('process');
                    setFocusId(id);
                    setRevision((r) => r + 1);
                  }}
                  onTidy={tidy}
                />
              )
            )}
          </div>
        </main>
      </div>

      {hover && !session && <HoverCard content={hover.content} point={hover.point} />}

      {session && (
        <ConflictDialog
          conflicts={session.conflicts}
          resolutions={resolutions}
          activeId={activeConflictId}
          busy={!!busy}
          allowInstructions={session.kind === 'process' && (provider?.supportsInstructions ?? false)}
          onActivate={setActiveConflictId}
          onChange={(id, patch) =>
            setResolutions((current) => {
              const existing: ConflictResolution =
                current[id] ??
                ({
                  conflictId: id,
                  choice: session.conflicts.find((c) => c.id === id)?.suggested ?? 'text',
                } as ConflictResolution);
              return { ...current, [id]: { ...existing, ...patch, conflictId: id } };
            })
          }
          onResolve={() => void runCommit(false)}
          onLucky={() => void runCommit(true)}
          onCancel={() => {
            setSession(null);
            setActiveConflictId(null);
            setBusy(null);
          }}
        />
      )}

      {namingProject && (
        <PromptDialog
          title="New project"
          label="Project name"
          initialValue="Untitled process"
          placeholder="e.g. Refund handling"
          onCancel={() => setNamingProject(false)}
          onSubmit={(name) => {
            setNamingProject(false);
            void createProject(name);
          }}
        />
      )}

      {settingsOpen && (
        <SettingsDialog onClose={() => setSettingsOpen(false)} onProviderChange={adoptConfig} />
      )}
    </div>
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Short enough for the toolbar; the full label is in the tooltip. */
function shortProvider(provider: ProviderInfo | null): string {
  if (!provider) return 'Translator';
  if (provider.id === 'builtin') return 'Offline';
  if (provider.id === 'ollama') return 'Local model';
  return 'Claude';
}

function stripVsm(vsm: VsmDiagram) {
  return {
    nodes: vsm.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      name: n.name,
      note: n.note,
      linkedDiagramId: n.linkedDiagramId,
      x: n.x,
      y: n.y,
    })),
    edges: vsm.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      channel: e.channel,
      name: e.name,
    })),
  };
}

/** New VSM nodes arrive unplaced; existing ones keep where you dragged them. */
function carryVsmGeometry(
  incoming: VsmDiagram['nodes'],
  previous: VsmDiagram['nodes'],
): VsmDiagram['nodes'] {
  const before = new Map(previous.map((n) => [n.id, n]));
  return incoming.map((node) => {
    const prior = before.get(node.id);
    return prior
      ? { ...node, x: prior.x, y: prior.y, width: prior.width, height: prior.height }
      : node;
  });
}
