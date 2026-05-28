import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';

interface CreateItemDialogProps {
  open: boolean;
  /** Dialog title, e.g., "New File" / "New Folder". */
  title: string;
  /** Placeholder text for the input. */
  placeholder?: string;
  /** Parent directory absolute path — shown as muted hint above the input. */
  parentHint?: string;
  /** Pre-filled value (e.g., default file extension). */
  defaultValue?: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

// Disallowed on Windows + POSIX. We forbid path separators outright so users
// can't accidentally create nested paths from the dialog (they should right-
// click the parent folder instead).
const INVALID_RE = /[\\/:*?"<>|]/;

export const CreateItemDialog: React.FC<CreateItemDialogProps> = ({
  open,
  title,
  placeholder,
  parentHint,
  defaultValue = '',
  onConfirm,
  onCancel,
}) => {
  const [draft, setDraft] = React.useState(defaultValue);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (open) {
      setDraft(defaultValue);
      setTimeout(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        // If a default extension was supplied (e.g., ".md"), select the
        // stem so users can type their name without nuking the extension.
        const idx = defaultValue.lastIndexOf('.');
        if (idx > 0) el.setSelectionRange(0, idx);
        else el.select();
      }, 0);
    }
  }, [open, defaultValue]);

  const trimmed = draft.trim();
  const invalid =
    !trimmed ||
    trimmed === '.' ||
    trimmed === '..' ||
    INVALID_RE.test(trimmed);

  const submit = () => {
    if (invalid) return;
    onConfirm(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-2">
          {parentHint && (
            <div className="text-[11px] text-gray-500 truncate" title={parentHint}>
              Location: {parentHint}
            </div>
          )}
          <input
            ref={inputRef}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit(); }
              else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
            }}
            placeholder={placeholder}
          />
          {draft.length > 0 && INVALID_RE.test(trimmed) && (
            <div className="text-xs text-amber-600">
              Name cannot contain these characters: \ / : * ? " &lt; &gt; |
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={submit} disabled={invalid}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
