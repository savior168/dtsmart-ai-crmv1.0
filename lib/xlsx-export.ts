import XLSX from "xlsx-js-style";

export type WorkbookSheet = {
  name: string;
  rows: unknown[][];
  widths?: number[];
  wrapColumns?: number[];
  hyperlinkColumns?: number[];
  headerRows?: number;
};

const BORDER = { style: "thin", color: { rgb: "D9E2F0" } };
const HEADER_STYLE = {
  font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 },
  fill: { fgColor: { rgb: "1F4E78" } },
  alignment: { horizontal: "center", vertical: "center", wrapText: true },
  border: { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER },
};
const CELL_STYLE = {
  alignment: { vertical: "top" },
  border: { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER },
};

function safeSheetName(value: string, index: number) {
  return (value || `工作表${index + 1}`).replace(/[\\/*?:\[\]]/g, "_").slice(0, 31);
}

function columnWidth(rows: unknown[][], index: number, fallback = 16) {
  const longest = rows.reduce((max, row) => Math.max(max, String(row[index] ?? "").replace(/[\r\n]+/g, " ").length), 0);
  return Math.min(42, Math.max(fallback, Math.ceil(longest * 1.35)));
}

function styleWorksheet(sheet: XLSX.WorkSheet, spec: WorkbookSheet) {
  const headerRows = Math.max(1, spec.headerRows ?? 1);
  const maxColumns = spec.rows.reduce((max, row) => Math.max(max, row.length), 0);
  const wrapColumns = new Set(spec.wrapColumns || []);
  const hyperlinkColumns = new Set(spec.hyperlinkColumns || []);
  const columnCount = Math.max(1, maxColumns);
  sheet["!cols"] = Array.from({ length: columnCount }, (_, index) => ({ wch: spec.widths?.[index] || columnWidth(spec.rows, index) }));
  // Keep detailed evidence readable: Excel can auto-size wrapped body rows instead of clipping them.
  sheet["!rows"] = spec.rows.map((_, index) => (index < headerRows ? { hpt: 28 } : {}));
  sheet["!autofilter"] = spec.rows.length > headerRows ? { ref: `A${headerRows}:${XLSX.utils.encode_col(columnCount - 1)}${spec.rows.length}` } : undefined;
  sheet["!freeze"] = { xSplit: 0, ySplit: headerRows, topLeftCell: `A${headerRows + 1}`, activePane: "bottomLeft", state: "frozen" };

  for (let rowIndex = 0; rowIndex < spec.rows.length; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      const cell = sheet[address];
      if (!cell) continue;
      cell.s = rowIndex < headerRows
        ? HEADER_STYLE
        : {
            ...CELL_STYLE,
            fill: { fgColor: { rgb: rowIndex % 2 === 0 ? "F7FAFC" : "FFFFFF" } },
            alignment: { vertical: "top", wrapText: wrapColumns.has(columnIndex) },
          };
      if (rowIndex >= headerRows && hyperlinkColumns.has(columnIndex) && typeof cell.v === "string" && /^https?:\/\//i.test(cell.v.trim())) {
        cell.l = { Target: cell.v.trim(), Tooltip: "点击打开链接" };
        cell.s = { ...cell.s, font: { color: { rgb: "0563C1" }, underline: true } };
      }
    }
  }
}

export function createWorkbookFile(inputSheets: WorkbookSheet[]) {
  const book = XLSX.utils.book_new();
  inputSheets.forEach((spec, index) => {
    const rows = spec.rows.length ? spec.rows : [["暂无数据"]];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    styleWorksheet(sheet, { ...spec, rows });
    XLSX.utils.book_append_sheet(book, sheet, safeSheetName(spec.name, index));
  });
  return XLSX.write(book, { bookType: "xlsx", type: "array", compression: true }) as ArrayBuffer;
}

export function workbookResponse(filename: string, inputSheets: WorkbookSheet[]) {
  const normalized = filename.toLowerCase().endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  return new Response(createWorkbookFile(inputSheets), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(normalized)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

export function downloadWorkbook(filename: string, inputSheets: WorkbookSheet[]) {
  const blob = new Blob([createWorkbookFile(inputSheets)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename.toLowerCase().endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  link.click();
  URL.revokeObjectURL(href);
}
