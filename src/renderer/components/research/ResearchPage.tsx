import React, { useState, useCallback } from 'react';
import { TargetListSidebar } from './TargetListSidebar';
import { ContentTabs, Tab } from './ContentTabs';
import { SkillActionsPanel } from './SkillActionsPanel';
import { usePortfolio } from './usePortfolio';

export const ResearchPage: React.FC = () => {
  const { targets, loading, initTarget, getTargetFiles } = usePortfolio();
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');

  const selectedTarget = targets.find((t) => t.stock_code === selectedCode);

  const handleSelectTarget = useCallback(
    async (code: string) => {
      setSelectedCode(code);
      const files = await getTargetFiles(code);
      // Open key-drivers.md as first tab if available
      const keyDrivers = files.find((f) => f.endsWith('key-drivers.md'));
      if (keyDrivers) {
        const tabId = `${code}:key-drivers`;
        const existingTab = tabs.find((t) => t.id === tabId);
        if (!existingTab) {
          const newTab: Tab = {
            id: tabId,
            label: 'Key Drivers',
            filePath: keyDrivers,
            content: '(loading...)',
            type: 'markdown',
          };
          setTabs((prev) => [...prev, newTab]);
        }
        setActiveTabId(tabId);
      }
    },
    [getTargetFiles, tabs],
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
  }, []);

  const handleTabClose = useCallback(
    (id: string) => {
      setTabs((prev) => prev.filter((t) => t.id !== id));
      if (activeTabId === id) {
        setActiveTabId(tabs.length > 1 ? tabs[0].id : '');
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
    <div className="flex h-full w-full bg-white">
      <div className="flex flex-col">
        <TargetListSidebar
          targets={targets}
          selectedCode={selectedCode}
          onSelect={handleSelectTarget}
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
