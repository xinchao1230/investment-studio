import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';

export type MoveConflictChoice = 'rename' | 'overwrite' | 'cancel';

interface MoveConflictDialogProps {
  open: boolean;
  fileName: string;
  destDirLabel: string;
  /** Computed auto-rename suggestion, e.g. "foo (2).md". */
  renameSuggestion?: string;
  onResolve: (choice: MoveConflictChoice) => void;
}

export const MoveConflictDialog: React.FC<MoveConflictDialogProps> = ({
  open,
  fileName,
  destDirLabel,
  renameSuggestion,
  onResolve,
}) => {
  const [choice, setChoice] = React.useState<'rename' | 'overwrite'>('rename');
  React.useEffect(() => {
    if (open) setChoice('rename');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onResolve('cancel'); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>File already exists</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-gray-700 py-2 space-y-3">
          <div>
            <span className="font-medium">{fileName}</span> already exists in{' '}
            <span className="font-medium">{destDirLabel}</span>.
          </div>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="move-conflict"
              checked={choice === 'rename'}
              onChange={() => setChoice('rename')}
              className="mt-0.5"
            />
            <div>
              <div>Keep both</div>
              {renameSuggestion && (
                <div className="text-xs text-gray-500">Save as: {renameSuggestion}</div>
              )}
            </div>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="radio"
              name="move-conflict"
              checked={choice === 'overwrite'}
              onChange={() => setChoice('overwrite')}
              className="mt-0.5"
            />
            <div>
              <div>Replace existing file</div>
              <div className="text-xs text-red-500">The existing file will be lost.</div>
            </div>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onResolve('cancel')}>Cancel</Button>
          <Button onClick={() => onResolve(choice)}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
