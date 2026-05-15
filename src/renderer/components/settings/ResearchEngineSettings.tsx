import React, { useEffect, useState, useCallback } from 'react';
import { ResearchMcpInstallDialog } from '../researchMcp/ResearchMcpInstallDialog';

interface InstallMeta {
  deps_hash: string;
  python_version: string;
  version: string;
  installed_at?: string;
}

const ResearchEngineSettings: React.FC = () => {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [meta, setMeta] = useState<InstallMeta | null>(null);
  const [showInstallDialog, setShowInstallDialog] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const isInst = await window.electronAPI.researchMcp.isInstalled();
      setInstalled(isInst);
      if (isInst) {
        const m = await window.electronAPI.researchMcp.getInstallMeta();
        setMeta(m);
      } else {
        setMeta(null);
      }
    } catch {
      setInstalled(false);
      setMeta(null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleInstall = () => {
    setShowInstallDialog(true);
  };

  const handleReinstall = async () => {
    if (!window.confirm('确认重新安装投研引擎？将删除现有环境后重新安装。')) return;
    await window.electronAPI.researchMcp.reset();
    setShowInstallDialog(true);
  };

  const handleReset = async () => {
    if (!window.confirm('确认重置投研引擎？将删除虚拟环境和安装记录。')) return;
    await window.electronAPI.researchMcp.reset();
    await refresh();
  };

  const handleOpenLogs = async () => {
    await window.electronAPI.researchMcp.openLogsDir();
  };

  const handleInstallComplete = () => {
    refresh();
  };

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-semibold mb-6">投研引擎</h1>

      {/* Status */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-medium text-gray-600">状态:</span>
          {installed === null ? (
            <span className="text-sm text-gray-400">检测中...</span>
          ) : installed ? (
            <span className="text-sm text-green-600 font-medium">已安装 ✓</span>
          ) : (
            <span className="text-sm text-orange-600 font-medium">未安装</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 mb-6">
        {!installed && (
          <button
            onClick={handleInstall}
            className="px-4 py-2 text-sm text-white bg-blue-500 rounded hover:bg-blue-600"
          >
            安装
          </button>
        )}
        {installed && (
          <>
            <button
              onClick={handleReinstall}
              className="px-4 py-2 text-sm text-white bg-blue-500 rounded hover:bg-blue-600"
            >
              重新安装
            </button>
            <button
              onClick={handleReset}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
            >
              重置
            </button>
          </>
        )}
        <button
          onClick={handleOpenLogs}
          className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
        >
          查看日志
        </button>
      </div>

      {/* Meta info */}
      {installed && meta && (
        <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
          <h3 className="text-sm font-medium text-gray-700 mb-2">安装信息</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-gray-500">版本</dt>
            <dd className="text-gray-700">{meta.version}</dd>
            <dt className="text-gray-500">Python 版本</dt>
            <dd className="text-gray-700">{meta.python_version}</dd>
            <dt className="text-gray-500">依赖哈希</dt>
            <dd className="text-gray-700 font-mono">{meta.deps_hash}</dd>
            {meta.installed_at && (
              <>
                <dt className="text-gray-500">安装时间</dt>
                <dd className="text-gray-700">{new Date(meta.installed_at).toLocaleString()}</dd>
              </>
            )}
          </dl>
        </div>
      )}

      {/* Install Dialog */}
      <ResearchMcpInstallDialog
        open={showInstallDialog}
        onOpenChange={setShowInstallDialog}
        onInstallComplete={handleInstallComplete}
      />
    </div>
  );
};

export default ResearchEngineSettings;
