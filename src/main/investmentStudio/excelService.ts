/**
 * Investment Studio — xlsx / csv reading service.
 *
 * Used by the renderer to populate the `'spreadsheet'` tab type in
 * ContentTabs. The output schema matches Univer's IWorkbookData so that
 * <UniverSheet data={...} /> can render it directly.
 */

import ExcelJS from 'exceljs';
import * as fs from 'fs';

export interface UniverCellData {
  v: string;
}

export interface UniverSheetData {
  id: string;
  name: string;
  cellData: Record<number, Record<number, UniverCellData>>;
  rowCount: number;
  columnCount: number;
}

export interface UniverWorkbookData {
  id: string;
  name: string;
  sheetOrder: string[];
  sheets: Record<string, UniverSheetData>;
}

export class ExcelService {
  static async readXlsx(filePath: string): Promise<UniverWorkbookData> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheets: Record<string, UniverSheetData> = {};
    workbook.eachSheet((sheet, sheetId) => {
      const cellData: Record<number, Record<number, UniverCellData>> = {};
      sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        cellData[rowNumber - 1] = {};
        row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
          cellData[rowNumber - 1][colNumber - 1] = { v: cell.value?.toString() || '' };
        });
      });
      sheets[`sheet-${sheetId}`] = {
        id: `sheet-${sheetId}`,
        name: sheet.name,
        cellData,
        rowCount: sheet.rowCount + 10,
        columnCount: (sheet.columnCount || 10) + 5,
      };
    });
    return {
      id: 'workbook-1',
      name: 'Workbook',
      sheetOrder: Object.keys(sheets),
      sheets,
    };
  }

  static async readCsv(filePath: string): Promise<UniverWorkbookData> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    const cellData: Record<number, Record<number, UniverCellData>> = {};
    lines.forEach((line, row) => {
      cellData[row] = {};
      line.split(',').forEach((val, col) => {
        cellData[row][col] = { v: val.trim().replace(/^"|"$/g, '') };
      });
    });
    return {
      id: 'workbook-1',
      name: 'Workbook',
      sheetOrder: ['sheet-1'],
      sheets: {
        'sheet-1': {
          id: 'sheet-1',
          name: 'Sheet1',
          cellData,
          rowCount: lines.length + 10,
          columnCount: Math.max(...lines.map((l) => l.split(',').length)) + 5,
        },
      },
    };
  }
}
