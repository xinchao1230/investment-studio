import React from 'react';
import { Plus } from 'lucide-react';

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
  onSelect: (code: string) => void;
  onAddTarget: () => void;
}

export const TargetListSidebar: React.FC<TargetListSidebarProps> = ({
  targets,
  selectedCode,
  onSelect,
  onAddTarget,
}) => {
  return (
    <div className="w-56 border-r border-gray-200 flex flex-col h-full bg-white">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
        <span className="text-sm font-medium text-gray-700">Targets</span>
        <button
          onClick={onAddTarget}
          className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700"
          title="Add target"
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {targets.map((target) => (
          <button
            key={target.stock_code}
            onClick={() => onSelect(target.stock_code)}
            className={`w-full text-left px-3 py-2 border-b border-gray-100 ${
              selectedCode === target.stock_code
                ? 'bg-blue-50 border-l-2 border-l-blue-500'
                : 'hover:bg-gray-50'
            }`}
          >
            <div className="text-sm font-medium text-gray-800 truncate">
              {target.name}
            </div>
            <div className="text-xs text-gray-500">{target.stock_code}</div>
          </button>
        ))}
        {targets.length === 0 && (
          <div className="px-3 py-4 text-xs text-gray-400 text-center">
            No targets yet
          </div>
        )}
      </div>
    </div>
  );
};
