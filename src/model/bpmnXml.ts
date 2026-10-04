import type { Point, ProcessDiagram, ProcessEdge, ProcessNode } from './types';
import { SIZES } from './layout';

/**
 * Model → BPMN 2.0 XML (semantics + BPMNDI layout).
 *
 * bpmn-js imports this, so what you see on the canvas is a real BPMN document
 * rather than a bespoke rendering. Wiring up "Export .bpmn" later is a matter of
 * writing this string to a file — the semantics are already correct — which is
 * why the model was kept notation-shaped rather than view-shaped.
 */

const ELEMENT_TAG: Record<ProcessNode['type'], string> = {
  startEvent: 'bpmn:startEvent',
  endEvent: 'bpmn:endEvent',
  task: 'bpmn:task',
  subProcess: 'bpmn:subProcess',
  exclusiveGateway: 'bpmn:exclusiveGateway',
  parallelGateway: 'bpmn:parallelGateway',
};

export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function size(node: ProcessNode) {
  const fallback = SIZES[node.type] ?? SIZES.task;
  return {
    x: node.x ?? 160,
    y: node.y ?? 160,
    width: node.width ?? fallback.width,
    height: node.height ?? fallback.height,
  };
}

/** Simple orthogonal route: leave the source's right edge, enter the target's left. */
function routeEdge(edge: ProcessEdge, byId: Map<string, ProcessNode>): Point[] {
  if (edge.waypoints?.length && edge.waypoints.length >= 2) return edge.waypoints;

  const source = byId.get(edge.source);
  const target = byId.get(edge.target);
  if (!source || !target) return [];

  const s = size(source);
  const t = size(target);
  const sy = Math.round(s.y + s.height / 2);
  const ty = Math.round(t.y + t.height / 2);

  // Target is to the right: exit right, enter left.
  if (t.x >= s.x + s.width) {
    const sx = Math.round(s.x + s.width);
    const tx = Math.round(t.x);
    if (sy === ty) return [{ x: sx, y: sy }, { x: tx, y: ty }];
    const mid = Math.round((sx + tx) / 2);
    return [
      { x: sx, y: sy },
      { x: mid, y: sy },
      { x: mid, y: ty },
      { x: tx, y: ty },
    ];
  }

  // Loop back: drop below both boxes and run right-to-left.
  const below = Math.round(Math.max(s.y + s.height, t.y + t.height) + 40);
  return [
    { x: Math.round(s.x + s.width / 2), y: Math.round(s.y + s.height) },
    { x: Math.round(s.x + s.width / 2), y: below },
    { x: Math.round(t.x + t.width / 2), y: below },
    { x: Math.round(t.x + t.width / 2), y: Math.round(t.y + t.height) },
  ];
}

export function toBpmnXml(diagram: ProcessDiagram): string {
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const validEdges = diagram.edges.filter((e) => byId.has(e.source) && byId.has(e.target));

  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const e of validEdges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push(e.id);
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push(e.id);
  }

  const elements = diagram.nodes
    .map((node) => {
      const tag = ELEMENT_TAG[node.type] ?? 'bpmn:task';
      const refs = [
        ...(incoming.get(node.id) ?? []).map((id) => `      <bpmn:incoming>${esc(id)}</bpmn:incoming>`),
        ...(outgoing.get(node.id) ?? []).map((id) => `      <bpmn:outgoing>${esc(id)}</bpmn:outgoing>`),
      ].join('\n');
      const attrs = `id="${esc(node.id)}" name="${esc(node.name ?? '')}"`;
      return refs
        ? `    <${tag} ${attrs}>\n${refs}\n    </${tag}>`
        : `    <${tag} ${attrs} />`;
    })
    .join('\n');

  const flows = validEdges
    .map(
      (e) =>
        `    <bpmn:sequenceFlow id="${esc(e.id)}" sourceRef="${esc(e.source)}" targetRef="${esc(
          e.target,
        )}"${e.name ? ` name="${esc(e.name)}"` : ''} />`,
    )
    .join('\n');

  const shapes = diagram.nodes
    .map((node) => {
      const s = size(node);
      // A subProcess drawn collapsed is how "drill in" reads on the canvas: one
      // box with a + marker, whose internals live in their own diagram.
      const expanded = node.type === 'subProcess' ? ' isExpanded="false"' : '';
      const label =
        node.type === 'startEvent' || node.type === 'endEvent' || node.type.endsWith('Gateway')
          ? `\n        <bpmndi:BPMNLabel>\n          <dc:Bounds x="${Math.round(
              s.x + s.width / 2 - 45,
            )}" y="${Math.round(s.y + s.height + 6)}" width="90" height="27" />\n        </bpmndi:BPMNLabel>`
          : '';
      return `      <bpmndi:BPMNShape id="${esc(node.id)}_di" bpmnElement="${esc(
        node.id,
      )}"${expanded}>\n        <dc:Bounds x="${s.x}" y="${s.y}" width="${s.width}" height="${
        s.height
      }" />${label}\n      </bpmndi:BPMNShape>`;
    })
    .join('\n');

  const edgeShapes = validEdges
    .map((e) => {
      const points = routeEdge(e, byId);
      if (points.length < 2) return '';
      const waypoints = points
        .map((p) => `        <di:waypoint x="${Math.round(p.x)}" y="${Math.round(p.y)}" />`)
        .join('\n');
      return `      <bpmndi:BPMNEdge id="${esc(e.id)}_di" bpmnElement="${esc(
        e.id,
      )}">\n${waypoints}\n      </bpmndi:BPMNEdge>`;
    })
    .filter(Boolean)
    .join('\n');

  const processId = `Process_${diagram.id.replace(/[^A-Za-z0-9_-]/g, '')}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_${esc(diagram.id)}"
                  targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="${esc(processId)}" name="${esc(diagram.name)}" isExecutable="false">
${elements}
${flows}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${esc(processId)}">
${shapes}
${edgeShapes}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}

/** An empty but valid document, used for a brand-new diagram. */
export function emptyProcess(name: string): { nodes: ProcessNode[]; edges: ProcessEdge[] } {
  return { nodes: [], edges: [] };
}
