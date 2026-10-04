import type { ProcessEdge, ProcessNode, VsmEdge, VsmNode } from './types';

/**
 * Geometry.
 *
 * The governing rule: a node the user has already placed keeps its position.
 * A text re-commit only lays out elements that are genuinely new, which is what
 * makes "edit the text, commit, and your diagram doesn't jump around" true.
 * Full re-layout is an explicit user action (the Tidy button).
 */

export const SIZES: Record<ProcessNode['type'], { width: number; height: number }> = {
  startEvent: { width: 36, height: 36 },
  endEvent: { width: 36, height: 36 },
  task: { width: 120, height: 80 },
  subProcess: { width: 130, height: 80 },
  exclusiveGateway: { width: 50, height: 50 },
  parallelGateway: { width: 50, height: 50 },
};

const COL_GAP = 70;
const ROW_GAP = 30;
const ORIGIN_X = 160;
const ORIGIN_Y = 180;

function sized(node: ProcessNode): ProcessNode {
  const s = SIZES[node.type] ?? SIZES.task;
  return { ...node, width: node.width ?? s.width, height: node.height ?? s.height };
}

function placed(node: ProcessNode): boolean {
  return typeof node.x === 'number' && typeof node.y === 'number';
}

/** Rank every node by longest path from a source, tolerating cycles. */
function ranks(nodes: ProcessNode[], edges: ProcessEdge[]): Map<string, number> {
  const rank = new Map<string, number>();
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const n of nodes) {
    incoming.set(n.id, []);
    outgoing.set(n.id, []);
  }
  for (const e of edges) {
    outgoing.get(e.source)?.push(e.target);
    incoming.get(e.target)?.push(e.source);
  }

  const roots = nodes.filter((n) => (incoming.get(n.id) ?? []).length === 0);
  const seeds = roots.length ? roots : nodes.slice(0, 1);
  for (const n of nodes) rank.set(n.id, 0);

  // Relax edges up to |V| times; a cycle just stops improving instead of hanging.
  const queue: string[] = seeds.map((n) => n.id);
  let guard = nodes.length * nodes.length + 16;
  while (queue.length && guard-- > 0) {
    const id = queue.shift()!;
    const here = rank.get(id) ?? 0;
    for (const next of outgoing.get(id) ?? []) {
      if ((rank.get(next) ?? 0) < here + 1) {
        rank.set(next, here + 1);
        queue.push(next);
      }
    }
  }
  return rank;
}

/** Full layered left-to-right layout. Discards existing positions. */
export function layoutProcessFull(nodes: ProcessNode[], edges: ProcessEdge[]): ProcessNode[] {
  const sizedNodes = nodes.map(sized);
  if (!sizedNodes.length) return sizedNodes;

  const rank = ranks(sizedNodes, edges);
  const columns = new Map<number, ProcessNode[]>();
  for (const n of sizedNodes) {
    const r = rank.get(n.id) ?? 0;
    if (!columns.has(r)) columns.set(r, []);
    columns.get(r)!.push(n);
  }

  // Order each column by the average vertical slot of its predecessors, so
  // branches stay near the gateway that spawned them.
  const slot = new Map<string, number>();
  const orderedRanks = [...columns.keys()].sort((a, b) => a - b);
  for (const r of orderedRanks) {
    const column = columns.get(r)!;
    column.sort((a, b) => avgPredSlot(a, edges, slot) - avgPredSlot(b, edges, slot));
    column.forEach((n, i) => slot.set(n.id, i));
  }

  const result = new Map<string, ProcessNode>();
  let x = ORIGIN_X;
  for (const r of orderedRanks) {
    const column = columns.get(r)!;
    const colWidth = Math.max(...column.map((n) => n.width!));
    const colHeight =
      column.reduce((sum, n) => sum + n.height!, 0) + ROW_GAP * (column.length - 1);
    let y = ORIGIN_Y - colHeight / 2;
    for (const n of column) {
      result.set(n.id, {
        ...n,
        x: Math.round(x + (colWidth - n.width!) / 2),
        y: Math.round(y),
      });
      y += n.height! + ROW_GAP;
    }
    x += colWidth + COL_GAP;
  }
  return sizedNodes.map((n) => result.get(n.id) ?? n);
}

function avgPredSlot(
  node: ProcessNode,
  edges: ProcessEdge[],
  slot: Map<string, number>,
): number {
  const preds = edges.filter((e) => e.target === node.id).map((e) => slot.get(e.source));
  const known = preds.filter((v): v is number => typeof v === 'number');
  if (!known.length) return 0;
  return known.reduce((a, b) => a + b, 0) / known.length;
}

/**
 * Place only the nodes that have no geometry yet, next to whatever they attach
 * to. Existing nodes are untouched.
 */
