/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ProcessEdge, ProcessNode, ProcessNodeType } from '../model/types';

/**
 * Read the canvas back into the model. Provenance (sourceText / sourceLines) and
 * child-diagram links are not on the canvas, so they are carried over from the
 * previous model by id — which is also why translation is asked so firmly to
 * reuse ids.
 */

function toNodeType(element: any): ProcessNodeType | null {
  const type: string = element.type ?? '';
  switch (type) {
    case 'bpmn:StartEvent':
      return 'startEvent';
    case 'bpmn:EndEvent':
      return 'endEvent';
    case 'bpmn:SubProcess':
    case 'bpmn:CallActivity':
      return 'subProcess';
    case 'bpmn:ExclusiveGateway':
      return 'exclusiveGateway';
    case 'bpmn:ParallelGateway':
      return 'parallelGateway';
    default:
      break;
  }
  // Anything else the toolkit can produce is folded into the nearest supported
  // element rather than silently dropped.
  if (type.endsWith('Task') || type === 'bpmn:Activity') return 'task';
  if (type.endsWith('Gateway')) return 'exclusiveGateway';
  if (type.endsWith('Event')) return 'endEvent';
  return null;
}

export interface ReadResult {
  nodes: ProcessNode[];
  edges: ProcessEdge[];
}

export function readModeler(modeler: any, previous: ProcessNode[], previousEdges: ProcessEdge[]): ReadResult {
  const registry = modeler.get('elementRegistry');
  const prevNodes = new Map(previous.map((n) => [n.id, n]));
  const prevEdges = new Map(previousEdges.map((e) => [e.id, e]));

  const nodes: ProcessNode[] = [];
  const edges: ProcessEdge[] = [];

  for (const element of registry.getAll()) {
    if (element.type === 'label') continue;
    if (element.type === 'bpmn:Process' || element.type === 'bpmn:Collaboration') continue;

    if (element.waypoints) {
      if (element.type !== 'bpmn:SequenceFlow') continue;
      const before = prevEdges.get(element.id);
      edges.push({
        id: element.id,
        source: element.source?.id,
        target: element.target?.id,
        name: element.businessObject?.name?.trim() || undefined,
        sourceText: before?.sourceText,
        sourceLines: before?.sourceLines,
        waypoints: element.waypoints.map((p: any) => ({ x: Math.round(p.x), y: Math.round(p.y) })),
      });
      continue;
    }

    const type = toNodeType(element);
    if (!type) continue;
    const before = prevNodes.get(element.id);
    nodes.push({
      id: element.id,
      type,
      name: element.businessObject?.name?.trim() || '',
      actor: before?.actor,
      note: before?.note,
      sourceText: before?.sourceText,
      sourceLines: before?.sourceLines,
      x: Math.round(element.x),
      y: Math.round(element.y),
      width: Math.round(element.width),
      height: Math.round(element.height),
      // A box that was already drilled into keeps pointing at its child diagram.
      childDiagramId: type === 'subProcess' ? before?.childDiagramId : undefined,
    });
  }

  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    edges: edges.filter((e) => e.source && e.target && ids.has(e.source) && ids.has(e.target)),
  };
}

/** Ignore geometry: this is what decides whether a commit needs translating. */
export function structuralKey(nodes: ProcessNode[], edges: ProcessEdge[]): string {
  const n = [...nodes]
    .map((x) => [x.id, x.type, (x.name ?? '').trim(), x.actor ?? '', x.childDiagramId ?? ''].join('|'))
    .sort();
  const e = [...edges]
    .map((x) => [x.id, x.source, x.target, (x.name ?? '').trim()].join('|'))
    .sort();
  return JSON.stringify([n, e]);
}

/** Geometry only, so pure repositioning can still be saved without a translation. */
export function geometryKey(nodes: ProcessNode[], edges: ProcessEdge[]): string {
  const n = [...nodes].map((x) => `${x.id}:${x.x},${x.y},${x.width},${x.height}`).sort();
  const e = [...edges]
    .map((x) => `${x.id}:${(x.waypoints ?? []).map((p) => `${p.x},${p.y}`).join(' ')}`)
    .sort();
  return JSON.stringify([n, e]);
}
