import { flowId, nodeId } from '../../../src/model/ids';
import type { ProcessEdge, ProcessNode } from '../../../src/model/types';
import { lex, toLabel, toQuestion, type Line } from './lex';
import { similarity } from './text';

/**
 * Text → process model, deterministically.
 *
 * Two passes: lines become a nested block tree (steps, IF/ELSE, parallel groups),
 * then the tree is walked into a graph. A third pass re-attaches existing element
 * ids so a re-commit doesn't scramble the layout — the same guarantee the LLM
 * adapters get by being told to reuse ids, done here by matching.
 */

type Item =
  | { kind: 'step'; line: Line; children: Item[] }
  | { kind: 'if'; line: Line; then: Item[]; otherwise: Item[] }
  | { kind: 'parallel'; line: Line; branches: Item[][] };

const TRIGGER =
  /\b(submits?|sends?|arrives?|requests?|receives?|is received|comes in|is raised|raises?|triggers?|starts?|begins?|released?|opened?|logged?|created?)\b/i;

// --------------------------------------------------------------- block tree

function parseItems(lines: Line[], start: number, minIndent: number): [Item[], number] {
  const items: Item[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];

    if (line.kind === 'blank') {
      i += 1;
      continue;
    }
    // Left to the enclosing IF to consume.
    if (line.kind === 'else' || line.kind === 'endif') break;
    if (line.indent < minIndent) break;

    if (line.kind === 'if') {
      i += 1;
      const thenItems: Item[] = [];
      // "IF x THEN do y" — the trailing clause is the first step of the branch.
      if (line.text) {
        thenItems.push({ kind: 'step', line: { ...line, kind: 'step' }, children: [] });
      }
      const [nested, afterThen] = parseItems(lines, i, line.indent + 1);
      thenItems.push(...nested);
      i = afterThen;

      const otherwise: Item[] = [];
      const next = lines[i];
      if (next && next.kind === 'else' && next.indent >= line.indent) {
        i += 1;
        if (next.text) {
          otherwise.push({ kind: 'step', line: { ...next, kind: 'step' }, children: [] });
        }
        const [elseItems, afterElse] = parseItems(lines, i, line.indent + 1);
        otherwise.push(...elseItems);
        i = afterElse;
      }
      const closer = lines[i];
      if (closer && closer.kind === 'endif' && closer.indent >= line.indent) i += 1;

      items.push({ kind: 'if', line, then: thenItems, otherwise });
      continue;
    }

    if (line.kind === 'parallel') {
      i += 1;
      const [children, after] = parseItems(lines, i, line.indent + 1);
      i = after;
      // Each direct child is one concurrent branch.
      items.push({ kind: 'parallel', line, branches: children.map((child) => [child]) });
      continue;
    }

    // Plain step; anything indented beneath it is its internals.
    i += 1;
    const [children, after] = parseItems(lines, i, line.indent + 1);
    i = after;
    items.push({ kind: 'step', line, children });
  }

  return [items, i];
}

// ----------------------------------------------------------------- emission

interface Port {
  node: string;
  label?: string;
  sourceText?: string;
  sourceLines?: [number, number];
}

interface Emitter {
  nodes: ProcessNode[];
  edges: ProcessEdge[];
}

function addNode(ctx: Emitter, node: Omit<ProcessNode, 'id'>): string {
  const id = nodeId();
  ctx.nodes.push({ ...node, id });
  return id;
}

function connect(ctx: Emitter, from: Port[], to: string): void {
  for (const port of from) {
    ctx.edges.push({
      id: flowId(),
      source: port.node,
      target: to,
      name: port.label,
      sourceText: port.sourceText,
      sourceLines: port.sourceLines,
    });
  }
}

function emitItems(items: Item[], incoming: Port[], ctx: Emitter): Port[] {
  let ports = incoming;
  for (const item of items) ports = emitItem(item, ports, ctx);
  return ports;
}

function emitItem(item: Item, incoming: Port[], ctx: Emitter): Port[] {
  if (item.kind === 'step') {
    const isSub = item.line.explicitSubProcess || item.children.length > 0;
    const id = addNode(ctx, {
      type: isSub ? 'subProcess' : 'task',
      name: toLabel(item.line.text) || 'Step',
      actor: item.line.actor,
      sourceText: item.line.raw,
      sourceLines: [item.line.no, lastLineOf(item)],
      note: isSub && item.children.length ? 'Its steps are indented under it in the text.' : undefined,
    });
    connect(ctx, incoming, id);
    return [{ node: id }];
  }

  if (item.kind === 'if') {
    const gateway = addNode(ctx, {
      type: 'exclusiveGateway',
      name: toQuestion(item.line.condition ?? ''),
      sourceText: item.line.raw,
      sourceLines: [item.line.no, item.line.no],
    });
    connect(ctx, incoming, gateway);

    const yesPort: Port = {
      node: gateway,
      label: 'yes',
      sourceText: item.then[0] ? rawOf(item.then[0]) : item.line.raw,
      sourceLines: item.then[0] ? [firstLineOf(item.then[0]), firstLineOf(item.then[0])] : undefined,
    };
    const noPort: Port = {
      node: gateway,
      label: 'no',
      sourceText: item.otherwise[0] ? rawOf(item.otherwise[0]) : undefined,
      sourceLines: item.otherwise[0]
        ? [firstLineOf(item.otherwise[0]), firstLineOf(item.otherwise[0])]
        : undefined,
    };

    const thenOut = item.then.length ? emitItems(item.then, [yesPort], ctx) : [yesPort];
    const elseOut = item.otherwise.length ? emitItems(item.otherwise, [noPort], ctx) : [noPort];
    // Both arms stay open; whatever comes next joins them, or they reach the end.
    return [...thenOut, ...elseOut];
  }

  // Parallel. A single branch needs no gateway at all.
  if (item.branches.length < 2) {
    return item.branches.length ? emitItems(item.branches[0], incoming, ctx) : incoming;
  }

  const split = addNode(ctx, {
    type: 'parallelGateway',
    name: 'Split',
    sourceText: item.line.raw,
    sourceLines: [item.line.no, item.line.no],
    note: 'Every outgoing path starts at once.',
  });
  connect(ctx, incoming, split);

  const ends: Port[] = [];
  for (const branch of item.branches) {
    ends.push(...emitItems(branch, [{ node: split }], ctx));
  }

  const join = addNode(ctx, {
    type: 'parallelGateway',
    name: 'Join',
    sourceText: item.line.raw,
    sourceLines: [item.line.no, item.line.no],
    note: 'Waits for every branch before the process continues.',
  });
  connect(ctx, ends, join);
  return [{ node: join }];
}

