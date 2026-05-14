import React, { useState, useCallback } from 'react';
import { Plus, ChevronRight, ChevronDown, Folder, FileText, FileCode } from 'lucide-react';
import type { TargetFile } from './usePortfolio';

export interface Target {
  stock_code: string;
  name: string;
  industry: string;
  follow_date: string;
  directory: string;
}

interface TargetListSidebarProps {
  targets: Target[];
  selectedCode: string | null;
  expandedCodes: Set<string>;
  filesByCode: Record<string, TargetFile[] | undefined>;
  activeFileAbsPath: string | null;
  onSelectTarget: (code: string) => void;
  onToggleExpand: (code: string) => void;
  onOpenFile: (file: TargetFile) => void;
  onAddTarget: () => void;
}

const SUBCATEGORIES = ['纪要', '专家交流', '公司交流', '研报', '模型', '公告', '其它'];

function fileIcon(relPath: string) {
  if (/\.(md|yaml|txt)$/i.test(relPath)) return FileText;
  if (/\.json$/i.test(relPath)) return FileCode;
  return FileText;
}

export const TargetListSidebar: React.FC<TargetListSidebarProps> = ({
  targets,
  selectedCode,
  expandedCodes,
  filesByCode,
  activeFileAbsPath,
  onSelectTarget,
  onToggleExpand,
  onOpenFile,
  onAddTarget,
}) => {
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  const toggleCat = useCallback((key: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  return (
    <div className="rw-pane-left w-56 flex flex-col h-full">
      {/* Header */}
      <div className="rw-divider flex items-center justify-between px-3 py-2">
        <span className="text-[12.5px] font-medium text-[var(--rw-text)]">Targets</span>
        <button
          onClick={onAddTarget}
          className="p-1 rounded hover:bg-black/5 text-[var(--rw-text-3)] hover:text-[var(--rw-text)]"
          title="Add target"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto">
        {targets.length === 0 && (
          <div className="px-3 py-4 text-xs text-[var(--rw-text-3)] text-center">
            No targets yet
          </div>
        )}

        {targets.map((target) => {
          const code = target.stock_code;
          const isExpanded = expandedCodes.has(code);
          const files = filesByCode[code];

          const rootFiles = files?.filter((f) => !f.relPath.includes('/')) ?? [];

          return (
            <React.Fragment key={code}>
              {/* Target row */}
              <div
                className={`rw-tree-row ${selectedCode === code ? 'is-active' : ''}`}
              >
                <span
                  className="flex-shrink-0 cursor-pointer"
                  onClick={() => onToggleExpand(code)}
                >
                  {isExpanded
                    ? <ChevronDown size={14} />
                    : <ChevronRight size={14} />}
                </span>
                <span
                  className="ml-1 truncate flex-1 cursor-pointer"
                  onClick={() => onSelectTarget(code)}
                >
                  {target.name}
                </span>
                <span className="ml-1 flex-shrink-0 text-[11px] text-[var(--rw-text-3)]">
                  {code}
                </span>
              </div>

              {/* Expanded contents */}
              {isExpanded && files && (
                <>
                  {/* Root-level files */}
                  {rootFiles.map((file) => {
                    const Icon = fileIcon(file.relPath);
                    return (
                      <div
                        key={file.absPath}
                        className={`rw-tree-row ${activeFileAbsPath === file.absPath ? 'is-active' : ''}`}
                        style={{ paddingLeft: 12 }}
                        onClick={() => onOpenFile(file)}
                      >
                        <Icon size={13} className="flex-shrink-0 mr-1" />
                        <span className="truncate">{file.relPath}</span>
                      </div>
                    );
                  })}

                  {/* Sub-categories */}
                  {SUBCATEGORIES.map((cat) => {
                    const catFiles = files.filter((f) => f.relPath.startsWith(cat + '/'));
                    const catKey = `${code}::${cat}`;
                    const isCatExpanded = expandedCats.has(catKey);
                    const hasFiles = catFiles.length > 0;

                    return (
                      <React.Fragment key={catKey}>
                        <div
                          className={`rw-tree-row ${!hasFiles ? 'is-disabled' : ''}`}
                          style={{ paddingLeft: 12 }}
                          onClick={hasFiles ? () => toggleCat(catKey) : undefined}
                        >
                          {hasFiles
                            ? (isCatExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)
                            : <span style={{ width: 13 }} />}
                          <Folder size={13} className="flex-shrink-0 mx-1" />
                          <span className="truncate">{cat}</span>
                        </div>

                        {hasFiles && isCatExpanded && catFiles.map((file) => {
                          const Icon = fileIcon(file.relPath);
                          const fileName = file.relPath.slice(cat.length + 1);
                          return (
                            <div
                              key={file.absPath}
                              className={`rw-tree-row ${activeFileAbsPath === file.absPath ? 'is-active' : ''}`}
                              style={{ paddingLeft: 24 }}
                              onClick={() => onOpenFile(file)}
                            >
                              <Icon size={13} className="flex-shrink-0 mr-1" />
                              <span className="truncate">{fileName}</span>
                            </div>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
