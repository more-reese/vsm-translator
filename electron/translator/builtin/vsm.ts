import { vsmEdgeId, vsmNodeId } from '../../../src/model/ids';
import type { VsmChannelType, VsmEdge, VsmNode, VsmNodeType } from '../../../src/model/types';

/**
 * Text ↔ VSM, deterministically.
 *
 * Classification is keyword-driven and ordered most-specific-first (audit before
 * control, intelligence before environment), because the giveaway words overlap:
 * "market" appears in both "watches the market" and "market conditions", and only
 * the surrounding verb separates System 4 from the environment it is scanning.
 */

interface Rule {
  type: VsmNodeType;
  re: RegExp;
  fallbackName: string;
}

const RULES: Rule[] = [
  {
    type: 'system5',
    re: /\b(policy|identity|stands? for|what the (?:business|organisation|organization|company) is|mission|values|charter|arbitrat|partners?|board|trustees?)\b/i,
    fallbackName: 'Policy',
  },
  {
    type: 'system3star',
    re: /\b(audit|inspect\w*|spot[-\s]?check|walk(?:s|ing)? the floor|sampl\w+|mystery shop)\b/i,
    fallbackName: 'Audit',
  },
  {
    type: 'system4',
    re: /\b(watch\w*|scan\w*|market|future|trends?|research|strategy|strategic|plans? (?:what|for|ahead)|road ?map|competitors?|intelligence|what.{0,20}next|new (?:materials|technolog\w+))\b/i,
    fallbackName: 'Intelligence',
  },
  {
    type: 'system3',
    re: /\b(allocat\w*|resourc\w*|budget\w*|control\w*|day[-\s]to[-\s]day|week by week|operations manager|accountab\w*|holds? them|targets?|prioritis\w+|prioritiz\w+)\b/i,
    fallbackName: 'Control',
  },
  {
    type: 'system2',
    re: /\b(coordinat\w*|calendar|schedul\w*|standard\w*|convention\w*|clash\w*|tripping over|shared|protocol|style guide|handbook|templates?)\b/i,
    fallbackName: 'Coordination',
  },
  {
    type: 'environment',
    re: /\b(customers?|clients?|suppliers?|regulat\w*|the (?:outside )?world|environment|marketplace|public|community)\b/i,
    fallbackName: 'Environment',
  },
  {
    type: 'system1',
    re: /\b(units?|teams?|divisions?|departments?|branch\w*|shops?|studios?|workshops?|crews?|squads?|cells?|does the (?:actual )?work|operat\w*|deliver\w*|produc\w*)\b/i,
    fallbackName: 'Operations',
  },
];

const SPLIT_VERB =
  /\s+(?:are|is|do|does|handle[sd]?|manage[sd]?|run[s]?|keep[s]?|allocat\w*|inspect\w*|watch\w*|set[s]?|decide[s]?|coordinat\w*|scan[s]?|plan[s]?|hold[s]?|make[s]?|look[s]?|deal[s]?)\s+/i;

const BAD_SUBJECT = /^(every|some|someone|when|if|there|it|they|we|each|most|often|occasionally|now)\b/i;

const MARKER = /^\s*(?:\(?\d+[a-z]?[.)]|[-*•‣▪])\s+/i;

function tidy(text: string): string {
  const cleaned = text
    .replace(/^\s*(?:the|a|an)\s+/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:]+$/, '')
    .trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : cleaned;
}

/** Whatever sits before the line's main verb, unfiltered. */
function rawSubject(line: string): string | null {
  const split = line.split(SPLIT_VERB);
  const subject = (split.length > 1 ? split[0] : line).trim();
  if (!subject || BAD_SUBJECT.test(subject)) return null;
  return subject;
}

