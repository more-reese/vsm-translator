/**
 * Core data model.
 *
 * Deliberately notation-agnostic in shape: a ProcessDiagram is a plain graph of
 * nodes + edges with optional geometry. bpmn-js is a *view* over this model, not
 * the model itself, which is what keeps standards-compliant .bpmn XML export a
 * near-term addition rather than a rewrite (see src/model/bpmnXml.ts, which
 * already emits BPMN 2.0 + BPMNDI for the subset we support).
 */

// ---------------------------------------------------------------------------
// Process (BPMN) side
// ---------------------------------------------------------------------------

/** The MVP BPMN 2.0 subset. Extend here first when widening scope. */
export type ProcessNodeType =
  | 'startEvent'
  | 'endEvent'
  | 'task'
  | 'subProcess'
  | 'exclusiveGateway'
  | 'parallelGateway';

export interface Point {
  x: number;
  y: number;
}

export interface ProcessNode {
  id: string;
  type: ProcessNodeType;
  name: string;
  /** Optional performer, captured from "@Actor" style hints in the text. */
  actor?: string;
  /** Plain-language note surfaced on hover. */
  note?: string;
  /** The exact text this element was generated from (hover context). */
  sourceText?: string;
  /** 1-indexed, inclusive line range in the owning diagram's committed text. */
  sourceLines?: [number, number];
  /** Geometry. Absent means "needs layout". */
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** subProcess only: id of the ProcessDiagram this box drills into. */
  childDiagramId?: string;
}

export interface ProcessEdge {
  id: string;
  source: string;
  target: string;
  /** Condition label, e.g. "yes" / "billing issue". */
  name?: string;
  sourceText?: string;
  sourceLines?: [number, number];
  waypoints?: Point[];
}

export interface ProcessDiagram {
  id: string;
  name: string;
  /** Set on child diagrams: which diagram/node this one hangs off. */
  parentDiagramId?: string;
  parentNodeId?: string;
  /** The last committed text for THIS level (drill-down gives each level its own). */
  text: string;
  nodes: ProcessNode[];
  edges: ProcessEdge[];
}

// ---------------------------------------------------------------------------
// VSM side
// ---------------------------------------------------------------------------

export type VsmNodeType =
  | 'system1'
  | 'system2'
  | 'system3'
  | 'system3star'
  | 'system4'
  | 'system5'
  | 'environment';

/** Beer's named channels. Rendered with distinct stroke treatments. */
export type VsmChannelType =
  | 'command'
  | 'coordination'
  | 'audit'
  | 'algedonic'
  | 'operational'
  | 'environmental';

export interface VsmNode {
  id: string;
  type: VsmNodeType;
  name: string;
  /** Free-text description surfaced on hover, below the concept explainer. */
  note?: string;
  sourceText?: string;
  sourceLines?: [number, number];
  x: number;
  y: number;
  width: number;
  height: number;
  /** Recursion level; 0 is the system in focus, 1 is a contained viable system. */
  recursionLevel?: number;
  /** system1 only: the ProcessDiagram that runs inside this unit. */
  linkedDiagramId?: string;
}

export interface VsmEdge {
  id: string;
  source: string;
  target: string;
  channel: VsmChannelType;
  name?: string;
  sourceText?: string;
  sourceLines?: [number, number];
}

export interface VsmDiagram {
  id: string;
  name: string;
  text: string;
  nodes: VsmNode[];
  edges: VsmEdge[];
}

// ---------------------------------------------------------------------------
// Project + history
// ---------------------------------------------------------------------------

export type Mode = 'process' | 'vsm';

export type CommitDirection =
  | 'init'
  | 'text->diagram'
  | 'diagram->text'
  | 'merge'
  | 'restore'
  | 'structural';

export interface ChangeRecord {
  kind: 'added' | 'removed' | 'changed' | 'moved';
  target: 'node' | 'edge' | 'text';
  /** Element id, or diagram id for text changes. */
  id: string;
  label: string;
  detail?: string;
}

/**
 * A committed state. We snapshot the whole content rather than storing deltas:
 * projects are small, and a full snapshot is trivially inspectable by hand in the
 * JSON file, which matters more here than storage efficiency.
 */
export interface Commit {
  id: string;
  timestamp: string;
  summary: string;
  direction: CommitDirection;
  mode: Mode;
  /** Which diagram the user was looking at, so Restore returns you there. */
  focusDiagramId: string;
  changes: ChangeRecord[];
  snapshot: ProjectContent;
}

