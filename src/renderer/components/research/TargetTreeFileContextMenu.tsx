import React, { useLayoutEffect, useRef, useEffect } from 'react';
import { Scissors, Pencil, Trash2, FolderOpen, Copy } from 'lucide-react';

export interface TargetTreeFileContextMenuProps {
  position: { top: number; left: number };
  absPath: string;
  fileName: string;
  canDelete: boolean; // false for profile.yaml
  onClose: () => void;
  onCut: () => void;
  onRename: () => void;
  onDelete: () => void;
}

export const TargetTreeFileContextMenu: React.FC<TargetTreeFileContextMenuProps> = ({
  position,
  absPath,
  fileName,
  canDelete,
  onClose,
  onCut,
  onRename,
  onDelete,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Keep on screen if overflowing.
  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const pad = 8;
    if (rect.bottom > window.innerHeight - pad) {
      const newTop = window.innerHeight - rect.height - pad;
      ref.current.style.top = `${Math.max(pad, newTop)}px`;
    }
    if (rect.right > window.innerWidth - pad) {
      const newLeft = window.innerWidth - rect.width - pad;
      ref.current.style.left = `${Math.max(pad, newLeft)}px`;
    }
  }, [position]);

  const handleReveal = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await (window as any).electronAPI?.workspace?.showInFolder?.(absPath);
    } catch (err) { console.warn('[TargetTreeFileContextMenu] showInFolder failed:', err); }
    onClose();
  };

  const handleCopyPath = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try { await navigator.clipboard.writeText(absPath); }
    catch (err) { console.warn('[TargetTreeFileContextMenu] copy path failed:', err); }
    onClose();
  };

  const stop = (e: React.SyntheticEvent) => { e.stopPropagation(); };

  return (
    <div
      ref={ref}
      role="menu"
      onClick={stop}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 9999,
        minWidth: 180,
      }}
      className="bg-white border border-gray-200 rounded-md shadow-lg py-1 text-sm"
    >
      <div className="px-3 py-1 text-[11px] text-gray-400 truncate" title={fileName}>{fileName}</div>
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 text-left"
        onClick={(e) => { e.stopPropagation(); onCut(); onClose(); }}
      >
        <Scissors size={13} className="text-gray-500" />
        <span>Cut</span>
        <span className="ml-auto text-[10px] text-gray-400">Ctrl+X</span>
      </button>
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 text-left"
        onClick={(e) => { e.stopPropagation(); onRename(); onClose(); }}
      >
        <Pencil size={13} className="text-gray-500" />
        <span>Rename…</span>
        <span className="ml-auto text-[10px] text-gray-400">F2</span>
      </button>
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 text-left"
        onClick={handleReveal}
      >
        <FolderOpen size={13} className="text-gray-500" />
        <span>Reveal in File Explorer</span>
      </button>
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 text-left"
        onClick={handleCopyPath}
      >
        <Copy size={13} className="text-gray-500" />
        <span>Copy path</span>
      </button>
      <div className="my-1 border-t border-gray-100" />
      <button
        type="button"
        disabled={!canDelete}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${canDelete ? 'hover:bg-red-50 text-red-600' : 'text-gray-300 cursor-not-allowed'}`}
        onClick={(e) => { e.stopPropagation(); if (canDelete) { onDelete(); onClose(); } }}
      >
        <Trash2 size={13} />
        <span>Delete</span>
        <span className="ml-auto text-[10px] text-gray-400">Del</span>
      </button>
    </div>
  );
};