function firstLineOf(item: Item): number {
  return item.line.no;
}

function rawOf(item: Item): string {
  return item.line.raw;
}

function lastLineOf(item: Item): number {
  if (item.kind === 'step') {
    return item.children.length ? Math.max(...item.children.map(lastLineOf)) : item.line.no;
  }
  if (item.kind === 'if') {
    const all = [...item.then, ...item.otherwise];
    return all.length ? Math.max(...all.map(lastLineOf)) : item.line.no;
  }
  const all = item.branches.flat();
  return all.length ? Math.max(...all.map(lastLineOf)) : item.line.no;
}

// ------------------------------------------------------------------ id reuse

/**
 * Match freshly parsed elements onto the ids they had last time. Getting this
 * right is what stops a re-commit from throwing the user's layout away.
 */
export function reuseIds(
  fresh: { nodes: ProcessNode[]; edges: ProcessEdge[] },
  current: { nodes: ProcessNode[]; edges: ProcessEdge[] },
): { nodes: ProcessNode[]; edges: ProcessEdge[] } {
  const remap = new Map<string, string>();
  const taken = new Set<string>();

  const byType = new Map<string, ProcessNode[]>();
  for (const node of current.nodes) {
    if (!byType.has(node.type)) byType.set(node.type, []);
    byType.get(node.type)!.push(node);
  }

  const freshByType = new Map<string, ProcessNode[]>();
  for (const node of fresh.nodes) {
    if (!freshByType.has(node.type)) freshByType.set(node.type, []);
    freshByType.get(node.type)!.push(node);
  }

  for (const [type, freshOfType] of freshByType) {
    const candidates = byType.get(type) ?? [];

    freshOfType.forEach((node, index) => {
      let bestId: string | null = null;
      let bestScore = 0;

      candidates.forEach((candidate, candidateIndex) => {
        if (taken.has(candidate.id)) return;

        let score = similarity(node.name, candidate.name);
        // Verbatim source line is the strongest possible evidence.
        if (node.sourceText && node.sourceText === candidate.sourceText) score = 1;
        if (node.actor && node.actor === candidate.actor) score += 0.1;
        // Same slot in the same order is worth something on its own; events and
        // gateways are near-anonymous, so position carries most of the weight.
        const positional = index === candidateIndex ? 0.3 : 0;
        const structural = type === 'startEvent' || type === 'endEvent' ? 0.5 : 0;
        score += positional + structural;

        if (score > bestScore) {
          bestScore = score;
          bestId = candidate.id;
        }
      });

      if (bestId && bestScore >= 0.34) {
        remap.set(node.id, bestId);
        taken.add(bestId);
      }
    });
  }

  const nodes = fresh.nodes.map((node) => ({ ...node, id: remap.get(node.id) ?? node.id }));

  // Re-use an edge id when the same connection existed before.
  const existingEdges = new Map(
    current.edges.map((edge) => [`${edge.source}→${edge.target}`, edge.id]),
  );
  const usedEdges = new Set<string>();
  const edges = fresh.edges.map((edge) => {
    const source = remap.get(edge.source) ?? edge.source;
    const target = remap.get(edge.target) ?? edge.target;
    const previous = existingEdges.get(`${source}→${target}`);
    const id = previous && !usedEdges.has(previous) ? previous : edge.id;
    usedEdges.add(id);
    return { ...edge, id, source, target };
  });

  return { nodes, edges };
}

// -------------------------------------------------------------------- entry

export function parseProcess(
  text: string,
  current: { nodes: ProcessNode[]; edges: ProcessEdge[] },
): { nodes: ProcessNode[]; edges: ProcessEdge[] } {
  const lines = lex(text);
  const [items] = parseItems(lines, 0, 0);
  const ctx: Emitter = { nodes: [], edges: [] };

  const body = [...items];

  // A first line that reads like a trigger becomes the start event itself,
  // rather than a task with a bare "Start" bolted in front of it.
  let startName = 'Start';
  let startSource: Line | undefined;
  const head = body[0];
  if (
    head &&
    head.kind === 'step' &&
    !head.children.length &&
    !head.line.explicitSubProcess &&
    TRIGGER.test(head.line.text)
  ) {
    startName = toLabel(head.line.text) || 'Start';
    startSource = head.line;
    body.shift();
  }

  const start = addNode(ctx, {
    type: 'startEvent',
    name: startName,
    sourceText: startSource?.raw,
    sourceLines: startSource ? [startSource.no, startSource.no] : undefined,
  });

  const open = emitItems(body, [{ node: start }], ctx);

  const end = addNode(ctx, { type: 'endEvent', name: 'End' });
  connect(ctx, open, end);

  return reuseIds(ctx, current);
}
