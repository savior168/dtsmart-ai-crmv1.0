import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseProductWorkbook } from "../lib/product-import.ts";

const sourcePath = process.argv[2];
if (!sourcePath) {
  console.error("用法: node --experimental-strip-types scripts/product-source-audit.mjs <原始报价表.xlsx>");
  process.exitCode = 2;
} else {
  const parsed = parseProductWorkbook(readFileSync(resolve(sourcePath)));
  const seen = new Set();
  const duplicateAddresses = [];
  for (const row of parsed.candidates) {
    const key = `${row.source_sheet}\u0000${row.source_row}\u0000${row.source_cell}`;
    if (seen.has(key)) duplicateAddresses.push(`${row.source_sheet}!${row.source_cell}`);
    seen.add(key);
  }
  const uncovered = parsed.sheets.filter((sheet) => sheet.mode === "MATRIX" || sheet.mode === "EMPTY");
  const statusCounts = parsed.candidates.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1;
    return counts;
  }, { VALID: 0, REVIEW: 0, ERROR: 0 });
  const summary = {
    workbook: resolve(sourcePath),
    sheet_count: parsed.sheets.length,
    source_nonempty_rows: parsed.sheets.reduce((sum, sheet) => sum + sheet.source_rows, 0),
    review_clues: parsed.candidates.length,
    candidate_status_counts: statusCounts,
    automatically_publishable_rows: statusCounts.VALID,
    review_clues_are_not_approved_products: statusCounts.VALID === 0,
    unparsed_positions: parsed.sheets.reduce((sum, sheet) => sum + (sheet.unparsed_cells || 0), 0),
    uncovered_sheets: uncovered.map((sheet) => sheet.name),
    duplicate_source_addresses: duplicateAddresses,
    sheets: parsed.sheets.map(({ name, mode, source_rows, candidates, unparsed_cells }) => ({
      name, mode, source_rows, review_clues: candidates, unparsed_positions: unparsed_cells || 0,
    })),
    full_source_reconciled: uncovered.length === 0
      && parsed.sheets.every((sheet) => !sheet.unparsed_cells)
      && duplicateAddresses.length === 0,
  };
  console.log(JSON.stringify(summary, null, 2));
}