export interface ProjectContent {
  rootDiagramId: string;
  diagrams: Record<string, ProcessDiagram>;
  vsm: VsmDiagram;
}

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  content: ProjectContent;
  history: Commit[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

export type ConflictSide = 'text' | 'diagram';

export interface ConflictOption {
  side: ConflictSide;
  /** Human-readable rendering of what this side says. */
  description: string;
  /** Present when this side still has the element. */
  present: boolean;
}

export interface Conflict {
  id: string;
  /** Element the conflict concerns; used to drive highlighting in both panes. */
  elementId: string;
  elementKind: 'node' | 'edge';
  title: string;
  /** e.g. "renamed", "added", "removed", "rewired". */
  category: string;
  text: ConflictOption;
  diagram: ConflictOption;
  /** Lines to highlight in the text pane while this row is active. */
  textLines?: [number, number];
  /** Default the app suggests. */
  suggested: ConflictSide;
}

export interface ConflictResolution {
  conflictId: string;
  choice: ConflictSide | 'instruction';
  /** Free-text steer, applied when choice === 'instruction' or alongside a side. */
  instruction?: string;
}

// ---------------------------------------------------------------------------
// Translation adapter surface
// ---------------------------------------------------------------------------

/**
 * Everything the app needs from a translator. Implemented today by the Anthropic
 * adapter; a local-model adapter only has to satisfy this interface.
 */
export interface TranslationProvider {
  readonly id: string;
  readonly label: string;
  /** One line for the Settings dropdown. */
  readonly blurb: string;
  /** False for anything that reaches the network. */
  readonly offline: boolean;
  /** True only for providers that need an Anthropic API key. */
  readonly needsApiKey: boolean;
  /**
   * Whether free-text steers in the conflict dialog mean anything here. The
   * rule-based provider has no way to honour "call it the QA gate instead", so
   * the UI hides that box rather than silently ignoring what you typed.
   */
  readonly supportsInstructions: boolean;
  isConfigured(): boolean;
  test(): Promise<{ ok: boolean; message: string }>;

  textToProcess(input: TextToProcessInput): Promise<ProcessTranslation>;
  processToText(input: ProcessToTextInput): Promise<string>;
  textToVsm(input: TextToVsmInput): Promise<VsmTranslation>;
  vsmToText(input: VsmToTextInput): Promise<string>;
  mergeProcess(input: MergeProcessInput): Promise<MergedProcess>;
}

/** A merge produces both sides at once, so neither is a re-derivation of the other. */
export interface MergedProcess extends ProcessTranslation {
  text: string;
  /** One line per conflict, describing how it was settled. */
  notes: string[];
}

export interface TextToProcessInput {
  text: string;
  /** Current model, so ids (and therefore layout) survive a text re-commit. */
  current: { nodes: ProcessNode[]; edges: ProcessEdge[] };
  diagramName: string;
}

export interface ProcessTranslation {
  nodes: ProcessNode[];
  edges: ProcessEdge[];
  /** Nodes the model flagged as deserving their own sub-diagram. */
  suggestedSubProcesses?: string[];
}

export interface ProcessToTextInput {
  nodes: ProcessNode[];
  edges: ProcessEdge[];
  diagramName: string;
  previousText: string;
}

export interface TextToVsmInput {
  text: string;
  current: { nodes: VsmNode[]; edges: VsmEdge[] };
  /** Process diagrams available to link a System 1 to. */
  availableDiagrams: { id: string; name: string }[];
}

export interface VsmTranslation {
  nodes: VsmNode[];
  edges: VsmEdge[];
}

export interface VsmToTextInput {
  nodes: VsmNode[];
  edges: VsmEdge[];
  previousText: string;
}

export interface MergeProcessInput {
  diagramName: string;
  baseText: string;
  editedText: string;
  /** The model at the last commit — the common ancestor of both edited sides. */
  base: { nodes: ProcessNode[]; edges: ProcessEdge[] };
  fromText: { nodes: ProcessNode[]; edges: ProcessEdge[] };
  fromDiagram: { nodes: ProcessNode[]; edges: ProcessEdge[] };
  conflicts: Conflict[];
  resolutions: ConflictResolution[];
  /** true when the user pressed "I'm Feeling Lucky". */
  auto: boolean;
}
