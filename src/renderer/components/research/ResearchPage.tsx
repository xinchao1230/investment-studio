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
    const code = window.prompt('Stock code (e.g. 600519):');
    if (!code) return;
    const name = window.prompt('Company name:');
    if (!name) return;
    await initTarget(code, name);
  }, [initTarget]);

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
      <TargetListSidebar
        targets={targets}
        selectedCode={selectedCode}
        onSelect={handleSelectTarget}
        onAddTarget={handleAddTarget}
      />
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
