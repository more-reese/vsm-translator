import { useMemo, useRef, useState } from 'react';
import { VSM_SHORT_LABEL } from '../model/glossary';
import { vsmBounds } from '../model/layout';
import { vsmEdgeId, vsmNodeId } from '../model/ids';
import type { VsmChannelType, VsmDiagram, VsmEdge, VsmNode, VsmNodeType } from '../model/types';

export interface VsmPaneProps {
  diagram: VsmDiagram;
  readOnly: boolean;
  highlightIds: string[];
  availableDiagrams: { id: string; name: string }[];
  onChange(next: VsmDiagram): void;
  onHoverElement(id: string | null, point: { x: number; y: number } | null): void;
  onOpenLinkedDiagram(diagramId: string): void;
  onTidy(): void;
}

const PALETTE: { type: VsmNodeType; label: string; hint: string }[] = [
  { type: 'system1', label: 'S1', hint: 'Operational unit' },
  { type: 'system2', label: 'S2', hint: 'Coordination' },
  { type: 'system3', label: 'S3', hint: 'Control' },
  { type: 'system3star', label: 'S3*', hint: 'Audit' },
  { type: 'system4', label: 'S4', hint: 'Intelligence' },
  { type: 'system5', label: 'S5', hint: 'Policy' },
  { type: 'environment', label: 'Env', hint: 'Environment' },
];

const CHANNEL_LABELS: Record<VsmChannelType, string> = {
  command: 'Command',
  coordination: 'Coordination',
  audit: 'Audit',
  algedonic: 'Algedonic',
  operational: 'Operational',
  environmental: 'Environmental',
};

/** Beer's channels are semantically distinct, so they are visually distinct too. */
const CHANNEL_STYLE: Record<VsmChannelType, { stroke: string; dash?: string; width: number }> = {
  command: { stroke: '#41507a', width: 1.8 },
  coordination: { stroke: '#2f8f6b', dash: '7 4', width: 1.6 },
  audit: { stroke: '#b5720f', dash: '2 4', width: 1.6 },
  algedonic: { stroke: '#cc3b30', width: 2.6 },
  operational: { stroke: '#78829a', width: 1.5 },
  environmental: { stroke: '#4b7bd0', dash: '7 4', width: 1.5 },
};

function inferChannel(source: VsmNode, target: VsmNode): VsmChannelType {
  if (source.type === 'system3star' || target.type === 'system3star') return 'audit';
  if (source.type === 'system2' || target.type === 'system2') return 'coordination';
  if (source.type === 'system1' && target.type === 'system5') return 'algedonic';
  if (source.type === 'environment') return 'environmental';
  if (target.type === 'environment') return 'operational';
  if (source.type === 'system1' && target.type === 'system1') return 'operational';
  return 'command';
}

/** Clip a centre-to-centre line at the source box's border. */
function anchor(from: VsmNode, to: VsmNode): { x: number; y: number } {
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  const dx = to.x + to.width / 2 - cx;
  const dy = to.y + to.height / 2 - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const hw = from.width / 2 + 4;
  const hh = from.height / 2 + 4;
  const scale = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6));
  return { x: cx + dx * scale, y: cy + dy * scale };
}

