import { z } from 'zod';
import type {
  MergeProcessInput,
  ProcessEdge,
  ProcessNode,
  ProcessToTextInput,
  TextToProcessInput,
  TextToVsmInput,
  VsmEdge,
  VsmNode,
  VsmToTextInput,
} from '../../src/model/types';

/**
 * Wire shapes and normalisation shared by every LLM-backed adapter.
 *
 * Anthropic and Ollama ask for the same JSON and validate it the same way; only
 * the transport differs. The built-in rule-based provider bypasses all of this —
 * it builds the model directly.
 */

export const NODE_TYPES = [
  'startEvent',
  'endEvent',
  'task',
  'subProcess',
  'exclusiveGateway',
  'parallelGateway',
] as const;

export const VSM_TYPES = [
  'system1',
  'system2',
  'system3',
  'system3star',
  'system4',
  'system5',
  'environment',
] as const;

export const CHANNELS = [
  'command',
  'coordination',
  'audit',
  'algedonic',
  'operational',
  'environmental',
] as const;

// --------------------------------------------------------------- JSON Schema

const provenanceProps = {
  sourceText: { type: ['string', 'null'], description: 'Verbatim text this came from' },
  sourceLineStart: { type: ['integer', 'null'], description: '1-indexed first line' },
  sourceLineEnd: { type: ['integer', 'null'], description: '1-indexed last line, inclusive' },
};

const processNodeSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: NODE_TYPES },
    name: { type: 'string' },
    actor: { type: ['string', 'null'], description: 'Who performs this step' },
    note: { type: ['string', 'null'], description: 'One-line plain explainer shown on hover' },
    ...provenanceProps,
  },
  required: ['id', 'type', 'name'],
  additionalProperties: false,
};

const processEdgeSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    source: { type: 'string' },
    target: { type: 'string' },
    name: {
      type: ['string', 'null'],
      description: 'Condition label; required on exclusive gateway branches',
    },
    ...provenanceProps,
  },
  required: ['id', 'source', 'target'],
  additionalProperties: false,
};

export const PROCESS_SCHEMA = {
  type: 'object',
  properties: {
    nodes: { type: 'array', items: processNodeSchema },
    edges: { type: 'array', items: processEdgeSchema },
  },
  required: ['nodes', 'edges'],
  additionalProperties: false,
};

export const MERGE_SCHEMA = {
  type: 'object',
  properties: {
    nodes: { type: 'array', items: processNodeSchema },
    edges: { type: 'array', items: processEdgeSchema },
    text: { type: 'string', description: 'The merged plain-language description' },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description: 'One short line per conflict saying how it was settled',
    },
  },
  required: ['nodes', 'edges', 'text', 'notes'],
  additionalProperties: false,
};

export const VSM_SCHEMA = {
  type: 'object',
  properties: {
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: VSM_TYPES },
          name: { type: 'string' },
          note: { type: ['string', 'null'] },
          recursionLevel: { type: ['integer', 'null'] },
          linkedDiagramId: {
            type: ['string', 'null'],
            description: 'Only for system1, and only an id from the supplied list',
          },
          ...provenanceProps,
        },
        required: ['id', 'type', 'name'],
        additionalProperties: false,
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          source: { type: 'string' },
          target: { type: 'string' },
          channel: { type: 'string', enum: CHANNELS },
          name: { type: ['string', 'null'] },
          ...provenanceProps,
        },
        required: ['id', 'source', 'target', 'channel'],
        additionalProperties: false,
      },
    },
  },
  required: ['nodes', 'edges'],
  additionalProperties: false,
};

// ---------------------------------------------------------------------- zod

const nullableString = z.union([z.string(), z.null()]).optional();
const nullableInt = z.union([z.number(), z.null()]).optional();

export const ZProcessNode = z.object({
  id: z.string(),
  type: z.enum(NODE_TYPES),
  name: z.string(),
  actor: nullableString,
  note: nullableString,
  sourceText: nullableString,
  sourceLineStart: nullableInt,
  sourceLineEnd: nullableInt,
});

export const ZProcessEdge = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  name: nullableString,
  sourceText: nullableString,
  sourceLineStart: nullableInt,
  sourceLineEnd: nullableInt,
});

export const ZProcess = z.object({
  nodes: z.array(ZProcessNode),
  edges: z.array(ZProcessEdge),
});

