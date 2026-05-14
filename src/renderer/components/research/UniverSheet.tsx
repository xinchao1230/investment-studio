import React, { useRef, useEffect } from 'react';

interface UniverSheetProps {
  data: any;
  onChange?: (data: any) => void;
}

export const UniverSheet: React.FC<UniverSheetProps> = ({ data }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !data) return;

    let univer: any = null;

    const initUniver = async () => {
      try {
        const { Univer, LocaleType } = await import('@univerjs/core');
        const { defaultTheme } = await import('@univerjs/design');
        const { UniverSheetsPlugin } = await import('@univerjs/sheets');
        const { UniverSheetsUIPlugin } = await import('@univerjs/sheets-ui');
        const { UniverUIPlugin } = await import('@univerjs/ui');
        const { UniverRenderEnginePlugin } = await import('@univerjs/engine-render');
        const { UniverFormulaEnginePlugin } = await import('@univerjs/engine-formula');
        const { UniverSheetsFormulaPlugin } = await import('@univerjs/sheets-formula');

        // Import styles
        await import('@univerjs/design/lib/index.css');
        await import('@univerjs/ui/lib/index.css');
        await import('@univerjs/sheets-ui/lib/index.css');

        univer = new Univer({ theme: defaultTheme, locale: LocaleType.ZH_CN });
        univer.registerPlugin(UniverRenderEnginePlugin);
        univer.registerPlugin(UniverFormulaEnginePlugin);
        univer.registerPlugin(UniverUIPlugin, { container: containerRef.current });
        univer.registerPlugin(UniverSheetsPlugin);
        univer.registerPlugin(UniverSheetsUIPlugin);
        univer.registerPlugin(UniverSheetsFormulaPlugin);
        univer.createUniverSheet(data);
      } catch (err) {
        console.error('Failed to initialize Univer:', err);
        // Fallback: render data as table
        if (containerRef.current) {
          containerRef.current.innerHTML =
            '<p class="p-4 text-gray-500">Spreadsheet viewer loading failed. Showing raw data.</p>' +
            '<pre class="p-4 text-xs overflow-auto">' +
            JSON.stringify(data, null, 2) +
            '</pre>';
        }
      }
    };

    initUniver();

    return () => {
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
