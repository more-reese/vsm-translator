import { VSM_SHORT_LABEL } from './glossary';
import type { Conflict, ConflictResolution, VsmDiagram, VsmEdge, VsmNode } from './types';

/**
 * The same three-way rule as the process diff: a change on one side only is the
 * answer, not a conflict. VSM resolutions are applied locally rather than by the
 * translator — the elements are simple enough that a deterministic pick is
 * exactly right, and it keeps a VSM commit to a single API call.
 */

type NodeShape = { type: string; name: string; note?: string; linkedDiagramId?: string };
type EdgeShape = { source: string; target: string; channel: string; name?: string };

const shapeOf = (node?: VsmNode): NodeShape | undefined =>
  node && {
    type: node.type,
    name: (node.name ?? '').trim(),
    note: node.note?.trim() || undefined,
    linkedDiagramId: node.linkedDiagramId,
  };

const edgeShapeOf = (edge?: VsmEdge): EdgeShape | undefined =>
  edge && {
    source: edge.source,
    target: edge.target,
    channel: edge.channel,
    name: edge.name?.trim() || undefined,
  };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function describe(shape: NodeShape | undefined): string {
  if (!shape) return 'not present';
  const label = VSM_SHORT_LABEL[shape.type as VsmNode['type']] ?? shape.type;
  const link = shape.linkedDiagramId ? ' (linked to a process)' : '';
  return `${label} “${shape.name || '(unnamed)'}”${link}`;
}

function describeEdge(shape: EdgeShape | undefined, names: Map<string, string>): string {
  if (!shape) return 'not present';
  const from = names.get(shape.source) ?? shape.source;
  const to = names.get(shape.target) ?? shape.target;
  return `${shape.channel} channel ${from} → ${to}${shape.name ? ` “${shape.name}”` : ''}`;
}

export function computeVsmConflicts(
  base: VsmDiagram,
  fromText: { nodes: VsmNode[]; edges: VsmEdge[] },
  fromDiagram: { nodes: VsmNode[]; edges: VsmEdge[] },
): Conflict[] {
  const names = new Map<string, string>();
  for (const set of [fromDiagram.nodes, fromText.nodes, base.nodes]) {
    for (const node of set) if (!names.has(node.id)) names.set(node.id, node.name || node.id);
  }

  const conflicts: Conflict[] = [];
  const index = <T extends { id: string }>(items: T[]) => new Map(items.map((i) => [i.id, i]));

  const baseNodes = index(base.nodes);
  const textNodes = index(fromText.nodes);
  const diagramNodes = index(fromDiagram.nodes);

  for (const id of new Set([...baseNodes.keys(), ...textNodes.keys(), ...diagramNodes.keys()])) {
    const b = shapeOf(baseNodes.get(id));
    const t = shapeOf(textNodes.get(id));
    const d = shapeOf(diagramNodes.get(id));
    if (same(t, d) || same(t, b) || same(d, b)) continue;

    conflicts.push({
      id: `node:${id}`,
      elementId: id,
      elementKind: 'node',
      title: names.get(id) ?? id,
      category: !t ? 'removed in text' : !d ? 'removed in diagram' : 'changed on both sides',
      text: { side: 'text', description: describe(t), present: Boolean(t) },
      diagram: { side: 'diagram', description: describe(d), present: Boolean(d) },
      textLines: textNodes.get(id)?.sourceLines,
      suggested: t && !d ? 'text' : d && !t ? 'diagram' : 'text',
    });
  }

  const baseEdges = index(base.edges);
  const textEdges = index(fromText.edges);
  const diagramEdges = index(fromDiagram.edges);

  for (const id of new Set([...baseEdges.keys(), ...textEdges.keys(), ...diagramEdges.keys()])) {
    const b = edgeShapeOf(baseEdges.get(id));
    const t = edgeShapeOf(textEdges.get(id));
    const d = edgeShapeOf(diagramEdges.get(id));
    if (same(t, d) || same(t, b) || same(d, b)) continue;

    conflicts.push({
      id: `edge:${id}`,
      elementId: id,
      elementKind: 'edge',
      title: describeEdge(d ?? t ?? b, names),
      category: !t ? 'removed in text' : !d ? 'removed in diagram' : 'changed on both sides',
      text: { side: 'text', description: describeEdge(t, names), present: Boolean(t) },
      diagram: { side: 'diagram', description: describeEdge(d, names), present: Boolean(d) },
      textLines: textEdges.get(id)?.sourceLines,
      suggested: t && !d ? 'text' : 'diagram',
    });
  }

  conflicts.sort((a, b) =>
    a.elementKind === b.elementKind
      ? a.title.localeCompare(b.title)
      : a.elementKind === 'node'
        ? -1
        : 1,
  );
  return conflicts;
}