export const ZMerge = ZProcess.extend({
  text: z.string(),
  notes: z.array(z.string()).default([]),
});

export const ZVsm = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.enum(VSM_TYPES),
      name: z.string(),
      note: nullableString,
      recursionLevel: nullableInt,
      linkedDiagramId: nullableString,
      sourceText: nullableString,
      sourceLineStart: nullableInt,
      sourceLineEnd: nullableInt,
    }),
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      channel: z.enum(CHANNELS),
      name: nullableString,
      sourceText: nullableString,
      sourceLineStart: nullableInt,
      sourceLineEnd: nullableInt,
    }),
  ),
});

// -------------------------------------------------------------- normalisation

export function lineRange(
  start: number | null | undefined,
  end: number | null | undefined,
  max: number,
): [number, number] | undefined {
  if (start == null || end == null) return undefined;
  const a = Math.max(1, Math.min(Math.round(start), max));
  const b = Math.max(a, Math.min(Math.round(end), max));
  return [a, b];
}

export function orUndef(value: string | null | undefined): string | undefined {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : undefined;
}

export function toProcessNodes(
  wire: z.infer<typeof ZProcessNode>[],
  lineCount: number,
): ProcessNode[] {
  return wire.map((n) => ({
    id: n.id,
    type: n.type,
    name: n.name,
    actor: orUndef(n.actor),
    note: orUndef(n.note),
    sourceText: orUndef(n.sourceText),
    sourceLines: lineRange(n.sourceLineStart, n.sourceLineEnd, lineCount),
  }));
}

export function toProcessEdges(
  wire: z.infer<typeof ZProcessEdge>[],
  lineCount: number,
): ProcessEdge[] {
  return wire.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    name: orUndef(e.name),
    sourceText: orUndef(e.sourceText),
    sourceLines: lineRange(e.sourceLineStart, e.sourceLineEnd, lineCount),
  }));
}

export function toVsm(
  wire: z.infer<typeof ZVsm>,
  lineCount: number,
  knownDiagramIds: Set<string>,
): { nodes: VsmNode[]; edges: VsmEdge[] } {
  const nodes: VsmNode[] = wire.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    name: n.name,
    note: orUndef(n.note),
    recursionLevel: n.recursionLevel ?? undefined,
    linkedDiagramId:
      n.type === 'system1' && n.linkedDiagramId && knownDiagramIds.has(n.linkedDiagramId)
        ? n.linkedDiagramId
        : undefined,
    sourceText: orUndef(n.sourceText),
    sourceLines: lineRange(n.sourceLineStart, n.sourceLineEnd, lineCount),
    // Zeroed geometry means "unplaced"; layoutVsm fills it in.
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  }));

  const ids = new Set(nodes.map((n) => n.id));
  const edges: VsmEdge[] = wire.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      channel: e.channel,
      name: orUndef(e.name),
      sourceText: orUndef(e.sourceText),
      sourceLines: lineRange(e.sourceLineStart, e.sourceLineEnd, lineCount),
    }));
  return { nodes, edges };
}

/** Drop duplicates and edges pointing at nodes that didn't survive. */
export function pruneProcess(model: { nodes: ProcessNode[]; edges: ProcessEdge[] }) {
  const seen = new Set<string>();
  const nodes = model.nodes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
  const ids = new Set(nodes.map((n) => n.id));
  const edgeIds = new Set<string>();
  const edges = model.edges.filter(
    (e) =>
      ids.has(e.source) &&
      ids.has(e.target) &&
      e.source !== e.target &&
      !edgeIds.has(e.id) &&
      (edgeIds.add(e.id), true),
  );
  return { nodes, edges };
}

