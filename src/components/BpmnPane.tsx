/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import { is } from 'bpmn-js/lib/util/ModelUtil';
import { toBpmnXml } from '../model/bpmnXml';
import { readModeler, type ReadResult } from '../lib/bpmnRead';
import { subsetContextPadModule, subsetPaletteModule } from './bpmn/customModules';
import type { ProcessDiagram } from '../model/types';

export interface BpmnPaneProps {
  diagram: ProcessDiagram;
  /** Changing this string forces a re-import from the model. */
  importToken: string;
  readOnly: boolean;
  highlightIds: string[];
  onModelChange(model: ReadResult): void;
  onHoverElement(id: string | null, point: { x: number; y: number } | null): void;
  onSelectElement(id: string | null): void;
  onDrillIn(nodeId: string): void;
  onExpandToSubProcess(nodeId: string): void;
}

export function BpmnPane({
  diagram,
  importToken,
  readOnly,
  highlightIds,
  onModelChange,
  onHoverElement,
  onSelectElement,
  onDrillIn,
  onExpandToSubProcess,
}: BpmnPaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const modelerRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const markedRef = useRef<string[]>([]);

  /**
   * Imports are serialised through this chain. bpmn-js clears the canvas at the
   * start of importXML, so two overlapping imports race each other into the same
   * element registry — which surfaces as "element <X_plane> already exists" once
   * a collapsed sub-process is involved, because its drilldown plane gets added
   * twice.
   */
  const importChain = useRef<Promise<void>>(Promise.resolve());
  const disposedRef = useRef(false);
  /** True while importing, so bpmn-js's own change events aren't read as edits. */
  const importingRef = useRef(false);

  // Callbacks change on every render; keep them in refs so the modeler is built
  // exactly once rather than torn down and rebuilt.
  const handlers = useRef({
    onModelChange,
    onHoverElement,
    onSelectElement,
    onDrillIn,
    onExpandToSubProcess,
  });
  handlers.current = {
    onModelChange,
    onHoverElement,
    onSelectElement,
    onDrillIn,
    onExpandToSubProcess,
  };

  const modelRef = useRef(diagram);
  modelRef.current = diagram;

  useEffect(() => {
    if (!containerRef.current) return;
    disposedRef.current = false;

    const modeler = new BpmnModeler({
      container: containerRef.current,
      additionalModules: [subsetPaletteModule, subsetContextPadModule],
      keyboard: { bindTo: document },
    });
    modelerRef.current = modeler;

    const eventBus: any = modeler.get('eventBus');

    eventBus.on('commandStack.changed', () => {
      // Importing raises the same event as editing. Reporting it as a change
      // marks a freshly-opened diagram dirty and offers a pointless Commit.
      if (importingRef.current || disposedRef.current) return;
      const current = modelRef.current;
      handlers.current.onModelChange(readModeler(modeler, current.nodes, current.edges));
    });

    eventBus.on('element.hover', (event: any) => {
      const id = event.element?.id;
      const original = event.originalEvent as MouseEvent | undefined;
      handlers.current.onHoverElement(
        id && id !== '__implicitroot' ? id : null,
        original ? { x: original.clientX, y: original.clientY } : null,
      );
    });
    eventBus.on('element.out', () => handlers.current.onHoverElement(null, null));

    eventBus.on('selection.changed', (event: any) => {
      const selected = event.newSelection?.[0];
      handlers.current.onSelectElement(selected?.id ?? null);
    });

    // Double-clicking a sub-process drills in rather than starting a label edit.
    eventBus.on('element.dblclick', 2000, (event: any) => {
      if (is(event.element, 'bpmn:SubProcess')) {
        handlers.current.onDrillIn(event.element.id);
        return false;
      }
      return undefined;
    });

    eventBus.on('translator.drillIn', (event: any) => handlers.current.onDrillIn(event.element.id));
    eventBus.on('translator.expandToSubProcess', (event: any) =>
      handlers.current.onExpandToSubProcess(event.element.id),
    );

    return () => {
      disposedRef.current = true;
      modeler.destroy();
      modelerRef.current = null;
    };
  }, []);

  // Keep the canvas sized to its container. Without this a pane that was hidden
  // (VSM mode) comes back with the diagram fitted to stale dimensions.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const modeler = modelerRef.current;
      if (!modeler || disposedRef.current) return;
      try {
        modeler.get('canvas').resized();
      } catch {
        // Nothing imported yet.
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Import whenever the parent says the underlying model changed.
  useEffect(() => {
    let cancelled = false;
    const xml = toBpmnXml(diagram);

    importChain.current = importChain.current
      .catch(() => undefined)
      .then(async () => {
        if (cancelled || disposedRef.current) return;
        const modeler = modelerRef.current;
        if (!modeler) return;

        importingRef.current = true;
        try {
          await modeler.importXML(xml);
          if (cancelled || disposedRef.current) return;
          setError(null);
          fitViewport(modeler);
          markedRef.current = [];
        } catch (importError) {
          if (cancelled || disposedRef.current) return;
          setError(importError instanceof Error ? importError.message : String(importError));
        } finally {
          importingRef.current = false;
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importToken]);

  // Highlighting drives both the conflict dialog and the history diff view.
  useEffect(() => {
    const modeler = modelerRef.current;
    if (!modeler || disposedRef.current) return;
    let canvas: any;
    let registry: any;
    try {
      canvas = modeler.get('canvas');
      registry = modeler.get('elementRegistry');
    } catch {
      return;
    }

    for (const id of markedRef.current) {
      if (registry.get(id)) canvas.removeMarker(id, 'translator-highlight');
    }
    const next = highlightIds.filter((id) => registry.get(id));
    for (const id of next) canvas.addMarker(id, 'translator-highlight');
    markedRef.current = next;
  }, [highlightIds, importToken]);

  return (
    <div className="pane pane-diagram">
      <div className="pane-body">
        <div ref={containerRef} className="bpmn-canvas" />
        {readOnly && <div className="canvas-lock" title="Viewing history — return to latest to edit" />}
        {error && (
          <div className="canvas-error">
            <strong>Could not render this diagram.</strong>
            <span>{error}</span>
          </div>
        )}
        {!diagram.nodes.length && !error && (
          <div className="canvas-empty">
            <p>Nothing here yet.</p>
            <p className="muted">
              Write the steps on the left and press <kbd>⌘</kbd>
              <kbd>↵</kbd>, or draw straight onto the canvas with the palette.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Fit after the browser has actually laid the container out. Fitting immediately
 * after import measures whatever size the pane had a moment ago — which, when
 * returning from VSM mode, is nothing, leaving the diagram microscopic.
 */
function fitViewport(modeler: any): void {
  const apply = () => {
    try {
      const canvas = modeler.get('canvas');
      canvas.resized();
      canvas.zoom('fit-viewport', 'auto');
    } catch {
      // Modeler went away between frames.
    }
  };
  apply();
  requestAnimationFrame(apply);
}