export function layoutProcessIncremental(
  nodes: ProcessNode[],
  edges: ProcessEdge[],
): ProcessNode[] {
  const sizedNodes = nodes.map(sized);
  const anyPlaced = sizedNodes.some(placed);
  if (!anyPlaced) return layoutProcessFull(sizedNodes, edges);

  const byId = new Map(sizedNodes.map((n) => [n.id, { ...n }]));
  const unplaced = sizedNodes.filter((n) => !placed(n));
  if (!unplaced.length) return sizedNodes;

  // Walk unplaced nodes in flow order so a chain of new nodes cascades rightwards.
  const rank = ranks(sizedNodes, edges);
  unplaced.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));

  for (const node of unplaced) {
    const target = byId.get(node.id)!;
    const anchor =
      edges
        .filter((e) => e.target === node.id)
        .map((e) => byId.get(e.source))
        .find((n) => n && placed(n)) ??
      edges
        .filter((e) => e.source === node.id)
        .map((e) => byId.get(e.target))
        .find((n) => n && placed(n));

    if (anchor) {
      const incoming = edges.some((e) => e.target === node.id && e.source === anchor.id);
      target.x = incoming
        ? anchor.x! + anchor.width! + COL_GAP
        : Math.max(40, anchor.x! - target.width! - COL_GAP);
      target.y = Math.round(anchor.y! + anchor.height! / 2 - target.height! / 2);
    } else {
      const maxX = Math.max(...[...byId.values()].filter(placed).map((n) => n.x! + n.width!));
      target.x = maxX + COL_GAP;
      target.y = ORIGIN_Y;
    }
    nudgeClear(target, byId);
  }
  return sizedNodes.map((n) => byId.get(n.id)!);
}

/** Slide a node down until it isn't sitting on top of anything already placed. */
function nudgeClear(node: ProcessNode, byId: Map<string, ProcessNode>): void {
  const others = [...byId.values()].filter((n) => n.id !== node.id && placed(n));
  let guard = 60;
  while (guard-- > 0) {
    const clash = others.find((o) => overlaps(node, o));
    if (!clash) return;
    node.y = clash.y! + clash.height! + ROW_GAP;
  }
}

function overlaps(a: ProcessNode, b: ProcessNode): boolean {
  const pad = 12;
  return (
    a.x! < b.x! + b.width! + pad &&
    a.x! + a.width! + pad > b.x! &&
    a.y! < b.y! + b.height! + pad &&
    a.y! + a.height! + pad > b.y!
  );
}

// ---------------------------------------------------------------------------
// VSM
// ---------------------------------------------------------------------------

/**
 * Beer's canonical arrangement: environment on the left, the System 1 operations
 * stacked in the middle, System 2 as a bar alongside them, and the 3/4/5
 * management column on the right. Laying it out this way (rather than generically)
 * is most of what makes a VSM diagram readable as a VSM diagram.
 */
const VSM_COLUMNS = {
  environment: { x: 40, width: 210 },
  system1: { x: 320, width: 210 },
  system2: { x: 600, width: 120 },
  management: { x: 780, width: 210 },
};

export function layoutVsm(nodes: VsmNode[], preservePlaced = true): VsmNode[] {
  const isPlaced = (n: VsmNode) => n.width > 0 && n.height > 0;
  const out = nodes.map((n) => ({ ...n }));

  const ones = out.filter((n) => n.type === 'system1');
  const envs = out.filter((n) => n.type === 'environment');

  const oneTop = 240;
  const oneStep = 130;
  const oneHeight = 92;

  ones.forEach((n, i) => {
    if (preservePlaced && isPlaced(n)) return;
    n.x = VSM_COLUMNS.system1.x;
    n.y = oneTop + i * oneStep;
    n.width = VSM_COLUMNS.system1.width;
    n.height = oneHeight;
    n.recursionLevel = n.recursionLevel ?? 1;
  });

  const blockBottom = oneTop + Math.max(ones.length, 1) * oneStep;

  envs.forEach((n, i) => {
    if (preservePlaced && isPlaced(n)) return;
    n.x = VSM_COLUMNS.environment.x;
    n.y = envs.length === 1 ? 150 : oneTop + i * oneStep - 8;
    n.width = VSM_COLUMNS.environment.width;
    n.height = envs.length === 1 ? Math.max(220, blockBottom - 190) : oneHeight + 16;
  });

  const management: { type: VsmNode['type']; y: number; height: number }[] = [
    { type: 'system5', y: 40, height: 74 },
    { type: 'system4', y: 144, height: 74 },
    { type: 'system3', y: 248, height: 74 },
    { type: 'system3star', y: 352, height: 64 },
  ];
  for (const spec of management) {
    for (const n of out.filter((x) => x.type === spec.type)) {
      if (preservePlaced && isPlaced(n)) continue;
      n.x = VSM_COLUMNS.management.x;
      n.y = spec.y;
      n.width = VSM_COLUMNS.management.width;
      n.height = spec.height;
      n.recursionLevel = n.recursionLevel ?? 0;
    }
  }

  for (const n of out.filter((x) => x.type === 'system2')) {
    if (preservePlaced && isPlaced(n)) continue;
    n.x = VSM_COLUMNS.system2.x;
    n.y = oneTop;
    n.width = VSM_COLUMNS.system2.width;
    n.height = Math.max(160, blockBottom - oneTop - (oneStep - oneHeight));
    n.recursionLevel = n.recursionLevel ?? 0;
  }

  // Anything unrecognised still gets a home rather than sitting at 0,0.
  out.forEach((n, i) => {
    if (n.width > 0 && n.height > 0) return;
    n.x = VSM_COLUMNS.system1.x;
    n.y = 40 + i * 110;
    n.width = 200;
    n.height = 80;
  });

  return out;
}

export function vsmBounds(nodes: VsmNode[], edges: VsmEdge[]): {
  width: number;
  height: number;
} {
  void edges;
  const width = Math.max(1060, ...nodes.map((n) => n.x + n.width + 60));
  const height = Math.max(560, ...nodes.map((n) => n.y + n.height + 60));
  return { width, height };
}