/** Number the text so the model's line references have something to refer to. */
export function numbered(text: string): string {
  return text
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(3, ' ')} | ${line}`)
    .join('\n');
}

export const lineCountOf = (text: string) => text.split('\n').length;

/** Strip geometry before sending — it's noise to the model and burns tokens. */
export function compact(model: { nodes: ProcessNode[]; edges: ProcessEdge[] }) {
  return {
    nodes: model.nodes.map(({ x, y, width, height, ...rest }) => rest),
    edges: model.edges.map(({ waypoints, ...rest }) => rest),
  };
}

export function stripFence(text: string): string {
  const fenced = text.match(/^\s*```(?:json|text|markdown)?\s*\n([\s\S]*?)\n?\s*```\s*$/);
  return fenced ? fenced[1] : text;
}

/** Turn a zod failure into something a person can act on. */
export function describeParseFailure(error: z.ZodError): string {
  const first = error.issues[0];
  return `The translator returned an unexpected shape (${
    first.path.join('.') || 'root'
  }: ${first.message}). Try committing again.`;
}

// ------------------------------------------------------- shared user messages
//
// Both LLM adapters send exactly the same content; only the transport differs.
// Keeping these here means a prompt improvement lands on both at once.

export function textToProcessUserMessage(input: TextToProcessInput): string {
  return [
    `DIAGRAM NAME: ${input.diagramName}`,
    '',
    'CURRENT MODEL (reuse these ids wherever an element survives):',
    JSON.stringify(compact(input.current), null, 2),
    '',
    'INPUT TEXT (line-numbered; the numbers are not part of the text):',
    numbered(input.text),
  ].join('\n');
}

export function processToTextUserMessage(input: ProcessToTextInput): string {
  return [
    `DIAGRAM NAME: ${input.diagramName}`,
    '',
    "PREVIOUS TEXT (the author's own writing — preserve it where the model agrees):",
    input.previousText || '(none yet)',
    '',
    'MODEL:',
    JSON.stringify(compact({ nodes: input.nodes, edges: input.edges }), null, 2),
  ].join('\n');
}

export function textToVsmUserMessage(input: TextToVsmInput): string {
  return [
    'PROCESS DIAGRAMS AVAILABLE TO LINK A SYSTEM 1 TO:',
    input.availableDiagrams.length
      ? input.availableDiagrams.map((d) => `  ${d.id} — ${d.name}`).join('\n')
      : '  (none)',
    '',
    'CURRENT MODEL (reuse these ids wherever an element survives):',
    JSON.stringify(input.current, null, 2),
    '',
    'INPUT TEXT (line-numbered; the numbers are not part of the text):',
    numbered(input.text),
  ].join('\n');
}

export function vsmToTextUserMessage(input: VsmToTextInput): string {
  return [
    "PREVIOUS TEXT (the author's own writing — preserve it where the model agrees):",
    input.previousText || '(none yet)',
    '',
    'MODEL:',
    JSON.stringify({ nodes: input.nodes, edges: input.edges }, null, 2),
  ].join('\n');
}

export function mergeUserMessage(input: MergeProcessInput): string {
  const resolutionBlock = input.auto
    ? [
        'RESOLUTIONS: none — the user pressed "I\'m Feeling Lucky". Decide each',
        'conflict yourself, choosing whichever side better preserves the intent of',
        'the process as a whole. As a default lean, prefer the diagram for structure',
        '(what connects to what) and the text for naming and intent — but override',
        'that lean whenever the specific conflict argues otherwise.',
      ].join('\n')
    : [
        'RESOLUTIONS:',
        ...input.resolutions.map((r) => {
          const conflict = input.conflicts.find((c) => c.id === r.conflictId);
          const label = conflict ? `${conflict.title} (${conflict.category})` : r.conflictId;
          const choice =
            r.choice === 'instruction' ? 'follow the instruction below' : `keep the ${r.choice} side`;
          const instruction = r.instruction ? `\n      INSTRUCTION: ${r.instruction}` : '';
          return `  - ${label}: ${choice}${instruction}`;
        }),
      ].join('\n');

  return [
    `DIAGRAM NAME: ${input.diagramName}`,
    '',
    'BASE TEXT (at the last commit):',
    input.baseText || '(empty)',
    '',
    'BASE MODEL (the common ancestor both sides were edited from):',
    JSON.stringify(compact(input.base), null, 2),
    '',
    'EDITED TEXT (line-numbered; the numbers are not part of the text):',
    numbered(input.editedText),
    '',
    'FROM TEXT (model implied by the edited text):',
    JSON.stringify(compact(input.fromText), null, 2),
    '',
    'FROM DIAGRAM (model as left on the canvas):',
    JSON.stringify(compact(input.fromDiagram), null, 2),
    '',
    'CONFLICTS:',
    JSON.stringify(
      input.conflicts.map((c) => ({
        id: c.id,
        title: c.title,
        category: c.category,
        elementId: c.elementId,
        textSide: c.text.description,
        diagramSide: c.diagram.description,
      })),
      null,
      2,
    ),
    '',
    resolutionBlock,
  ].join('\n');
}
