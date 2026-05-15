import React, { useEffect, useState, useCallback } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type Provider = 'tushare' | 'eastmoney';

interface ProviderSpec {
  id: Provider;
  title: string;
  helper: React.ReactNode;
}

const PROVIDERS: ProviderSpec[] = [
  {
    id: 'tushare',
    title: 'Tushare',
    helper: (
      <>前往 <a href="https://tushare.pro/register" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">tushare.pro</a> 注册并复制你的 token。</>
    ),
  },
  {
    id: 'eastmoney',
    title: 'Eastmoney',
    helper: <>留空将使用应用内置 token；自定义 token 用于高频调用配额。</>,
  },
];

interface CardState {
  initial: string;
  draft: string;
  show: boolean;
  saving: boolean;
  testing: boolean;
  status: { ok: boolean; error?: string } | null;
}

const emptyState = (initial: string): CardState => ({
  initial,
  draft: initial,
  show: false,
  saving: false,
  testing: false,
  status: null,
});

export const ResearchApiView: React.FC = () => {
  const [cards, setCards] = useState<Record<Provider, CardState>>({
    tushare: emptyState(''),
    eastmoney: emptyState(''),
  });

  // Initial load
  useEffect(() => {
    let alive = true;
    (async () => {
      const api = (window as any).electronAPI?.researchApi;
      if (!api) return;
      const [t, e] = await Promise.all([api.getToken('tushare'), api.getToken('eastmoney')]);
      if (!alive) return;
      setCards({
        tushare: emptyState(t ?? ''),
        eastmoney: emptyState(e ?? ''),
      });
    })();
    return () => { alive = false; };
  }, []);

  const updateCard = useCallback((id: Provider, patch: Partial<CardState>) => {
    setCards((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const handleSave = useCallback(async (id: Provider) => {
    const api = (window as any).electronAPI?.researchApi;
    if (!api) return;
    updateCard(id, { saving: true, status: null });
    const value = cards[id].draft;
    const result = await api.setToken(id, value.length > 0 ? value : null);
    updateCard(id, {
      saving: false,
      initial: result.ok ? value : cards[id].initial,
      status: result.ok ? null : { ok: false, error: result.error ?? '保存失败' },
    });
  }, [cards, updateCard]);

  const handleTest = useCallback(async (id: Provider) => {
    const api = (window as any).electronAPI?.researchApi;
    if (!api) return;
    // Save first if dirty so the test uses the value the user just typed.
    if (cards[id].draft !== cards[id].initial) {
      await handleSave(id);
    }
    updateCard(id, { testing: true, status: null });
    const r = await api.testConnection(id);
    updateCard(id, { testing: false, status: r });
  }, [cards, handleSave, updateCard]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-xl font-semibold mb-1">Research API</h1>
      <p className="text-sm text-gray-500 mb-6">
        投研工作流使用的数据源 API token 配置。Token 以明文形式与 profile.json 一同保存。
      </p>

      <div className="space-y-4">
        {PROVIDERS.map((p) => {
          const c = cards[p.id];
          const dirty = c.draft !== c.initial;
          return (
            <div key={p.id} className="border border-gray-200 rounded-lg p-5 bg-white">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-medium">{p.title}</h2>
              </div>

              <div className="flex gap-2 items-center">
                <div className="flex-1 relative">
                  <input
                    type={c.show ? 'text' : 'password'}
                    value={c.draft}
                    onChange={(e) => updateCard(p.id, { draft: e.target.value, status: null })}
                    placeholder="paste your token here"
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm pr-10 focus:outline-none focus:border-blue-500"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => updateCard(p.id, { show: !c.show })}
                    aria-label={c.show ? 'hide' : 'show'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {c.show ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <button
                  disabled={!dirty || c.saving}
                  onClick={() => handleSave(p.id)}
                  className="px-3 py-1.5 text-sm rounded bg-blue-600 text-white disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {c.saving ? '保存中…' : '保存'}
                </button>
                <button
                  disabled={c.testing || (!c.initial && !c.draft)}
                  onClick={() => handleTest(p.id)}
                  className="px-3 py-1.5 text-sm rounded border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {c.testing ? '测试中…' : '测试连接'}
                </button>
              </div>

              {c.status && (
                <div className={`mt-2 text-xs ${c.status.ok ? 'text-green-600' : 'text-red-600'}`}>
                  {c.status.ok ? '✓ 连接成功' : `✗ ${c.status.error ?? '失败'}`}
                </div>
              )}

              <p className="mt-3 text-xs text-gray-500">{p.helper}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ResearchApiView;
