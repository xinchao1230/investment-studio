import React, { useState, useCallback, useRef } from 'react';
import { TargetListSidebar } from './TargetListSidebar';
import { ContentTabs, Tab } from './ContentTabs';
import { ResearchChatPane } from './ResearchChatPane';
import { usePortfolio, TargetFile } from './usePortfolio';
import { LayoutProvider } from '../layout/LayoutProvider';
import { PasteToWorkspaceProvider } from '../chat/workspace/PasteToWorkspaceProvider';
import './research-theme.css';

export const ResearchPage: React.FC = () => {
  const { targets, loading, initTarget, getTargetFiles } = usePortfolio();
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);

  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());
  const [filesByCode, setFilesByCode] = useState<Record<string, TargetFile[]>>({});
  const [activeFileAbsPath, setActiveFileAbsPath] = useState<string | null>(null);

  const filesByCodeRef = useRef(filesByCode);
  filesByCodeRef.current = filesByCode;

  const loadFiles = useCallback(
    async (code: string) => {
      if (filesByCodeRef.current[code]) return;
      const files = await getTargetFiles(code);
      setFilesByCode((prev) => ({ ...prev, [code]: files }));
    },
    [getTargetFiles],
  );

  const handleSelectTarget = useCallback(
    async (code: string) => {
      setSelectedCode(code);
      setExpandedCodes((prev) => {
        const next = new Set(prev);
        next.add(code);
        return next;
      });
      await loadFiles(code);
    },
    [loadFiles],
  );

  const handleToggleExpand = useCallback(
    (code: string) => {
      setExpandedCodes((prev) => {
        const next = new Set(prev);
        if (next.has(code)) {
          next.delete(code);
        } else {
          next.add(code);
          loadFiles(code);
        }
        return next;
      });
    },
    [loadFiles],
  );

  const handleOpenFile = useCallback(
    (file: TargetFile) => {
      const tabId = file.absPath;
      let isNew = false;
      setTabs((prev) => {
        const existing = prev.find((t) => t.id === tabId);
        if (existing) return prev;
        isNew = true;
        const newTab: Tab = {
          id: tabId,
          label: file.relPath.split('/').pop() ?? file.relPath,
          filePath: file.absPath,
          content: '(loading...)',
          type: 'markdown',
          mtime: file.mtime,
        };
        return [...prev, newTab];
      });
      setActiveTabId(tabId);
      setActiveFileAbsPath(file.absPath);

      // Fire-and-forget: load file content on first open
      if (isNew) {
        (async () => {
          try {
            const result = await window.electronAPI.builtinTools.execute('read_file', {
              description: 'Open file in research workspace',
              filePath: file.absPath,
            });
            let text: string;
            if (result && result.success && result.data != null) {
              const d = result.data;
              if (typeof d === 'string') {
                text = d;
              } else if (d && typeof d === 'object' && 'content' in d && typeof (d as any).content === 'string') {
                text = (d as any).content;
              } else {
                text = JSON.stringify(d);
              }
            } else {
              text = '(无法读取文件: 请求失败)';
            }
            setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, content: text } : t)));
          } catch (err: any) {
            const msg = err?.message ?? String(err);
            setTabs((prev) =>
              prev.map((t) => (t.id === tabId ? { ...t, content: `(无法读取文件: ${msg})` } : t)),
            );
          }
        })();
      }
    },
    [],
  );

  const handleAddTarget = useCallback(async () => {
    if (showAddForm) {
      const code = newCode.trim();
      const name = newName.trim();
      if (!code || !name) {
        setAddError('请填写代号和名称');
        return;
      }
      setAddBusy(true);
      setAddError(null);
      const result = await initTarget(code, name);
      setAddBusy(false);
      if (!result.success) {
        setAddError(result.error || '添加失败');
        return;
      }
      setNewCode('');
      setNewName('');
      setShowAddForm(false);
    } else {
      setAddError(null);
      setShowAddForm(true);
    }
  }, [initTarget, showAddForm, newCode, newName]);

  const handleTabSelect = useCallback((id: string) => {
    setActiveTabId(id);
    setActiveFileAbsPath(id);
  }, []);

  const handleTabClose = useCallback(
    (id: string) => {
      setTabs((prev) => prev.filter((t) => t.id !== id));
      if (activeTabId === id) {
        const remaining = tabs.filter((t) => t.id !== id);
        const nextId = remaining.length > 0 ? remaining[0].id : '';
        setActiveTabId(nextId);
        setActiveFileAbsPath(nextId || null);
      }
    },
    [activeTabId, tabs],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Loading portfolio...
      </div>
    );
  }

  return (
    <LayoutProvider>
    <PasteToWorkspaceProvider>
    <div data-theme="research" className="flex h-full w-full">
      <div className="flex flex-col">
        <TargetListSidebar
          targets={targets}
          selectedCode={selectedCode}
          expandedCodes={expandedCodes}
          filesByCode={filesByCode}
          activeFileAbsPath={activeFileAbsPath}
          onSelectTarget={handleSelectTarget}
          onToggleExpand={handleToggleExpand}
          onOpenFile={handleOpenFile}
          onAddTarget={handleAddTarget}
        />
        {showAddForm && (
          <div className="w-56 p-2 border-r border-gray-200 bg-gray-50 space-y-1">
            <input
              className="w-full px-2 py-1 text-sm border rounded"
              placeholder="Stock code (e.g. 603993)"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              autoFocus
            />
            <input
              className="w-full px-2 py-1 text-sm border rounded"
              placeholder="Company name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddTarget(); }}
            />
            <div className="flex gap-1">
              <button
                onClick={handleAddTarget}
                disabled={addBusy}
                className="flex-1 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
              >
                {addBusy ? 'Adding...' : 'Add'}
              </button>
              <button
                onClick={() => { setShowAddForm(false); setAddError(null); }}
                disabled={addBusy}
                className="flex-1 px-2 py-1 text-xs border rounded hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            {addError && (
              <div className="text-[11px] text-red-600 px-1 pt-1 break-words">
                {addError}
              </div>
            )}
          </div>
        )}
      </div>
      <ContentTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSelect={handleTabSelect}
        onTabClose={handleTabClose}
      />
      <ResearchChatPane activeFileAbsPath={activeFileAbsPath} />
    </div>
    </PasteToWorkspaceProvider>
    </LayoutProvider>
  );
};
