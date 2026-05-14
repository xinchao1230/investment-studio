import React, { useState, useCallback, useRef } from 'react';
import { TargetListSidebar } from './TargetListSidebar';
import { ContentTabs, Tab } from './ContentTabs';
import { SkillActionsPanel } from './SkillActionsPanel';
import { usePortfolio, TargetFile } from './usePortfolio';
import './research-theme.css';

export const ResearchPage: React.FC = () => {
  const { targets, loading, initTarget, getTargetFiles } = usePortfolio();
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');

  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set());
  const [filesByCode, setFilesByCode] = useState<Record<string, TargetFile[]>>({});
  const [activeFileAbsPath, setActiveFileAbsPath] = useState<string | null>(null);

  const filesByCodeRef = useRef(filesByCode);
  filesByCodeRef.current = filesByCode;

  const selectedTarget = targets.find((t) => t.stock_code === selectedCode);

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
      setTabs((prev) => {
        if (prev.find((t) => t.id === tabId)) return prev;
        const newTab: Tab = {
          id: tabId,
          label: file.relPath.split('/').pop() ?? file.relPath,
          filePath: file.absPath,
          content: '(loading...)',
          type: 'markdown',
        };
        return [...prev, newTab];
      });
      setActiveTabId(tabId);
      setActiveFileAbsPath(file.absPath);
    },
    [],
  );

  const handleAddTarget = useCallback(async () => {
    if (showAddForm) {
      if (newCode && newName) {
        await initTarget(newCode, newName);
        setNewCode('');
        setNewName('');
        setShowAddForm(false);
      }
    } else {
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

  const handleSkillInvoke = useCallback(
    (skillId: string, targetCode: string | null) => {
      console.log('[ResearchPage] Skill invoked:', skillId, targetCode);
      // TODO: integrate with chat/agent system
    },
    [],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Loading portfolio...
      </div>
    );
  }

  return (
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
                className="flex-1 px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Add
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="flex-1 px-2 py-1 text-xs border rounded hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      <ContentTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSelect={handleTabSelect}
        onTabClose={handleTabClose}
      />
      <SkillActionsPanel
        targetCode={selectedCode}
        targetName={selectedTarget?.name ?? null}
        onSkillInvoke={handleSkillInvoke}
      />
    </div>
  );
};