/**
 * Take the winning side element by element. Anything neither side conflicts over
 * is merged by the same rule the diff uses: whichever side moved away from base.
 */
export function applyVsmResolutions(
  base: VsmDiagram,
  fromText: { nodes: VsmNode[]; edges: VsmEdge[] },
  fromDiagram: { nodes: VsmNode[]; edges: VsmEdge[] },
  conflicts: Conflict[],
  resolutions: Record<string, ConflictResolution>,
): { nodes: VsmNode[]; edges: VsmEdge[] } {
  const decisions = new Map<string, 'text' | 'diagram'>();
  for (const conflict of conflicts) {
    const chosen = resolutions[conflict.id]?.choice;
    decisions.set(
      conflict.id,
      chosen === 'text' || chosen === 'diagram' ? chosen : conflict.suggested,
    );
  }

  const pick = <T extends { id: string }>(
    kind: 'node' | 'edge',
    id: string,
    baseItem: T | undefined,
    textItem: T | undefined,
    diagramItem: T | undefined,
  ): T | undefined => {
    const decision = decisions.get(`${kind}:${id}`);
    if (decision) return decision === 'text' ? textItem : diagramItem;
    // Not a conflict: whichever side changed it wins; if neither did, keep it.
    if (!baseItem) return textItem ?? diagramItem;
    const textChanged = !same(shapeKey(kind, textItem), shapeKey(kind, baseItem));
    return textChanged ? textItem : diagramItem;
  };

  const shapeKey = (kind: 'node' | 'edge', item: unknown) =>
    kind === 'node' ? shapeOf(item as VsmNode) : edgeShapeOf(item as VsmEdge);

  const nodeIds = new Set([
    ...base.nodes.map((n) => n.id),
    ...fromText.nodes.map((n) => n.id),
    ...fromDiagram.nodes.map((n) => n.id),
  ]);
  const baseNodes = new Map(base.nodes.map((n) => [n.id, n]));
  const textNodes = new Map(fromText.nodes.map((n) => [n.id, n]));
  const diagramNodes = new Map(fromDiagram.nodes.map((n) => [n.id, n]));

  const nodes: VsmNode[] = [];
  for (const id of nodeIds) {
    const chosen = pick('node', id, baseNodes.get(id), textNodes.get(id), diagramNodes.get(id));
    if (!chosen) continue;
    // Geometry always comes from the canvas — that's where it was set by hand.
    const onCanvas = diagramNodes.get(id);
    nodes.push(
      onCanvas
        ? { ...chosen, x: onCanvas.x, y: onCanvas.y, width: onCanvas.width, height: onCanvas.height }
        : chosen,
    );
  }

  const edgeIds = new Set([
    ...base.edges.map((e) => e.id),
    ...fromText.edges.map((e) => e.id),
    ...fromDiagram.edges.map((e) => e.id),
  ]);
  const baseEdges = new Map(base.edges.map((e) => [e.id, e]));
  const textEdges = new Map(fromText.edges.map((e) => [e.id, e]));
  const diagramEdges = new Map(fromDiagram.edges.map((e) => [e.id, e]));

  const present = new Set(nodes.map((n) => n.id));
  const edges: VsmEdge[] = [];
  for (const id of edgeIds) {
    const chosen = pick('edge', id, baseEdges.get(id), textEdges.get(id), diagramEdges.get(id));
    if (chosen && present.has(chosen.source) && present.has(chosen.target)) edges.push(chosen);
  }

  return { nodes, edges };
}
