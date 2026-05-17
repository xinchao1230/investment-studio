import React from 'react';
import { X, Search, Download, MoreHorizontal } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { UniverSheet } from './UniverSheet';
import { CSVTable } from '../ui/OverlayFileViewer';

export interface Tab {
  id: string;
  label: string;
  filePath: string;
  content: string;
  type: 'markdown' | 'spreadsheet' | 'csv';
  sheetData?: any;
  mtime?: number;
  /** Optional breadcrumb prefix shown before the filename (e.g. "携程集团.HK"). */
  pathPrefix?: string;
}

interface ContentTabsProps {
  tabs: Tab[];
  activeTabId: string;
  onTabSelect: (id: string) => void;
  onTabClose: (id: string) => void;
}

const STATUS_MAP: Record<string, string> = {
  '边际改善': 'rw-status-pill rw-status-good',
  '边际承压': 'rw-status-pill rw-status-warn',
  '边际恶化': 'rw-status-pill rw-status-bad',
};

const StatusCell: React.FC<any> = ({ children, ...rest }) => {
  const text = React.Children.toArray(children)
    .map((c) => (typeof c === 'string' ? c : ''))
    .join('')
    .trim();
  const cls = STATUS_MAP[text];
  if (cls)
    return (
      <td {...rest}>
        <span className={cls}>{text}</span>
      </td>
    );
  return <td {...rest}>{children}</td>;
};

function formatTime(mtime?: number): string {
  if (!mtime) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(mtime));
}

export const ContentTabs: React.FC<ContentTabsProps> = ({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
}) => {
  const activeTab = tabs.find((t) => t.id === activeTabId);

  if (tabs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--rw-text-3)] text-sm">
        从左侧选择文件以打开
      </div>
    );
  }

  const basename = activeTab
    ? activeTab.filePath.split(/[\\/]/).pop() ?? activeTab.label
    : '';

  return (
    <div className="flex-1 flex flex-col min-w-0" style={{ background: 'var(--rw-bg)' }}>
      {/* Tab strip */}
      <div className="flex h-7 rw-divider overflow-x-auto bg-[var(--rw-bg-soft)]">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`group flex items-center gap-2 px-3 text-[12.5px] cursor-pointer border-r border-[var(--rw-border)] shrink-0 h-full ${
                isActive
                  ? 'rw-tab-active-bar bg-white text-[var(--rw-text)]'
                  : 'bg-[var(--rw-bg-soft)] text-[var(--rw-text-2)] hover:bg-black/5'
              }`}
              onClick={() => onTabSelect(tab.id)}
            >
              <span className="truncate max-w-[120px]">{tab.label}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTabClose(tab.id);
                }}
                className={`p-0.5 rounded hover:bg-black/10 ${
                  isActive ? 'opacity-60' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        <button disabled className="px-2 text-[var(--rw-text-3)] cursor-not-allowed">
          +
        </button>
      </div>

      {/* Document header */}
      {activeTab && (
        <div className="flex items-center justify-between h-8 px-4 rw-divider text-[12.5px] text-[var(--rw-text-2)] bg-[var(--rw-bg)]">
          <span className="truncate">
            {activeTab.pathPrefix && (
              <>
                <span className="text-[var(--rw-text)] font-medium">{activeTab.pathPrefix}</span>
                <span className="mx-1.5 text-[var(--rw-text-3)]">›</span>
              </>
            )}
            <span className="text-[var(--rw-text)]">{basename}</span>
            <span className="mx-1.5 text-[var(--rw-text-3)]">·</span>
            最近更新 {formatTime(activeTab.mtime)}
          </span>
          <div className="flex items-center">
            <button
              className="p-1 rounded hover:bg-black/5 text-[var(--rw-text-2)]"
              disabled
            >
              <Search size={14} />
            </button>
            <button
              className="p-1 rounded hover:bg-black/5 text-[var(--rw-text-2)]"
              disabled
            >
              <Download size={14} />
            </button>
            <button
              className="p-1 rounded hover:bg-black/5 text-[var(--rw-text-2)]"
              disabled
            >
              <MoreHorizontal size={14} />
            </button>
            <button
              className="ml-2 px-3 h-6 rounded bg-[var(--rw-accent)] text-white text-[12px] opacity-50 cursor-not-allowed"
              disabled
            >
              保存
            </button>
          </div>
        </div>
      )}

      {/* Body */}
      {activeTab ? (
        activeTab.type === 'spreadsheet' && activeTab.sheetData ? (
          <div className="flex-1 overflow-auto">
            <UniverSheet data={activeTab.sheetData} />
          </div>
        ) : activeTab.type === 'csv' ? (
          <div className="flex-1 overflow-auto min-h-0">
            <CSVTable
              content={activeTab.content}
              delimiter={/\.tsv$/i.test(activeTab.filePath) ? '\t' : ','}
            />
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <div className="rw-doc-body prose prose-sm max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  td: StatusCell,
                  th: ({ children }) => <th>{children}</th>,
                }}
              >
                {activeTab.content}
              </ReactMarkdown>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
};
