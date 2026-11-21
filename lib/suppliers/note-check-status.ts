export const SUPPLIER_NOTE_CHECK_STATUSES = [
  "NUMBER_PENDING", "PHOTO_MISSING", "AMOUNT_PENDING", "AMOUNT_MISMATCH", "MATCHED", "NEEDS_ATTENTION",
] as const;

export type SupplierNoteCheckStatus = (typeof SUPPLIER_NOTE_CHECK_STATUSES)[number];

export const SUPPLIER_NOTE_CHECK_LABELS: Record<SupplierNoteCheckStatus, string> = {
  NUMBER_PENDING: "待补送货单号",
  PHOTO_MISSING: "缺纸单图片",
  AMOUNT_PENDING: "待录纸单金额",
  AMOUNT_MISMATCH: "纸单金额与应付不符",
  MATCHED: "已核对 · 金额一致",
  NEEDS_ATTENTION: "任一待核事项",
};

export function isSupplierNoteCheckStatus(value: string): value is SupplierNoteCheckStatus {
  return (SUPPLIER_NOTE_CHECK_STATUSES as readonly string[]).includes(value);
}

export function checkStatusRequiresDocuments(value: SupplierNoteCheckStatus): boolean {
  return value === "PHOTO_MISSING" || value === "MATCHED" || value === "NEEDS_ATTENTION";
}
