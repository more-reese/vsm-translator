import { layoutVsm } from '../../../src/model/layout';
import type {
  MergedProcess,
  MergeProcessInput,
  ProcessEdge,
  ProcessNode,
  ProcessToTextInput,
  ProcessTranslation,
  TextToProcessInput,
  TextToVsmInput,
  TranslationProvider,
  VsmToTextInput,
  VsmTranslation,
} from '../../../src/model/types';
import { pruneProcess } from '../shape';
import { parseProcess } from './parseProcess';
import { renderProcess } from './renderProcess';
import { parseVsm, renderVsm } from './vsm';

/**
 * The offline provider: no key, no server, no network, no model download.
 *
 * It reads the same lightly-structured notation the LLM adapters are prompted to
 * understand, so switching between them is a change of quality rather than a
 * change of language. What it cannot do is interpret genuinely loose prose, or
 * act on a free-text instruction in the conflict dialog — hence
 * `supportsInstructions: false`, which hides that box rather than ignoring it.
 */
export class BuiltinTranslator implements TranslationProvider {
  readonly id = 'builtin';
  readonly label = 'Built-in (offline, no API key)';
  readonly blurb = 'Rule-based. Instant, private, works on a plane. Needs your steps to be reasonably structured.';
  readonly offline = true;
  readonly needsApiKey = false;
  readonly supportsInstructions = false;

  isConfigured(): boolean {
    return true;
  }

  async test(): Promise<{ ok: boolean; message: string }> {
    // Round-trip a snippet rather than claim success — this is a real check.
    const sample = ['1. @Sales checks the order.', '2. IF it is urgent THEN', '     2a. escalate it.'].join(
      '\n',
    );
    const parsed = parseProcess(sample, { nodes: [], edges: [] });
    const gateway = parsed.nodes.some((node) => node.type === 'exclusiveGateway');
    const actor = parsed.nodes.some((node) => node.actor === 'Sales');
    return gateway && actor
      ? { ok: true, message: 'Ready. No key needed, nothing leaves this machine.' }
      : { ok: false, message: 'The built-in parser failed its own self-check.' };
  }

  async textToProcess(input: TextToProcessInput): Promise<ProcessTranslation> {
    return pruneProcess(parseProcess(input.text, input.current));
  }

  async processToText(input: ProcessToTextInput): Promise<string> {
    return renderProcess(input.nodes, input.edges);
  }

  async textToVsm(input: TextToVsmInput): Promise<VsmTranslation> {
    const parsed = parseVsm(input.text, input.current, input.availableDiagrams);
    return { nodes: layoutVsm(parsed.nodes), edges: parsed.edges };
  }

  async vsmToText(input: VsmToTextInput): Promise<string> {
    return renderVsm(input.nodes, input.edges);
  }

  async mergeProcess(input: MergeProcessInput): Promise<MergedProcess> {
    const notes: string[] = [];
    const decisions = new Map<string, 'text' | 'diagram'>();

    for (const conflict of input.conflicts) {
      const resolution = input.resolutions.find((r) => r.conflictId === conflict.id);
      const side =
        input.auto || !resolution || resolution.choice === 'instruction'
          ? conflict.suggested
          : resolution.choice;
      decisions.set(`${conflict.elementKind}:${conflict.elementId}`, side);
      notes.push(`${conflict.title}: kept the ${side} version.`);
      if (resolution?.instruction) {
        notes.push(
          `Note: “${resolution.instruction}” was not applied — the built-in translator cannot act on written instructions. Switch to Claude or a local model for that.`,
        );
      }
    }

    const merged = mergeSides(input, decisions);
    const pruned = pruneProcess(merged);
    return {
      ...pruned,
      text: renderProcess(pruned.nodes, pruned.edges),
      notes,
    };
  }
}

const nodeShape = (node?: ProcessNode) =>
  node && JSON.stringify([node.type, (node.name ?? '').trim(), node.actor ?? '']);
const edgeShape = (edge?: ProcessEdge) =>
  edge && JSON.stringify([edge.source, edge.target, (edge.name ?? '').trim()]);

/**
 * Element-by-element three-way merge. Conflicts follow the user's decision;
 * everything else follows whichever side actually moved away from the common
 * ancestor — the same rule the conflict detector used to decide it wasn't worth
 * asking about.
 */
function mergeSides(
  input: MergeProcessInput,
  decisions: Map<string, 'text' | 'diagram'>,
): { nodes: ProcessNode[]; edges: ProcessEdge[] } {
  const index = <T extends { id: string }>(items: T[]) => new Map(items.map((i) => [i.id, i]));

  const baseNodes = index(input.base.nodes);
  const textNodes = index(input.fromText.nodes);
  const diagramNodes = index(input.fromDiagram.nodes);

  const nodes: ProcessNode[] = [];
  for (const id of new Set([...baseNodes.keys(), ...textNodes.keys(), ...diagramNodes.keys()])) {
    const decision = decisions.get(`node:${id}`);
    const fromText = textNodes.get(id);
    const fromDiagram = diagramNodes.get(id);
    let chosen: ProcessNode | undefined;

    if (decision) {
      chosen = decision === 'text' ? fromText : fromDiagram;
    } else {
      const base = baseNodes.get(id);
      if (!base) chosen = fromText ?? fromDiagram;
      else chosen = nodeShape(fromText) !== nodeShape(base) ? fromText : fromDiagram;
    }
    if (chosen) nodes.push(chosen);
  }

  const baseEdges = index(input.base.edges);
  const textEdges = index(input.fromText.edges);
  const diagramEdges = index(input.fromDiagram.edges);

  const present = new Set(nodes.map((node) => node.id));
  const edges: ProcessEdge[] = [];
  for (const id of new Set([...baseEdges.keys(), ...textEdges.keys(), ...diagramEdges.keys()])) {
    const decision = decisions.get(`edge:${id}`);
    const fromText = textEdges.get(id);
    const fromDiagram = diagramEdges.get(id);
    let chosen: ProcessEdge | undefined;

    if (decision) {
      chosen = decision === 'text' ? fromText : fromDiagram;
    } else {
      const base = baseEdges.get(id);
      if (!base) chosen = fromText ?? fromDiagram;
      else chosen = edgeShape(fromText) !== edgeShape(base) ? fromText : fromDiagram;
    }
    if (chosen && present.has(chosen.source) && present.has(chosen.target)) edges.push(chosen);
  }

  return { nodes, edges };
}
