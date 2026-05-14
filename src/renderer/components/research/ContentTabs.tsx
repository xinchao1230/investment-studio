import React from 'react';
import { X } from 'lucide-react';
import { UniverSheet } from './UniverSheet';

export interface Tab {
  id: string;
  label: string;
  filePath: string;
  content: string;
  type: 'markdown' | 'spreadsheet';
  sheetData?: any;
}

interface ContentTabsProps {
  tabs: Tab[];
  activeTabId: string;
  onTabSelect: (id: string) => void;
  onTabClose: (id: string) => void;
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
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        Select a target to view research files
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Tab bar */}
      <div className="flex border-b border-gray-200 bg-gray-50 overflow-x-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={`flex items-center gap-1 px-3 py-1.5 text-sm cursor-pointer border-r border-gray-200 shrink-0 ${
              tab.id === activeTabId
                ? 'bg-white text-gray-800 border-b-2 border-b-blue-500'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
            onClick={() => onTabSelect(tab.id)}
          >
            <span className="truncate max-w-[120px]">{tab.label}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTabClose(tab.id);
              }}
              className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab ? (
          activeTab.type === 'spreadsheet' && activeTab.sheetData ? (
            <UniverSheet data={activeTab.sheetData} />
          ) : (
            <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">
              {activeTab.content}
            </pre>
          )
        ) : null}
      </div>
    </div>
  );
};
