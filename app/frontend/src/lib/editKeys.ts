import type { KeyboardEvent } from "react";

export interface EditKeyOptions {
  onSave: () => void;
  onCancel: () => void;
  multiline?: boolean;
}

/**
 * Creates a keyboard event handler for inline editing.
 *
 * Single-line (default): Enter saves, Escape cancels.
 * Multi-line: Ctrl/Cmd+Enter saves, plain Enter is newline, Escape cancels.
 */
export function editKeyHandler({ onSave, onCancel, multiline = false }: EditKeyOptions) {
  return (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === "Enter") {
      if (multiline) {
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          onSave();
        }
        // Plain Enter: no-op (natural newline)
      } else {
        e.preventDefault();
        onSave();
      }
    }
  };
}
