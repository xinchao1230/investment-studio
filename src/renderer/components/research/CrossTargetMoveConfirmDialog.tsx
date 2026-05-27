import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../ui/dialog';
import { Button } from '../ui/button';

interface CrossTargetMoveConfirmDialogProps {
  open: boolean;
  fileName: string;
  fromTargetName: string;
  toTargetName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const CrossTargetMoveConfirmDialog: React.FC<CrossTargetMoveConfirmDialogProps> = ({
  open,
  fileName,
  fromTargetName,
  toTargetName,
  onConfirm,
  onCancel,
}) => {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move across targets?</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-gray-700 py-2">
          Move <span className="font-medium">{fileName}</span> from{' '}
          <span className="font-medium">{fromTargetName}</span> to{' '}
          <span className="font-medium">{toTargetName}</span>?
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onConfirm}>Move</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
