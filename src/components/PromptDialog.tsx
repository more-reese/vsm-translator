import { useEffect, useRef, useState } from 'react';

export interface PromptDialogProps {
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
  placeholder?: string;
  onSubmit(value: string): void;
  onCancel(): void;
}

/**
 * Electron does not implement `window.prompt` — it returns without showing
 * anything, which is why the New Project button appeared to do nothing at all.
 * This is the in-app replacement, and it works identically in browser mode.
 */
export function PromptDialog({
  title,
  label,
  initialValue = '',
  confirmLabel = 'Create',
  placeholder,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal modal-narrow"
        role="dialog"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <header className="modal-header">
          <h2>{title}</h2>
        </header>

        <div className="modal-body">
          <label className="field">
            <span>{label}</span>
            <input
              ref={inputRef}
              value={value}
              placeholder={placeholder}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') onCancel();
              }}
            />
          </label>
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </footer>
      </form>
    </div>
  );
}