/** The noun phrase a line is about, if it reads like a usable name. */
function subjectOf(line: string): string | null {
  const subject = rawSubject(line);
  if (!subject) return null;
  // A list of several units is long by nature; it gets split before it is named,
  // so only single-name subjects are length-checked here.
  if (subject.split(/\s+/).length > 10) return null;
  const tidied = tidy(subject);
  return tidied.length > 2 ? tidied.slice(0, 52) : null;
}

/** "The workshop, the design studio and the delivery team" → three units. */
function splitUnits(subject: string): string[] {
  return subject
    .split(/\s*,\s*|\s+and\s+|\s*&\s*|\s*\/\s*/i)
    .map((part) => tidy(part))
    .filter((part) => part.length > 1);
}

export function parseVsm(
  text: string,
  current: { nodes: VsmNode[]; edges: VsmEdge[] },
  availableDiagrams: { id: string; name: string }[],
): { nodes: VsmNode[]; edges: VsmEdge[] } {
  const nodes: VsmNode[] = [];

  const blank = (type: VsmNodeType, name: string, line: string, no: number): VsmNode => ({
    id: vsmNodeId(),
    type,
    name,
    sourceText: line,
    sourceLines: [no, no],
    recursionLevel: type === 'system1' ? 1 : 0,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  text.split('\n').forEach((raw, index) => {
    const line = raw.replace(MARKER, '').trim();
    if (!line) return;

    const rule = RULES.find((candidate) => candidate.re.test(line));
    if (!rule) return;

    if (rule.type === 'system1') {
      // One line commonly names several operating units at once — split before
      // judging length, or "the workshop, the studio and the delivery team"
      // looks like one unusably long name and gets thrown away.
      const raw = rawSubject(line);
      const units = raw ? splitUnits(raw).filter((unit) => unit.split(/\s+/).length <= 6) : [];
      const named = units.length ? units : [subjectOf(line) ?? rule.fallbackName];
      for (const name of named) nodes.push(blank('system1', name, line, index + 1));
      return;
    }

    nodes.push(blank(rule.type, subjectOf(line) ?? rule.fallbackName, line, index + 1));
  });

  // At most one of each management system; keep the first mention of each.
  const singletons: VsmNodeType[] = ['system2', 'system3', 'system3star', 'system4', 'system5'];
  const seen = new Set<VsmNodeType>();
  const deduped = nodes.filter((node) => {
    if (!singletons.includes(node.type)) return true;
    if (seen.has(node.type)) return false;
    seen.add(node.type);
    return true;
  });

  linkToDiagrams(deduped, availableDiagrams);
  const withIds = reuseVsmIds(deduped, current.nodes);
  return { nodes: withIds, edges: wireChannels(withIds, current.edges) };
}

/** A System 1 whose name matches a process diagram gets linked to it. */
function linkToDiagrams(nodes: VsmNode[], diagrams: { id: string; name: string }[]): void {
  for (const node of nodes) {
    if (node.type !== 'system1') continue;
    const target = diagrams.find(
      (diagram) =>
        diagram.name.toLowerCase().includes(node.name.toLowerCase()) ||
        node.name.toLowerCase().includes(diagram.name.replace(/\s*\(sub-process\)$/, '').toLowerCase()),
    );
    if (target) node.linkedDiagramId = target.id;
  }
}

function reuseVsmIds(fresh: VsmNode[], current: VsmNode[]): VsmNode[] {
  const taken = new Set<string>();
  return fresh.map((node) => {
    const match = current.find(
      (candidate) =>
        !taken.has(candidate.id) &&
        candidate.type === node.type &&
        (candidate.name.toLowerCase() === node.name.toLowerCase() ||
          candidate.sourceText === node.sourceText ||
          // Only one of each management system can exist, so type alone matches.
          node.type !== 'system1'),
    );
    if (!match) return node;
    taken.add(match.id);
    return {
      ...node,
      id: match.id,
      // Keep where it was dragged to; layoutVsm only places unplaced nodes.
      x: match.x,
      y: match.y,
      width: match.width,
      height: match.height,
      linkedDiagramId: node.linkedDiagramId ?? match.linkedDiagramId,
    };
  });
}

/**
 * Beer's canonical wiring. Derived from which systems are present rather than
 * from the prose, because the channels are a property of the model, not of how
 * someone happened to describe it.
 */
function wireChannels(nodes: VsmNode[], current: VsmEdge[]): VsmEdge[] {
  const first = (type: VsmNodeType) => nodes.find((node) => node.type === type);
  const ones = nodes.filter((node) => node.type === 'system1');
  const edges: VsmEdge[] = [];

  const link = (
    source: VsmNode | undefined,
    target: VsmNode | undefined,
    channel: VsmChannelType,
    name?: string,
  ) => {
    if (!source || !target || source.id === target.id) return;
    const previous = current.find(
      (edge) => edge.source === source.id && edge.target === target.id && edge.channel === channel,
    );
    edges.push({
      id: previous?.id ?? vsmEdgeId(),
      source: source.id,
      target: target.id,
      channel,
      name: name ?? previous?.name,
    });
  };

  const five = first('system5');
  const four = first('system4');
  const three = first('system3');
  const star = first('system3star');
  const two = first('system2');
  const env = first('environment');

  link(five, four, 'command');
  link(four, three, 'command');
  for (const one of ones) {
    link(three, one, 'command');
    link(two, one, 'coordination');
    link(star, one, 'audit');
    link(one, env, 'operational');
  }
  link(env, four, 'environmental');
  if (ones[0]) link(ones[0], five, 'algedonic', 'something is badly wrong');

  return edges;
}

// ------------------------------------------------------------------ render

const SENTENCE: Record<VsmNodeType, (name: string) => string> = {
  environment: (name) => `${name} are the world this organisation sits in.`,
  system1: (name) => `${name} does the primary work.`,
  system2: (name) => `${name} keeps the operating units from tripping over each other.`,
  system3: (name) =>
    `${name} allocates resources across the operating units and holds them to their commitments.`,
  system3star: (name) => `${name} inspects the operations directly, outside the normal reporting.`,
  system4: (name) =>
    `${name} watches the outside world and plans what the organisation becomes next.`,
  system5: (name) =>
    `${name} sets what the organisation is for, and settles it when running well now and changing for later pull against each other.`,
};

export function renderVsm(nodes: VsmNode[], edges: VsmEdge[]): string {
  void edges;
  if (!nodes.length) return '';

  const lines: string[] = [];
  const order: VsmNodeType[] = [
    'environment',
    'system1',
    'system2',
    'system3',
    'system3star',
    'system4',
    'system5',
  ];

  for (const type of order) {
    const group = nodes.filter((node) => node.type === type);
    if (!group.length) continue;

    if (type === 'system1') {
      // Several units read far better as one sentence than as one line each.
      const names = group.map((node) => node.name);
      const joined =
        names.length === 1
          ? names[0]
          : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      const reused = group.length === 1 ? keepIfStillTrue(group[0]) : null;
      lines.push(
        reused ??
          `${joined} ${names.length === 1 ? 'is the operating unit' : 'are the operating units'}.`,
      );
      for (const node of group) {
        if (node.note) lines.push(`  ${node.name}: ${node.note}`);
      }
      continue;
    }

    for (const node of group) {
      lines.push(keepIfStillTrue(node) ?? SENTENCE[type](node.name));
      if (node.note) lines.push(`  ${node.note}`);
    }
  }

  return lines.join('\n');
}

/** Reuse the author's own sentence while it still describes this element. */
function keepIfStillTrue(node: VsmNode): string | null {
  const original = (node.sourceText ?? '').replace(MARKER, '').trim();
  if (!original) return null;
  return original.toLowerCase().includes(node.name.toLowerCase().split(/\s+/)[0] ?? '')
    ? original
    : null;
}
