type Allocation = {
  pi_number?: string | null;
  system_pi_number?: string | null;
  product?: string | null;
  quantity?: number | null;
  unit_price_cny?: number | null;
  amount_cny?: number | null;
};

export type ReconciliationNote = {
  document_date: string;
  supplier_code: string;
  supplier_name?: string | null;
  note_number: string;
  paper_total_cny?: number | null;
  cash_paid_reported_cny?: number | null;
  allocated_cny: number;
  paid_cny: number;
  unpaid_cny: number;
  allocations?: Allocation[] | null;
  payments?: Array<{ paid_on: string; amount_cny: number; method: string; reference: string }> | null;
};

const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  const safe = typeof value !== "number" && (/^\s*[=+\-@]/.test(text) || /^[\t\r]/.test(text))
    ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function renderSupplierReconciliationCsv(notes: ReconciliationNote[]) {
  const rows: unknown[][] = [[
    "送货日期", "供应商代码", "供应商名称", "送货单号", "客户订单号", "系统PI编号",
    "产品", "回货数量", "采购单价(CNY)", "分配金额(CNY)", "纸单金额(CNY，仅首行)",
    "送货单应付(CNY，仅首行)", "现场报付待核(CNY，仅首行)", "财务已付(CNY，仅首行)", "送货单未付(CNY，仅首行)", "付款凭证与日期",
  ]];
  for (const note of notes) {
    const allocations = note.allocations?.length ? note.allocations : [null];
    for (const [index, allocation] of allocations.entries()) rows.push([
      note.document_date, note.supplier_code, note.supplier_name, note.note_number,
      allocation?.pi_number, allocation?.system_pi_number, allocation?.product,
      allocation?.quantity, allocation?.unit_price_cny, allocation?.amount_cny,
      index === 0 ? note.paper_total_cny : null,
      index === 0 ? note.allocated_cny : null,
      index === 0 ? note.cash_paid_reported_cny : null,
      index === 0 ? note.paid_cny : null,
      index === 0 ? note.unpaid_cny : null,
      index === 0 ? note.payments?.map((payment) => `${payment.paid_on} ${payment.method} ${payment.reference} ¥${payment.amount_cny}`)
        .join("；") || "" : "",
    ]);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
