import type {
  ChangeRecord,
  Conflict,
  ConflictSide,
  ProcessEdge,
  ProcessNode,
  ProjectContent,
} from './types';

/**
 * Three-way diff between the last commit (base) and the two edited sides.
 *
 * The rule that keeps the conflict list short and meaningful: a change made on
 * only one side is not a conflict — it is simply the answer. Only elements that
 * both sides changed, in different ways, reach the dialog.
 */

export interface Model {
  nodes: ProcessNode[];
  edges: ProcessEdge[];
}

type NodeShape = { type: string; name: string; actor?: string };
type EdgeShape = { source: string; target: string; name?: string };

function nodeShape(node: ProcessNode | undefined): NodeShape | undefined {
  if (!node) return undefined;
  return { type: node.type, name: (node.name ?? '').trim(), actor: node.actor?.trim() };
}

function edgeShape(edge: ProcessEdge | undefined): EdgeShape | undefined {
  if (!edge) return undefined;
  return { source: edge.source, target: edge.target, name: edge.name?.trim() };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function describeNode(shape: NodeShape | undefined): string {
  if (!shape) return 'not present';
  const type = TYPE_LABELS[shape.type] ?? shape.type;
  const actor = shape.actor ? ` — performed by ${shape.actor}` : '';
  return `${type} “${shape.name || '(unnamed)'}”${actor}`;
}

function describeEdge(
  shape: EdgeShape | undefined,
  names: Map<string, string>,
): string {
  if (!shape) return 'not present';
  const from = names.get(shape.source) ?? shape.source;
  const to = names.get(shape.target) ?? shape.target;
  const label = shape.name ? ` labelled “${shape.name}”` : '';
  return `flow ${from} → ${to}${label}`;
}

const TYPE_LABELS: Record<string, string> = {
  startEvent: 'Start event',
  endEvent: 'End event',
  task: 'Task',
  subProcess: 'Sub-process',
  exclusiveGateway: 'Exclusive gateway',
  parallelGateway: 'Parallel gateway',
};

function nameLookup(...models: Model[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const model of models) {
    for (const node of model.nodes) {
      if (node.name?.trim()) names.set(node.id, node.name.trim());
      else if (!names.has(node.id)) names.set(node.id, TYPE_LABELS[node.type] ?? node.id);
    }
  }
  return names;
}

export function computeConflicts(base: Model, fromText: Model, fromDiagram: Model): Conflict[] {
  const conflicts: Conflict[] = [];
  const names = nameLookup(fromDiagram, fromText, base);

  const baseNodes = byId(base.nodes);
  const textNodes = byId(fromText.nodes);
  const diagramNodes = byId(fromDiagram.nodes);

  const nodeIds = new Set([...baseNodes.keys(), ...textNodes.keys(), ...diagramNodes.keys()]);
  for (const id of nodeIds) {
    const b = nodeShape(baseNodes.get(id));
    const t = nodeShape(textNodes.get(id));
    const d = nodeShape(diagramNodes.get(id));

    if (same(t, d)) continue; // Both sides agree.
    if (same(t, b)) continue; // Only the diagram changed — take it.
    if (same(d, b)) continue; // Only the text changed — take it.

    const category = categoryFor(b, t, d);
    const label = names.get(id) ?? id;
    conflicts.push({
      id: `node:${id}`,
      elementId: id,
      elementKind: 'node',
      title: label,
      category,
      text: { side: 'text', description: describeNode(t), present: Boolean(t) },
      diagram: { side: 'diagram', description: describeNode(d), present: Boolean(d) },
      textLines: textNodes.get(id)?.sourceLines,
      suggested: suggestFor(category, Boolean(t), Boolean(d)),
    });
  }

  const baseEdges = byId(base.edges);
  const textEdges = byId(fromText.edges);
  const diagramEdges = byId(fromDiagram.edges);

  const edgeIds = new Set([...baseEdges.keys(), ...textEdges.keys(), ...diagramEdges.keys()]);
  for (const id of edgeIds) {
    const b = edgeShape(baseEdges.get(id));
    const t = edgeShape(textEdges.get(id));
    const d = edgeShape(diagramEdges.get(id));

    if (same(t, d)) continue;
    if (same(t, b)) continue;
    if (same(d, b)) continue;

    const category = categoryFor(b, t, d);
    conflicts.push({
      id: `edge:${id}`,
      elementId: id,
      elementKind: 'edge',
      title: describeEdge(d ?? t ?? b, names),
      category,
      text: { side: 'text', description: describeEdge(t, names), present: Boolean(t) },
      diagram: { side: 'diagram', description: describeEdge(d, names), present: Boolean(d) },
      textLines: textEdges.get(id)?.sourceLines,
      suggested: suggestFor(category, Boolean(t), Boolean(d)),
    });
  }

  // Stable ordering: nodes before edges, then alphabetical, so the dialog does
  // not reshuffle between runs.
  conflicts.sort((a, b) =>
    a.elementKind === b.elementKind
      ? a.title.localeCompare(b.title)
      : a.elementKind === 'node'
        ? -1
        : 1,
  );
  return conflicts;
}

function categoryFor(b: unknown, t: unknown, d: unknown): string {
  if (!t && !d) return 'removed on both sides';
  if (!b && t && d) return 'added differently on both sides';
  if (!b) return t ? 'added in text only' : 'added in diagram only';
  if (!t) return 'removed in text, changed in diagram';
  if (!d) return 'removed in diagram, changed in text';
  return 'changed on both sides';
}

function suggestFor(category: string, inText: boolean, inDiagram: boolean): ConflictSide {
  // Prefer whichever side still HAS the element; a deletion is easy to redo,
  // losing work someone typed is not.
  if (inText && !inDiagram) return 'text';
  if (inDiagram && !inText) return 'diagram';
  // Both present and different: structure is usually what the canvas is for.
  return category.includes('added') ? 'diagram' : 'text';
}

/**
 * Merge the parts both sides agree on, or that only one side touched. Used to
 * pre-fill the merge and, when there are no conflicts at all, to skip the dialog.
 */
export function autoMergeableCount(base: Model, fromText: Model, fromDiagram: Model): number {
  const ids = new Set([
    ...base.nodes.map((n) => n.id),
    ...fromText.nodes.map((n) => n.id),
    ...fromDiagram.nodes.map((n) => n.id),
  ]);
  let count = 0;
  const b = byId(base.nodes);
  const t = byId(fromText.nodes);
  const d = byId(fromDiagram.nodes);
  for (const id of ids) {
    const bs = nodeShape(b.get(id));
    const ts = nodeShape(t.get(id));
    const ds = nodeShape(d.get(id));
    if (!same(ts, ds) && (same(ts, bs) || same(ds, bs))) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Change records — what a commit actually did, for the history timeline
// ---------------------------------------------------------------------------

export function describeChanges(
  before: ProjectContent | null,
  after: ProjectContent,
  focusDiagramId: string,
): ChangeRecord[] {
  const changes: ChangeRecord[] = [];
  if (!before) return changes;

  const prev = before.diagrams[focusDiagramId];
  const next = after.diagrams[focusDiagramId];

  if (prev && next) {
    changes.push(...diagramChanges(prev, next));
  }

  // VSM is a single diagram per project, so compare it wholesale.
  changes.push(
    ...compareSets(
      before.vsm.nodes.map((n) => ({ id: n.id, label: n.name, key: `${n.type}|${n.name}|${n.linkedDiagramId ?? ''}` })),
      after.vsm.nodes.map((n) => ({ id: n.id, label: n.name, key: `${n.type}|${n.name}|${n.linkedDiagramId ?? ''}` })),
      'node',
      'VSM',
    ),
  );
  if (before.vsm.text.trim() !== after.vsm.text.trim()) {
    changes.push({ kind: 'changed', target: 'text', id: before.vsm.id, label: 'VSM description' });
  }

  // New or removed sub-process diagrams.
  for (const id of Object.keys(after.diagrams)) {
    if (!before.diagrams[id]) {
      changes.push({
        kind: 'added',
        target: 'node',
        id,
        label: `Sub-process “${after.diagrams[id].name}”`,
      });
    }
  }
  for (const id of Object.keys(before.diagrams)) {
    if (!after.diagrams[id]) {
      changes.push({
        kind: 'removed',
        target: 'node',
        id,
        label: `Sub-process “${before.diagrams[id].name}”`,
      });
    }
  }

  return changes;
}

function diagramChanges(
  prev: { text: string; nodes: ProcessNode[]; edges: ProcessEdge[]; id: string },
  next: { text: string; nodes: ProcessNode[]; edges: ProcessEdge[]; id: string },
): ChangeRecord[] {
  const changes: ChangeRecord[] = [];
  const names = nameLookup({ nodes: next.nodes, edges: next.edges }, { nodes: prev.nodes, edges: prev.edges });

  changes.push(
    ...compareSets(
      prev.nodes.map((n) => ({ id: n.id, label: n.name || TYPE_LABELS[n.type], key: JSON.stringify(nodeShape(n)) })),
      next.nodes.map((n) => ({ id: n.id, label: n.name || TYPE_LABELS[n.type], key: JSON.stringify(nodeShape(n)) })),
      'node',
    ),
  );
  changes.push(
    ...compareSets(
      prev.edges.map((e) => ({
        id: e.id,
        label: describeEdge(edgeShape(e), names),
        key: JSON.stringify(edgeShape(e)),
      })),
      next.edges.map((e) => ({
        id: e.id,
        label: describeEdge(edgeShape(e), names),
        key: JSON.stringify(edgeShape(e)),
      })),
      'edge',
    ),
  );

  // Pure repositioning is worth recording but shouldn't read as a content change.
  const prevPos = byId(prev.nodes);
  for (const node of next.nodes) {
    const before = prevPos.get(node.id);
    if (!before) continue;
    if (before.x !== node.x || before.y !== node.y) {
      changes.push({
        kind: 'moved',
        target: 'node',
        id: node.id,
        label: node.name || TYPE_LABELS[node.type] || node.id,
      });
    }
  }

  if (prev.text.trim() !== next.text.trim()) {
    changes.push({ kind: 'changed', target: 'text', id: next.id, label: 'Description' });
  }
  return changes;
}

function compareSets(
  prev: { id: string; label: string; key: string }[],
  next: { id: string; label: string; key: string }[],
  target: 'node' | 'edge',
  prefix = '',
): ChangeRecord[] {
  const out: ChangeRecord[] = [];
  const prevMap = new Map(prev.map((p) => [p.id, p]));
  const nextMap = new Map(next.map((n) => [n.id, n]));
  const label = (text: string) => (prefix ? `${prefix}: ${text}` : text);

  for (const item of next) {
    const before = prevMap.get(item.id);
    if (!before) {
      out.push({ kind: 'added', target, id: item.id, label: label(item.label) });
    } else if (before.key !== item.key) {
      out.push({
        kind: 'changed',
        target,
        id: item.id,
        label: label(item.label),
        detail: before.label !== item.label ? `was “${before.label}”` : undefined,
      });
    }
  }
  for (const item of prev) {
    if (!nextMap.has(item.id)) {
      out.push({ kind: 'removed', target, id: item.id, label: label(item.label) });
    }
  }
  return out;
}

/** One line for the history list. */
export function summarise(changes: ChangeRecord[], fallback: string): string {
  if (!changes.length) return fallback;
  const content = changes.filter((c) => c.kind !== 'moved');
  const pool = content.length ? content : changes;
  const head = pool[0];
  const verb = { added: 'added', removed: 'removed', changed: 'changed', moved: 'moved' }[head.kind];
  const rest = pool.length - 1;
  const suffix = rest > 0 ? ` (+${rest} more change${rest === 1 ? '' : 's'})` : '';
  return `${verb} ${head.label}${suffix}`;
}
