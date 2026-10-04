import { commitId, diagramId } from '../model/ids';
import { layoutProcessIncremental } from '../model/layout';
import { describeChanges, summarise } from '../model/diff';
import type {
  Commit,
  CommitDirection,
  Mode,
  ProcessDiagram,
  ProcessTranslation,
  Project,
  ProjectContent,
} from '../model/types';

/**
 * Turning a translation result into a diagram: the model returns semantics only,
 * so geometry, sub-diagram links and any newly-required child diagrams are
 * re-attached here. This is the step that makes "commit the text without
 * scrambling my layout" true.
 */
export interface AppliedProcess {
  diagram: ProcessDiagram;
  newDiagrams: Record<string, ProcessDiagram>;
}

export function applyProcessTranslation(
  translation: ProcessTranslation,
  previous: ProcessDiagram,
  text: string,
): AppliedProcess {
  const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
  const newDiagrams: Record<string, ProcessDiagram> = {};

  const nodes = translation.nodes.map((node) => {
    const before = previousNodes.get(node.id);
    // Geometry the caller already supplied wins (that's the canvas talking);
    // otherwise inherit the last known position so nothing jumps.
    const carried = {
      ...node,
      x: node.x ?? before?.x,
      y: node.y ?? before?.y,
      width: node.width ?? before?.width,
      height: node.height ?? before?.height,
      childDiagramId:
        node.type === 'subProcess' ? (node.childDiagramId ?? before?.childDiagramId) : undefined,
    };

    // A step the translator judged to be a whole process of its own gets a real
    // child diagram immediately, so you can drill in and start filling it.
    if (carried.type === 'subProcess' && !carried.childDiagramId) {
      const id = diagramId();
      carried.childDiagramId = id;
      newDiagrams[id] = {
        id,
        name: node.name || 'Sub-process',
        parentDiagramId: previous.id,
        parentNodeId: node.id,
        text: node.sourceText ? `1. ${node.sourceText}` : '',
        nodes: [],
        edges: [],
      };
    }
    return carried;
  });

  return {
    diagram: {
      ...previous,
      text,
      nodes: layoutProcessIncremental(nodes, translation.edges),
      edges: translation.edges.map((edge) => {
        const before = previous.edges.find((e) => e.id === edge.id);
        // Keep hand-routed waypoints only while both endpoints are unchanged.
        const sameEnds = before?.source === edge.source && before?.target === edge.target;
        return sameEnds ? { ...edge, waypoints: before?.waypoints } : edge;
      }),
    },
    newDiagrams,
  };
}

/** Drop child diagrams nothing points at any more, but only if they're empty. */
export function pruneOrphans(content: ProjectContent): ProjectContent {
  const referenced = new Set<string>([content.rootDiagramId]);
  for (const diagram of Object.values(content.diagrams)) {
    for (const node of diagram.nodes) {
      if (node.childDiagramId) referenced.add(node.childDiagramId);
    }
  }
  for (const node of content.vsm.nodes) {
    if (node.linkedDiagramId) referenced.add(node.linkedDiagramId);
  }

  const diagrams: Record<string, ProcessDiagram> = {};
  for (const [id, diagram] of Object.entries(content.diagrams)) {
    const empty = !diagram.nodes.length && !diagram.text.trim();
    if (referenced.has(id) || !empty) diagrams[id] = diagram;
  }
  return { ...content, diagrams };
}

export function pushCommit(
  project: Project,
  nextContent: ProjectContent,
  options: {
    direction: CommitDirection;
    mode: Mode;
    focusDiagramId: string;
    fallbackSummary: string;
  },
): Project {
  const content = pruneOrphans(nextContent);
  const changes = describeChanges(project.content, content, options.focusDiagramId);
  const commit: Commit = {
    id: commitId(),
    timestamp: new Date().toISOString(),
    summary: summarise(changes, options.fallbackSummary),
    direction: options.direction,
    mode: options.mode,
    focusDiagramId: options.focusDiagramId,
    changes,
    snapshot: content,
  };
  return {
    ...project,
    content,
    history: [...project.history, commit],
    updatedAt: commit.timestamp,
  };
}

/** Every diagram in the project, for the "link a System 1 to a process" picker. */
export function diagramChoices(content: ProjectContent): { id: string; name: string }[] {
  return Object.values(content.diagrams).map((diagram) => ({
    id: diagram.id,
    name: diagram.parentDiagramId ? `${diagram.name} (sub-process)` : diagram.name,
  }));
}

/** Root → … → target, for the breadcrumb. */
export function breadcrumbFor(content: ProjectContent, diagramId: string): ProcessDiagram[] {
  const trail: ProcessDiagram[] = [];
  let current: ProcessDiagram | undefined = content.diagrams[diagramId];
  const guard = new Set<string>();
  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    trail.unshift(current);
    current = current.parentDiagramId ? content.diagrams[current.parentDiagramId] : undefined;
  }
  return trail;
}
