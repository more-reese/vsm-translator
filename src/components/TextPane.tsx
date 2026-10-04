import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { insertListItem, renumber, type Edit } from '../lib/listNumbering';

export interface LineRange {
  from: number;
  to: number;
  tone?: 'soft' | 'active' | 'added' | 'removed';
}

export interface TextPaneProps {
  value: string;
  readOnly: boolean;
  placeholder?: string;
  highlights: LineRange[];
  onChange(value: string): void;
  onHoverLine(line: number | null, point: { x: number; y: number } | null): void;
}

/**
 * A plain textarea, with a hidden mirror rendered in identical typography used to
 * measure where each logical line actually sits after wrapping. That measurement
 * is what lets hover target a line, lets the gutter number wrapped lines
 * correctly, and lets highlight bands line up with the text they refer to —
 * without giving up ordinary textarea editing.
 */
export function TextPane({
  value,
  readOnly,
  placeholder,
  highlights,
  onChange,
  onHoverLine,
}: TextPaneProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const [rects, setRects] = useState<{ top: number; height: number }[]>([]);
  const [scrollTop, setScrollTop] = useState(0);
  /** Where to put the caret once the parent re-renders with the new value. */
  const pendingCaret = useRef<number | null>(null);

  const lines = value.split('\n');

  // The textarea is controlled, so a renumber round-trips through the parent.
  // Restore the caret after that render or it snaps to the end of the document.
  useLayoutEffect(() => {
    if (pendingCaret.current === null) return;
    const textarea = textareaRef.current;
    if (textarea) {
      const at = Math.min(pendingCaret.current, textarea.value.length);
      textarea.setSelectionRange(at, at);
    }
    pendingCaret.current = null;
  }, [value]);

  const applyEdit = (edit: Edit) => {
    pendingCaret.current = edit.caret;
    onChange(edit.text);
  };

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const raw = event.target.value;
    const caret = event.target.selectionStart ?? raw.length;
    const edit = renumber(raw, caret);
    if (edit.text === raw) onChange(raw);
    else applyEdit(edit);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ⌘↵ is Commit and ⇧↵ is a plain newline; neither continues the list.
    if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const textarea = event.currentTarget;
    const edit = insertListItem(textarea.value, textarea.selectionStart, textarea.selectionEnd);
    if (!edit) return;
    event.preventDefault();
    applyEdit(edit);
  };

  useLayoutEffect(() => {
    const mirror = mirrorRef.current;
    if (!mirror) return;
    const measured = Array.from(mirror.children).map((child) => {
      const el = child as HTMLElement;
      return { top: el.offsetTop, height: el.offsetHeight };
    });
    setRects(measured);
  }, [value]);

  // Re-measure when the pane is resized, since wrapping changes with width.
  useEffect(() => {
    const mirror = mirrorRef.current;
    if (!mirror || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const measured = Array.from(mirror.children).map((child) => {
        const el = child as HTMLElement;
        return { top: el.offsetTop, height: el.offsetHeight };
      });
      setRects(measured);
    });
    observer.observe(mirror);
    return () => observer.disconnect();
  }, []);

  const lineAt = useCallback(
    (clientY: number): number | null => {
      const textarea = textareaRef.current;
      if (!textarea || !rects.length) return null;
      const y = clientY - textarea.getBoundingClientRect().top + textarea.scrollTop;
      const index = rects.findIndex((r) => y >= r.top && y < r.top + r.height);
      return index === -1 ? null : index + 1;
    },
    [rects],
  );

  const handleMove = (event: React.MouseEvent) => {
    const line = lineAt(event.clientY);
    onHoverLine(line, line ? { x: event.clientX, y: event.clientY } : null);
  };

  const bands = highlights.flatMap((range) => {
    const out: { key: string; top: number; height: number; tone: string }[] = [];
    for (let line = range.from; line <= range.to; line += 1) {
      const rect = rects[line - 1];
      if (!rect) continue;
      out.push({
        key: `${range.tone ?? 'soft'}-${line}`,
        top: rect.top,
        height: rect.height,
        tone: range.tone ?? 'soft',
      });
    }
    return out;
  });

  return (
    <div className="text-editor">
      <div className="text-gutter" style={{ transform: `translateY(${-scrollTop}px)` }}>
        {rects.map((rect, index) => (
          <span key={index} style={{ top: rect.top, height: rect.height }}>
            {index + 1}
          </span>
        ))}
      </div>

      <div className="text-surface">
        <div className="text-bands" style={{ transform: `translateY(${-scrollTop}px)` }}>
          {bands.map((band) => (
            <div
              key={band.key}
              className={`text-band tone-${band.tone}`}
              style={{ top: band.top, height: band.height }}
            />
          ))}
        </div>

        <textarea
          ref={textareaRef}
          className="text-input"
          spellCheck={false}
          value={value}
          readOnly={readOnly}
          placeholder={placeholder}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onScroll={(event) => setScrollTop((event.target as HTMLTextAreaElement).scrollTop)}
          onMouseMove={handleMove}
          onMouseLeave={() => onHoverLine(null, null)}
        />

        {/* Hidden, but laid out identically to the textarea so it can be measured. */}
        <div ref={mirrorRef} className="text-mirror" aria-hidden="true">
          {lines.map((line, index) => (
            <div key={index}>{line === '' ? '​' : line}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
