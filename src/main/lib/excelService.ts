import ExcelJS from 'exceljs';
import * as fs from 'fs';

export class ExcelService {
  static async readXlsx(filePath: string): Promise<any> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheets: Record<string, any> = {};
    workbook.eachSheet((sheet, sheetId) => {
      const cellData: Record<number, Record<number, any>> = {};
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
    return { id: 'workbook-1', name: 'Workbook', sheetOrder: Object.keys(sheets), sheets };
  }

  static async readCsv(filePath: string): Promise<any> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    const cellData: Record<number, Record<number, any>> = {};
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

  static async saveXlsx(filePath: string, data: any): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    for (const sheetId of data.sheetOrder || []) {
      const sheetData = data.sheets?.[sheetId];
      if (!sheetData) continue;
      const sheet = workbook.addWorksheet(sheetData.name || 'Sheet');
      const cellData = sheetData.cellData || {};
      for (const [rowStr, cols] of Object.entries(cellData)) {
        const rowNum = parseInt(rowStr) + 1;
        for (const [colStr, cell] of Object.entries(cols as Record<string, any>)) {
          const colNum = parseInt(colStr) + 1;
          sheet.getCell(rowNum, colNum).value = (cell as any).v || '';
        }
      }
    }
    await workbook.xlsx.writeFile(filePath);
  }
}
