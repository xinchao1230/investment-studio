import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';

interface RenameFileDialogProps {
  open: boolean;
  /** Original basename including extension. */
  originalName: string;
  /** Callback invoked with the new basename (may have a different extension). */
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}

function splitName(name: string): { stem: string; ext: string } {
  const idx = name.lastIndexOf('.');
  if (idx <= 0) return { stem: name, ext: '' };
  return { stem: name.slice(0, idx), ext: name.slice(idx) };
}

export const RenameFileDialog: React.FC<RenameFileDialogProps> = ({
  open,
  originalName,
  onConfirm,
  onCancel,
}) => {
  const [draft, setDraft] = React.useState(originalName);
  const [confirmingExtChange, setConfirmingExtChange] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (open) {
      setDraft(originalName);
      setConfirmingExtChange(false);
      // Focus & select stem (everything before the last dot) so users can
      // immediately type a new name without nuking the extension.
      setTimeout(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        const idx = originalName.lastIndexOf('.');
        if (idx > 0) el.setSelectionRange(0, idx);
        else el.select();
      }, 0);
    }
  }, [open, originalName]);

  const submit = () => {
    const next = draft.trim();
    if (!next || next === originalName) {
      onCancel();
      return;
    }
    const oldExt = splitName(originalName).ext.toLowerCase();
    const newExt = splitName(next).ext.toLowerCase();
    if (oldExt !== newExt && !confirmingExtChange) {
      setConfirmingExtChange(true);
      return;
    }
    onConfirm(next);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename file</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-2">
          <input
            ref={inputRef}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setConfirmingExtChange(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submit(); }
              else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
            }}
            placeholder="New file name"
          />
          {confirmingExtChange && (
            <div className="text-xs text-amber-600">
              The file extension is changing. Click Rename again to confirm.
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={submit} disabled={!draft.trim() || draft === originalName}>
            {confirmingExtChange ? 'Confirm rename' : 'Rename'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
