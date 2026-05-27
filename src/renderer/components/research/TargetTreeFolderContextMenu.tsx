import React, { useLayoutEffect, useRef, useEffect } from 'react';
import { FilePlus, FolderPlus, FolderOpen, Copy, Trash2 } from 'lucide-react';

export interface TargetTreeFolderContextMenuProps {
  position: { top: number; left: number };
  folderAbsPath: string;
  folderName: string;
  /** When true, the 删除 item is hidden (e.g. for target roots / standard subcategories). */
  canDelete?: boolean;
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onDelete?: () => void;
}

export const TargetTreeFolderContextMenu: React.FC<TargetTreeFolderContextMenuProps> = ({
  position,
  folderAbsPath,
  folderName,
  canDelete = false,
  onClose,
  onNewFile,
  onNewFolder,
  onDelete,
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

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
      await (window as any).electronAPI?.workspace?.showInFolder?.(folderAbsPath);
    } catch (err) { console.warn('[TargetTreeFolderContextMenu] showInFolder failed:', err); }
    onClose();
  };

  const handleCopyPath = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try { await navigator.clipboard.writeText(folderAbsPath); }
    catch (err) { console.warn('[TargetTreeFolderContextMenu] copy path failed:', err); }
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
      <div className="px-3 py-1 text-[11px] text-gray-400 truncate" title={folderName}>{folderName}</div>
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 text-left"
        onClick={(e) => { e.stopPropagation(); onNewFile(); onClose(); }}
      >
        <FilePlus size={13} className="text-gray-500" />
        <span>新建文件</span>
      </button>
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 text-left"
        onClick={(e) => { e.stopPropagation(); onNewFolder(); onClose(); }}
      >
        <FolderPlus size={13} className="text-gray-500" />
        <span>新建文件夹</span>
      </button>
      <div className="my-1 border-t border-gray-100" />
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 text-left"
        onClick={handleReveal}
      >
        <FolderOpen size={13} className="text-gray-500" />
        <span>在文件资源管理器中显示</span>
      </button>
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 text-left"
        onClick={handleCopyPath}
      >
        <Copy size={13} className="text-gray-500" />
        <span>复制路径</span>
      </button>
      {canDelete && onDelete && (
        <>
          <div className="my-1 border-t border-gray-100" />
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-red-50 text-left text-red-600"
            onClick={(e) => { e.stopPropagation(); onDelete(); onClose(); }}
          >
            <Trash2 size={13} />
            <span>删除</span>
          </button>
        </>
      )}
    </div>
  );
};
