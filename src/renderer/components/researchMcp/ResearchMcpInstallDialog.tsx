import React, { useEffect } from 'react';
import { Dialog, DialogContent } from '../ui/dialog';
import { useResearchMcpInstall, InstallState } from './useResearchMcpInstall';

const STAGE_LABELS: Record<string, string> = {
  detect_uv: '检测 uv 工具',
  create_venv: '创建 Python 虚拟环境',
  install_deps: '安装依赖包',
  health_check: '完成校验',
};

interface ResearchMcpInstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstallComplete?: () => void;
  autoStart?: boolean;
}

export const ResearchMcpInstallDialog: React.FC<ResearchMcpInstallDialogProps> = ({
  open,
  onOpenChange,
  onInstallComplete,
  autoStart = true,
}) => {
  const { state, progress, logs, error, start, cancel, reset } = useResearchMcpInstall();

  useEffect(() => {
    if (open && autoStart && state === 'idle') {
      start();
    }
  }, [open, autoStart, state, start]);

  useEffect(() => {
    if (state === 'success') {
      const timer = setTimeout(() => {
        onOpenChange(false);
        onInstallComplete?.();
        reset();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [state, onOpenChange, onInstallComplete, reset]);

  const handleClose = () => {
    if (state === 'idle' || state === 'success' || state === 'error') {
      onOpenChange(false);
      reset();
    }
  };

  const handleCancel = async () => {
    await cancel();
  };

  const handleRetry = () => {
    reset();
    setTimeout(() => start(), 0);
  };

  const handleCopyLogs = () => {
    const logText = logs.join('');
    navigator.clipboard.writeText(logText).catch(() => {});
  };

  // Prevent backdrop close while installing
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && state === 'installing') return;
    if (!newOpen) handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-lg mx-4 p-6">
        <h2 className="text-lg font-semibold mb-4">安装投研引擎 (research-mcp)</h2>

        {state === 'success' && (
          <div className="flex items-center gap-2 text-green-600 font-medium py-4">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.7-9.3a.75.75 0 00-1.06-1.06L9 11.3 7.36 9.64a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l4.09-4.25z" fill="currentColor"/>
            </svg>
            安装完成 ✓
          </div>
        )}

        {(state === 'idle' || state === 'installing') && (
          <>
            {/* Stage indicators */}
            <div className="space-y-1 mb-4">
              {Object.entries(STAGE_LABELS).map(([key, label]) => {
                const isActive = progress.stage === key;
                const isPast = getStageIndex(progress.stage) > getStageIndex(key);
                return (
                  <div
                    key={key}
                    className={`text-sm px-2 py-1 rounded ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 font-medium'
                        : isPast
                          ? 'text-green-600'
                          : 'text-gray-400'
                    }`}
                  >
                    {isPast ? '✓ ' : isActive ? '▶ ' : '○ '}
                    {label}
                  </div>
                );
              })}
            </div>

            {/* Progress bar */}
            <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 mb-2">{progress.percent}%</div>

            {/* Log output */}
            {logs.length > 0 && (
              <div className="text-xs font-mono text-gray-500 h-8 overflow-hidden">
                {logs[logs.length - 1]?.trim().slice(0, 120)}
              </div>
            )}

            {/* Cancel button */}
            {state === 'installing' && progress.stage !== 'health_check' && (
              <div className="mt-4 flex justify-end">
                <button
                  onClick={handleCancel}
                  className="px-4 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
                >
                  取消
                </button>
              </div>
            )}
          </>
        )}

        {state === 'error' && (
          <>
            <div className="bg-red-50 border border-red-200 rounded p-3 mb-4">
              <div className="text-sm text-red-700 font-medium mb-2">安装失败</div>
              <pre className="text-xs text-red-600 max-h-40 overflow-y-auto whitespace-pre-wrap font-mono">
                {error}
                {logs.length > 0 && '\n\n--- 日志 ---\n' + logs.slice(-20).join('')}
              </pre>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCopyLogs}
                className="px-4 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
              >
                复制日志
              </button>
              <button
                onClick={handleRetry}
                className="px-4 py-1.5 text-sm text-white bg-blue-500 rounded hover:bg-blue-600"
              >
                重试
              </button>
              <button
                onClick={handleClose}
                className="px-4 py-1.5 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

function getStageIndex(stage: string): number {
  const stages = ['detect_uv', 'create_venv', 'install_deps', 'health_check'];
  return stages.indexOf(stage);
}

export default ResearchMcpInstallDialog;
