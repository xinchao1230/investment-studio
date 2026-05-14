import React from 'react';
import { TrendingUp } from 'lucide-react';

interface SkillActionsPanelProps {
  targetCode: string | null;
  targetName: string | null;
  onSkillInvoke: (skillId: string, targetCode: string | null) => void;
}

const SKILLS = [
  { id: 'earnings-review', label: 'Earnings Review', desc: '财报回顾分析' },
  { id: 'deep-report', label: 'Deep Report', desc: '深度研究报告' },
  { id: 'earnings-forecast', label: 'Earnings Forecast', desc: '业绩预测' },
  { id: 'marginal-tracking', label: 'Marginal Tracking', desc: '边际变化跟踪' },
  { id: 'industry-comparison', label: 'Industry Comparison', desc: '行业横向对比' },
  { id: 'stock-screening', label: 'Stock Screening', desc: '选股筛选' },
] as const;

const TARGET_SPECIFIC_SKILLS = new Set([
  'earnings-review',
  'deep-report',
  'earnings-forecast',
  'marginal-tracking',
  'industry-comparison',
]);

export const SkillActionsPanel: React.FC<SkillActionsPanelProps> = ({
  targetCode,
  targetName,
  onSkillInvoke,
}) => {
  return (
    <div className="w-56 border-l border-gray-200 flex flex-col h-full bg-white">
      <div className="px-3 py-2 border-b border-gray-200">
        <span className="text-sm font-medium text-gray-700">Skills</span>
        {targetName && (
          <div className="text-xs text-gray-500 mt-0.5 truncate">
            {targetName}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {SKILLS.map((skill) => {
          const needsTarget = TARGET_SPECIFIC_SKILLS.has(skill.id);
          const disabled = needsTarget && !targetCode;

          return (
            <button
              key={skill.id}
              onClick={() => onSkillInvoke(skill.id, targetCode)}
              disabled={disabled}
              className={`w-full text-left px-3 py-2 rounded text-sm ${
                disabled
                  ? 'opacity-40 cursor-not-allowed'
                  : 'hover:bg-blue-50 cursor-pointer'
              }`}
            >
              <div className="flex items-center gap-2">
                <TrendingUp size={14} className="text-blue-500 shrink-0" />
                <span className="font-medium text-gray-700">{skill.label}</span>
              </div>
              <div className="text-xs text-gray-500 ml-6">{skill.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
