import { useEffect } from 'react';
import type { Conflict, ConflictResolution, ConflictSide } from '../model/types';

export interface ConflictDialogProps {
  conflicts: Conflict[];
  resolutions: Record<string, ConflictResolution>;
  activeId: string | null;
  busy: boolean;
  /** VSM merges are applied locally, so the free-text steer is process-only. */
  allowInstructions: boolean;
  onActivate(conflictId: string): void;
  onChange(conflictId: string, patch: Partial<ConflictResolution>): void;
  onResolve(): void;
  onLucky(): void;
  onCancel(): void;
}

const SIDE_LABEL: Record<ConflictSide, string> = { text: 'Keep text', diagram: 'Keep diagram' };

export function ConflictDialog({
  conflicts,
  resolutions,
  activeId,
  busy,
  allowInstructions,
  onActivate,
  onChange,
  onResolve,
  onLucky,
  onCancel,
}: ConflictDialogProps) {
  // Hovering a row highlights it in both panes, so activate the first one on open.
  useEffect(() => {
    if (!activeId && conflicts.length) onActivate(conflicts[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflicts]);

  return (
    <div className="modal-backdrop">
      <div className="modal modal-wide" role="dialog" aria-label="Resolve conflicts">
        <header className="modal-header">
          <div>
            <h2>You changed both sides</h2>
            <p className="muted">
              {conflicts.length} disagreement{conflicts.length === 1 ? '' : 's'} between what you
              wrote and what you drew. Everything you changed on only one side is already merged and
              is not listed here. Hover or select a row to see it highlighted in both panes.
            </p>
          </div>
          <button type="button" className="btn btn-lucky" onClick={onLucky} disabled={busy}>
            I’m Feeling Lucky
          </button>
        </header>

        <div className="conflict-list">
          {conflicts.map((conflict) => {
            const resolution = resolutions[conflict.id];
            const choice = resolution?.choice ?? conflict.suggested;
            const isActive = conflict.id === activeId;
            return (
              <div
                key={conflict.id}
                className={`conflict ${isActive ? 'is-active' : ''}`}
                onMouseEnter={() => onActivate(conflict.id)}
                onFocus={() => onActivate(conflict.id)}
              >
                <div className="conflict-head">
                  <strong>{conflict.title}</strong>
                  <span className="tag">{conflict.category}</span>
                </div>

                <div className="conflict-sides">
                  {(['text', 'diagram'] as ConflictSide[]).map((side) => (
                    <label
                      key={side}
                      className={`conflict-side side-${side} ${choice === side ? 'is-chosen' : ''}`}
                    >
                      <input
                        type="radio"
                        name={conflict.id}
                        checked={choice === side}
                        onChange={() => onChange(conflict.id, { choice: side })}
                      />
                      <span className="side-name">{SIDE_LABEL[side]}</span>
                      <span className="side-desc">{conflict[side].description}</span>
                    </label>
                  ))}
                </div>

                {allowInstructions && (
                  <label className="conflict-instruction">
                    <span>or tell me what you actually want</span>
                    <input
                      type="text"
                      placeholder="e.g. call it “QA gate” and put it after the split"
                      value={resolution?.instruction ?? ''}
                      onChange={(event) =>
                        onChange(conflict.id, {
                          instruction: event.target.value,
                          choice: event.target.value ? 'instruction' : conflict.suggested,
                        })
                      }
                    />
                  </label>
                )}
              </div>
            );
          })}
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onResolve} disabled={busy}>
            {busy ? 'Merging…' : 'Apply and commit'}
          </button>
        </footer>
      </div>
    </div>
  );
}