export function VsmPane({
  diagram,
  readOnly,
  highlightIds,
  availableDiagrams,
  onChange,
  onHoverElement,
  onOpenLinkedDiagram,
  onTidy,
}: VsmPaneProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const byId = useMemo(() => new Map(diagram.nodes.map((n) => [n.id, n])), [diagram.nodes]);
  const bounds = vsmBounds(diagram.nodes, diagram.edges);
  const selected = selectedId ? byId.get(selectedId) : undefined;
  const highlighted = new Set(highlightIds);

  function svgPoint(event: React.MouseEvent): { x: number; y: number } {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function patch(next: Partial<VsmDiagram>): void {
    onChange({ ...diagram, ...next });
  }

  function updateNode(id: string, changes: Partial<VsmNode>): void {
    patch({ nodes: diagram.nodes.map((n) => (n.id === id ? { ...n, ...changes } : n)) });
  }

  function addNode(type: VsmNodeType): void {
    const count = diagram.nodes.filter((n) => n.type === type).length;
    const node: VsmNode = {
      id: vsmNodeId(),
      type,
      name: `${VSM_SHORT_LABEL[type]} ${count + 1}`,
      x: 60 + ((diagram.nodes.length * 40) % 320),
      y: 60 + ((diagram.nodes.length * 30) % 260),
      width: type === 'system2' ? 120 : 200,
      height: type === 'system2' ? 160 : 82,
      recursionLevel: type === 'system1' ? 1 : 0,
    };
    patch({ nodes: [...diagram.nodes, node] });
    setSelectedId(node.id);
  }

  function removeSelected(): void {
    if (!selectedId) return;
    patch({
      nodes: diagram.nodes.filter((n) => n.id !== selectedId),
      edges: diagram.edges.filter((e) => e.source !== selectedId && e.target !== selectedId),
    });
    setSelectedId(null);
  }

  function handleNodeClick(node: VsmNode): void {
    if (connecting) {
      if (!connectFrom) {
        setConnectFrom(node.id);
        return;
      }
      if (connectFrom === node.id) {
        setConnectFrom(null);
        return;
      }
      const source = byId.get(connectFrom);
      if (source) {
        const edge: VsmEdge = {
          id: vsmEdgeId(),
          source: source.id,
          target: node.id,
          channel: inferChannel(source, node),
        };
        patch({ edges: [...diagram.edges, edge] });
      }
      setConnectFrom(null);
      setConnecting(false);
      return;
    }
    setSelectedId(node.id);
  }

  function startDrag(event: React.MouseEvent, node: VsmNode): void {
    if (readOnly || connecting) return;
    event.stopPropagation();
    const point = svgPoint(event);
    dragRef.current = { id: node.id, dx: point.x - node.x, dy: point.y - node.y };
  }

  function handleMouseMove(event: React.MouseEvent): void {
    const drag = dragRef.current;
    if (!drag) return;
    const point = svgPoint(event);
    updateNode(drag.id, {
      x: Math.max(0, Math.round(point.x - drag.dx)),
      y: Math.max(0, Math.round(point.y - drag.dy)),
    });
  }

  return (
    <div className="pane pane-diagram">
      <div className="vsm-toolbar">
        <span className="toolbar-label">Add</span>
        {PALETTE.map((item) => (
          <button
            key={item.type}
            type="button"
            className="chip"
            disabled={readOnly}
            title={item.hint}
            onClick={() => addNode(item.type)}
          >
            {item.label}
          </button>
        ))}
        <span className="toolbar-divider" />
        <button
          type="button"
          className={`chip ${connecting ? 'chip-on' : ''}`}
          disabled={readOnly}
          onClick={() => {
            setConnecting((on) => !on);
            setConnectFrom(null);
          }}
          title="Click a source element, then a target"
        >
          {connecting ? (connectFrom ? 'Pick target…' : 'Pick source…') : 'Connect'}
        </button>
        <button type="button" className="chip" disabled={readOnly} onClick={onTidy}>
          Tidy
        </button>
        <button
          type="button"
          className="chip chip-danger"
          disabled={readOnly || !selectedId}
          onClick={removeSelected}
        >
          Delete
        </button>
      </div>

      <div className="vsm-scroll">
        <svg
          ref={svgRef}
          className={`vsm-canvas ${connecting ? 'is-connecting' : ''}`}
          width={bounds.width}
          height={bounds.height}
          onMouseMove={handleMouseMove}
          onMouseUp={() => {
            dragRef.current = null;
          }}
          onMouseLeave={() => {
            dragRef.current = null;
            onHoverElement(null, null);
          }}
          onClick={() => setSelectedId(null)}
        >
          <defs>
            {Object.entries(CHANNEL_STYLE).map(([channel, style]) => (
              <marker
                key={channel}
                id={`arrow-${channel}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={style.stroke} />
              </marker>
            ))}
          </defs>

          <g className="vsm-edges">
            {diagram.edges.map((edge) => {
              const source = byId.get(edge.source);
              const target = byId.get(edge.target);
              if (!source || !target) return null;
              const a = anchor(source, target);
              const b = anchor(target, source);
              const style = CHANNEL_STYLE[edge.channel] ?? CHANNEL_STYLE.command;
              const isHot = highlighted.has(edge.id);
              return (
                <g
                  key={edge.id}
                  className={`vsm-edge ${isHot ? 'is-highlighted' : ''}`}
                  onMouseEnter={(event) =>
                    onHoverElement(edge.id, { x: event.clientX, y: event.clientY })
                  }
                  onMouseLeave={() => onHoverElement(null, null)}
                >
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={style.stroke}
                    strokeWidth={isHot ? style.width + 1.6 : style.width}
                    strokeDasharray={style.dash}
                    markerEnd={`url(#arrow-${edge.channel})`}
                  />
                  {/* Invisible fat line so thin channels are still easy to hover. */}
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={12} />
                  {edge.name && (
                    <text
                      className="vsm-edge-label"
                      x={(a.x + b.x) / 2}
                      y={(a.y + b.y) / 2 - 6}
                      textAnchor="middle"
                    >
                      {edge.name}
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          <g className="vsm-nodes">
            {diagram.nodes.map((node) => {
              const isSelected = node.id === selectedId;
              const isHot = highlighted.has(node.id);
              const isConnectSource = node.id === connectFrom;
              return (
                <g
                  key={node.id}
                  className={`vsm-node type-${node.type} ${isSelected ? 'is-selected' : ''} ${
                    isHot ? 'is-highlighted' : ''
                  } ${isConnectSource ? 'is-connect-source' : ''}`}
                  onMouseDown={(event) => startDrag(event, node)}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleNodeClick(node);
                  }}
                  onMouseEnter={(event) =>
                    onHoverElement(node.id, { x: event.clientX, y: event.clientY })
                  }
                  onMouseLeave={() => onHoverElement(null, null)}
                  onDoubleClick={() => {
                    if (node.linkedDiagramId) onOpenLinkedDiagram(node.linkedDiagramId);
                  }}
                >
                  <rect
                    x={node.x}
                    y={node.y}
                    width={node.width}
                    height={node.height}
                    rx={node.type === 'environment' ? 28 : node.type === 'system1' ? 16 : 6}
                  />
                  <text className="vsm-badge" x={node.x + 10} y={node.y + 18}>
                    {VSM_SHORT_LABEL[node.type]}
                  </text>
                  <foreignObject
                    x={node.x + 8}
                    y={node.y + 22}
                    width={node.width - 16}
                    height={node.height - 30}
                  >
                    <div className="vsm-node-label">
                      {node.name}
                      {node.linkedDiagramId && <span className="vsm-link-badge">↳ process</span>}
                    </div>
                  </foreignObject>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {selected && (
        <div className="vsm-inspector">
          <label>
            <span>Name</span>
            <input
              value={selected.name}
              readOnly={readOnly}
              onChange={(event) => updateNode(selected.id, { name: event.target.value })}
            />
          </label>
          <label>
            <span>Note</span>
            <input
              value={selected.note ?? ''}
              readOnly={readOnly}
              placeholder="Shown on hover"
              onChange={(event) => updateNode(selected.id, { note: event.target.value })}
            />
          </label>
          {selected.type === 'system1' && (
            <label>
              <span>Runs process</span>
              <select
                value={selected.linkedDiagramId ?? ''}
                disabled={readOnly}
                onChange={(event) =>
                  updateNode(selected.id, { linkedDiagramId: event.target.value || undefined })
                }
              >
                <option value="">— not linked —</option>
                {availableDiagrams.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selected.linkedDiagramId && (
            <button
              type="button"
              className="chip"
              onClick={() => onOpenLinkedDiagram(selected.linkedDiagramId!)}
            >
              Open process ↗
            </button>
          )}
        </div>
      )}

      {!!diagram.edges.length && (
        <div className="vsm-legend">
          {(Object.keys(CHANNEL_STYLE) as VsmChannelType[])
            .filter((channel) => diagram.edges.some((e) => e.channel === channel))
            .map((channel) => (
              <span key={channel}>
                <svg width="26" height="10" aria-hidden="true">
                  <line
                    x1="1"
                    y1="5"
                    x2="25"
                    y2="5"
                    stroke={CHANNEL_STYLE[channel].stroke}
                    strokeWidth={CHANNEL_STYLE[channel].width}
                    strokeDasharray={CHANNEL_STYLE[channel].dash}
                  />
                </svg>
                {CHANNEL_LABELS[channel]}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
