import React, { useRef, useEffect } from 'react';

// Univer CSS bundles — must be loaded for the sheet UI to render at all.
// Static imports let the renderer bundler resolve them at build time
// (the previous `require.resolve` based link-injection broke under
// Vite's ESM resolution).
import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/sheets-ui/lib/index.css';

interface UniverSheetProps {
  data: any;
  onChange?: (data: any) => void;
}

/**
 * Embedded Univer spreadsheet viewer for xlsx tabs in ContentTabs.
 *
 * The Univer 0.22.x API surface differs from earlier docs in two
 * important ways and we previously got both wrong:
 *  - The instance creation entry-point is `createUnit(type, data)`,
 *    NOT the older `createUniverSheet(data)`.
 *  - Locales must be passed to the `Univer` constructor as a merged
 *    `locales` map — just setting `locale: LocaleType.ZH_CN` is not
 *    enough; the `LocaleService` will throw "Locale not initialized"
 *    the moment any Ribbon / UI component tries to translate a key.
 *
 * Each plugin ships its own zh-CN dictionary; we deep-merge them with
 * `Tools.deepMerge` (re-exported from `@univerjs/core`) before passing
 * the combined map in.
 */
export const UniverSheet: React.FC<UniverSheetProps> = ({ data }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !data) return;

    let univer: any = null;
    let disposed = false;

    const initUniver = async () => {
      try {
        const core: any = await import('@univerjs/core');
        const { Univer, LocaleType, Tools, UniverInstanceType } = core;
        const { UniverSheetsPlugin } = await import('@univerjs/sheets');
        const { UniverSheetsUIPlugin } = await import('@univerjs/sheets-ui');
        const { UniverUIPlugin } = await import('@univerjs/ui');
        const { UniverRenderEnginePlugin } = await import('@univerjs/engine-render');
        const { UniverFormulaEnginePlugin } = await import('@univerjs/engine-formula');
        const { UniverSheetsFormulaPlugin } = await import('@univerjs/sheets-formula');

        // Locale bundles — load every plugin's zh-CN dictionary.
        const [designZh, uiZh, sheetsZh, sheetsUIZh, sheetsFormulaZh] =
          await Promise.all([
            import('@univerjs/design/lib/locale/zh-CN'),
            import('@univerjs/ui/lib/locale/zh-CN'),
            import('@univerjs/sheets/lib/locale/zh-CN'),
            import('@univerjs/sheets-ui/lib/locale/zh-CN'),
            import('@univerjs/sheets-formula/lib/locale/zh-CN'),
          ]);

        if (disposed || !containerRef.current) return;

        const pick = (m: any) => (m && m.default ? m.default : m);

        univer = new Univer({
          locale: LocaleType.ZH_CN,
          locales: {
            [LocaleType.ZH_CN]: Tools.deepMerge(
              {},
              pick(designZh),
              pick(uiZh),
              pick(sheetsZh),
              pick(sheetsUIZh),
              pick(sheetsFormulaZh),
            ),
          },
        });

        // Order matters: render + formula engines, then UI shell, then
        // sheets + sheets-ui + sheets-formula on top.
        univer.registerPlugin(UniverRenderEnginePlugin);
        univer.registerPlugin(UniverFormulaEnginePlugin);
        univer.registerPlugin(UniverUIPlugin, { container: containerRef.current });
        univer.registerPlugin(UniverSheetsPlugin);
        univer.registerPlugin(UniverSheetsUIPlugin);
        univer.registerPlugin(UniverSheetsFormulaPlugin);

        univer.createUnit(UniverInstanceType.UNIVER_SHEET, data);
      } catch (err) {
        console.error('Failed to initialize Univer:', err);
        if (containerRef.current) {
          containerRef.current.innerHTML =
            '<p class="p-4 text-gray-500">Spreadsheet viewer loading failed. Showing raw data.</p>' +
            '<pre class="p-4 text-xs overflow-auto">' +
            JSON.stringify(data, null, 2) +
            '</pre>';
        }
      }
    };

    void initUniver();

    return () => {
      disposed = true;
      if (univer) {
        try {
          univer.dispose();
        } catch {
          // ignore disposal errors
        }
      }
    };
  }, [data]);

  return <div ref={containerRef} className="h-full w-full" />;
};
