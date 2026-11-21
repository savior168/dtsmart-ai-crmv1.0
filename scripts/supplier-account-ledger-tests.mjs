import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync("supabase/migrations/20261121100000_supplier_account_ledger.sql", "utf8");
const api = readFileSync("app/api/supplier-reconciliation/account/route.ts", "utf8");
const report = readFileSync("app/api/supplier-reconciliation/route.ts", "utf8");
const ui = readFileSync("components/supplier-account-ledger.tsx", "utf8");

for (const table of ["supplier_account_openings", "supplier_account_adjustments", "supplier_account_payments", "supplier_account_payment_allocations"]) {
  assert.match(sql, new RegExp(`create table public\\.${table} \\(`));
  assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
}
assert.match(sql, /revoke all on public\.supplier_account_openings,public\.supplier_account_adjustments,[\s\S]*from public,anon,authenticated/);
assert.match(sql, /request_id uuid not null unique/);
assert.match(sql, /on conflict\(request_id\) do nothing returning \* into result/);
assert.match(sql, /if already_allocated\+p_amount_cny>payment\.amount_cny/);
assert.match(sql, /if note_paid\+p_amount_cny>note_due/);
assert.match(sql, /note\.supplier_id<>payment\.supplier_id/);
assert.match(sql, /where a\.delivery_note_id=p_delivery_note_id and a\.reversed_at is null/);
assert.match(sql, /create constraint trigger supplier_account_receipt_balance[\s\S]*deferrable initially deferred/);
assert.match(sql, /create constraint trigger supplier_account_packaging_balance[\s\S]*deferrable initially deferred/);
assert.match(sql, /create trigger supplier_payment_not_account_duplicate/);
assert.match(sql, /create function public.reverse_supplier_account_payment\([\s\S]*请先更正该付款关联的送货单分配，再撤销付款/);
assert.match(sql, /where p\.supplier_id=s\.id and p\.reversed_at is null/);
assert.match(sql, /supplier_account_payment_allocations a[\s\S]*a\.reversed_at is null[\s\S]*payments group by payments\.delivery_note_id/);
assert.match(sql, /coalesce\(o\.balance_cny,0\)\+coalesce\(due\.amount_cny,0\)\+coalesce\(adj\.amount_cny,0\)[\s\S]*-coalesce\(direct_paid\.amount_cny,0\)-coalesce\(account_paid\.amount_cny,0\)/);
assert.doesNotMatch(sql, /-coalesce\(account_paid\.amount_cny,0\)-coalesce\(account_allocated\.amount_cny,0\)/,
  "将总账付款分配至单据不得二次冲减供应商总余额");
assert.match(api, /requirePermission\("supplier\.reconciliation\.manage"\)/);
assert.match(api, /assertFinanceRole\(account\.role\)/);
assert.match(api, /confirmed_overlap: confirmed|body\.confirmed_overlap !== true/);
assert.match(api, /body\.confirmed_payment !== true/);
assert.match(api, /payment_page[\s\S]*payments\.count/);
assert.match(api, /for \(let offset = 0; paymentIds\.length; offset \+= 1000\)/);
assert.match(api, /action === "REVERSE_PAYMENT"[\s\S]*reverse_supplier_account_payment/);
assert.match(report, /accountPaymentsByNote\.get\(note\.id\)/);
assert.match(ui, /未分配付款降低供应商总欠款，但不代表具体送货单已结清/);
assert.match(ui, /供应商总账付款分配|分配到送货单/);

console.log("supplier account ledger contract tests passed");
