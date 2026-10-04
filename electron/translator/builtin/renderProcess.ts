import type { ProcessEdge, ProcessNode } from '../../../src/model/types';
import { similarity } from './text';

/**
 * Process model → text, deterministically.
 *
 * The important trick: where an element still matches the sentence it came from,
 * that sentence is reused verbatim. So committing a diagram edit rewrites only
 * the steps you actually touched and leaves the author's own prose alone —
 * the same promise the LLM adapters are given in their prompt, kept here by
 * construction rather than by instruction.
 */

interface Block {
  text: string;
  children: Block[];
  /** Rendered without a number (the ELSE separator). */
  bare?: boolean;
}

const MARKER = /^\s*(?:\(?\d+[a-z]?[.)]|[-*•‣▪])\s+/i;

/** End-event names that say nothing beyond "the process stops here". */
const GENERIC_END = /^(?:end|end event|stop|done|finish(?:ed)?|complete[d]?)$/i;

/** Branch labels that read as "the question was answered yes". */
const AFFIRMATIVE =
  /^(?:yes|y|true|ok|okay|passe?[sd]?|approved?|valid|success\w*|accept\w*|complete[ds]?|done|good)$/i;

function lowerFirst(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

/** The sentence for one node: the author's own, if it still fits. */
function phraseFor(node: ProcessNode): string {
  const original = (node.sourceText ?? '').replace(MARKER, '').trim();
  if (original && similarity(original, node.name) >= 0.4) {
    // Their wording still describes this box — keep it exactly.
    const hasActor = /(^|\s)@[A-Za-z]/.test(original);
    const prefix = node.actor && !hasActor ? `@${node.actor} ` : '';
    return `${prefix}${original}`;
  }
  const name = node.name?.trim() || 'Step';
  const suffix = node.type === 'subProcess' && !/sub-?process/i.test(name) ? ' (sub-process)' : '';
  return `${node.actor ? `@${node.actor}: ` : ''}${name}${suffix}`;
}

function question(node: ProcessNode): string {
  const name = (node.name ?? '').trim().replace(/\?+$/, '');
  return lowerFirst(name || 'which way');
}

// -------------------------------------------------------------------- graph

interface Graph {
  nodes: Map<string, ProcessNode>;
  out: Map<string, ProcessEdge[]>;
}

function buildGraph(nodes: ProcessNode[], edges: ProcessEdge[]): Graph {
  const map = new Map(nodes.map((node) => [node.id, node]));
  const out = new Map<string, ProcessEdge[]>();
  for (const node of nodes) out.set(node.id, []);
  for (const edge of edges) {
    if (map.has(edge.source) && map.has(edge.target)) out.get(edge.source)!.push(edge);
  }
  return { nodes: map, out };
}

/** Depth of every node reachable from a start, for merge-point detection. */
function reachable(graph: Graph, from: string): Map<string, number> {
  const depths = new Map<string, number>([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    const depth = depths.get(id)!;
    for (const edge of graph.out.get(id) ?? []) {
      if (!depths.has(edge.target)) {
        depths.set(edge.target, depth + 1);
        queue.push(edge.target);
      }
    }
  }
  return depths;
}

/** The first node every branch reaches — where the branches come back together. */
function mergePoint(graph: Graph, starts: string[]): string | null {
  if (starts.length < 2) return null;
  const sets = starts.map((start) => reachable(graph, start));
  let best: { id: string; cost: number } | null = null;
  for (const [id, depth] of sets[0]) {
    let cost = depth;
    let inAll = true;
    for (const set of sets.slice(1)) {
      const other = set.get(id);
      if (other === undefined) {
        inAll = false;
        break;
      }
      cost = Math.max(cost, other);
    }
    if (inAll && (!best || cost < best.cost)) best = { id, cost };
  }
  return best?.id ?? null;
}

// ------------------------------------------------------------------- walking

function walk(
  graph: Graph,
  from: string | null,
  stopAt: string | null,
  visited: Set<string>,
): Block[] {
  const blocks: Block[] = [];
  let current = from;

  while (current && current !== stopAt) {
    const node = graph.nodes.get(current);
    if (!node) break;

    if (visited.has(current)) {
      // Two branches reaching the same ending is convergence, not a loop.
      if (node.type === 'endEvent') break;
      // A loop back is a property of the step before it, not a step of its own —
      // giving it its own line would re-parse into a phantom task.
      const previous = blocks[blocks.length - 1];
      const back = `then back to “${node.name || 'the earlier step'}”`;
      if (previous && !previous.bare) previous.text = `${previous.text} (${back})`;
      else blocks.push({ text: back, children: [], bare: true });
      break;
    }
    visited.add(current);

    const outgoing = graph.out.get(current) ?? [];

    if (node.type === 'endEvent') {
      // A named ending is worth a line — otherwise a branch that simply finishes
      // renders as an empty arm, and "IF x THEN <nothing> ELSE …" reads as a bug.
      if (node.name && !GENERIC_END.test(node.name)) {
        blocks.push({ text: phraseFor(node), children: [] });
      }
      break;
    }

    if (node.type === 'startEvent') {
      // Only worth a line if it was named after something that actually happens.
      if (node.name && !/^start$/i.test(node.name)) {
        blocks.push({ text: `${phraseFor(node)}`, children: [] });
      }
      current = outgoing[0]?.target ?? null;
      continue;
    }

    const branching = outgoing.length > 1;

    if (branching && node.type === 'exclusiveGateway') {
      let merge = mergePoint(graph, outgoing.map((edge) => edge.target));
      // Branches that only "meet" at the end event haven't really rejoined —
      // treating that as a merge empties one arm and strands the ending outside
      // the IF it belongs to.
      if (merge && graph.nodes.get(merge)?.type === 'endEvent') merge = null;
      if (outgoing.length === 2) {
        // The THEN arm is the one whose label reads as the affirmative answer to
        // the gateway's question, so "IF the finish passes THEN" is followed by
        // what happens when it passes — not by the rework branch.
        const yes = outgoing.find((edge) => AFFIRMATIVE.test(edge.name ?? 'yes')) ?? outgoing[0];
        const no = outgoing.find((edge) => edge !== yes)!;

        const thenArm = walk(graph, yes.target, merge, visited);
        const elseArm = walk(graph, no.target, merge, visited);

        // Both arms empty means the branch does nothing worth writing down.
        if (thenArm.length || elseArm.length) {
          blocks.push({
            text: `IF ${question(node)} THEN`,
            children: [
              ...thenArm,
              // ELSE lives inside the IF's children so the branch numbering runs
              // 3a / 3b straight through it.
              ...(elseArm.length
                ? [{ text: 'ELSE', children: [], bare: true } as Block, ...elseArm]
                : []),
            ],
          });
        }
      } else {
        blocks.push({
          text: `Depending on ${question(node)}:`,
          children: outgoing.flatMap((edge) => [
            {
              text: `if ${edge.name ?? 'otherwise'}:`,
              children: walk(graph, edge.target, merge, visited),
            },
          ]),
        });
      }
      current = merge;
      continue;
    }

    if (branching) {
      const merge = mergePoint(graph, outgoing.map((edge) => edge.target));
      blocks.push({
        text: 'At the same time:',
        children: outgoing.flatMap((edge) => walk(graph, edge.target, merge, visited)),
      });
      current = merge;
      continue;
    }

    // A join gateway on the way through carries no sentence of its own.
    if (node.type === 'parallelGateway' || node.type === 'exclusiveGateway') {
      current = outgoing[0]?.target ?? null;
      continue;
    }

    blocks.push({ text: phraseFor(node), children: [] });
    current = outgoing[0]?.target ?? null;
  }

  return blocks;
}

// ----------------------------------------------------------------- numbering

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function number(blocks: Block[], level: number, prefix: string): string[] {
  const lines: string[] = [];
  const indent = ' '.repeat(level * 5);
  let counter = 0;

  for (const block of blocks) {
    if (block.bare) {
      // ELSE sits slightly outdented from the branch it separates.
      lines.push(`${' '.repeat(Math.max(0, level * 5 - 2))}${block.text}`);
      continue;
    }

    if (!block.text && block.children.length) {
      // A wrapper that only exists to hold the ELSE arm.
      lines.push(...number(block.children, level, prefix));
      continue;
    }

    counter += 1;
    const label = level === 0 ? `${counter}` : `${prefix}${LETTERS[(counter - 1) % 26]}`;
    lines.push(`${indent}${label}. ${block.text}`);
    if (block.children.length) lines.push(...number(block.children, level + 1, label));
  }

  return lines;
}

export function renderProcess(nodes: ProcessNode[], edges: ProcessEdge[]): string {
  if (!nodes.length) return '';
  const graph = buildGraph(nodes, edges);

  const targets = new Set(edges.map((edge) => edge.target));
  const start =
    nodes.find((node) => node.type === 'startEvent') ??
    nodes.find((node) => !targets.has(node.id)) ??
    nodes[0];

  const visited = new Set<string>();
  const blocks = walk(graph, start.id, null, visited);

  // Anything unreachable from the start still deserves a mention rather than
  // silently vanishing from the description.
  const orphans = nodes.filter(
    (node) =>
      !visited.has(node.id) &&
      node.type !== 'endEvent' &&
      node.type !== 'startEvent' &&
      node.id !== start.id,
  );
  if (orphans.length) {
    blocks.push({
      text: 'Not yet connected to the flow:',
      children: orphans.map((node) => ({ text: phraseFor(node), children: [] })),
    });
  }

  return number(blocks, 0, '').join('\n');
}
