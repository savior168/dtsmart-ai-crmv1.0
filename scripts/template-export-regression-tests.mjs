import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import XLSX from "xlsx";
import { buildQuoteWorkbook, buildStockWorkbook } from "../lib/template-xlsx.ts";

const items = Array.from({ length: 12 }, (_, index) => ({
  item_name: `Screen ${index + 1}`,
  brand: "Brand",
  model: `M${index + 1}`,
  quality: "Original",
  description: "OLED display",
  description_zh: "屏幕",
  quantity: index + 1,
  unit_price: 10.5,
  procurement_cost: 6.25,
  preparation_requirement: "Label",
}));

const quoteBuffer = await buildQuoteWorkbook({
  quote_number: "PI-TEST-001",
  currency: "USD",
  valid_until: "2026-09-30",
  payment_method: "T/T",
  delivery_date: "2026-10-05",
  customer_short_name: "Demo",
  destination_country: "DE",
  stocking_requirements: "Pack",
  shipping_cost: 25,
  subtotal: 819,
  total_amount: 844,
  created_at: new Date().toISOString(),
  owner: { name: "Eva", email: "eva@example.com", phone: "8613800000000" },
  customer: { company_name: "Demo GmbH", contact_name: "Tom", phone: "491234567" },
}, items);

const stockBuffer = await buildStockWorkbook({
  stock_number: "BH-TEST-001",
  order_number: "ORDER-TEST-001",
  quote_number: "PI-TEST-001",
  customer_short_name: "Demo",
  destination_country: "DE",
  stocking_requirements: "Pack",
  status_note: "",
  created_at: new Date().toISOString(),
  salesperson: { name: "Eva", email: "eva@example.com" },
}, items);

function firstSheet(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellFormula: true, cellStyles: true });
  return workbook.Sheets[workbook.SheetNames[0]];
}

function containsMedia(buffer) {
  const archive = XLSX.CFB.read(buffer, { type: "buffer" });
  return archive.FullPaths.some((entry) => entry.includes("/xl/media/"));
}

const quote = firstSheet(quoteBuffer);
assert.equal(quote.J2.v, "PI-TEST-001");
assert.equal(quote.B19.v, "Screen 1");
assert.equal(quote.B30.v, "Screen 12");
assert.equal(quote.K19.f, 'IF(OR(I19="",J19=""),"",ROUND(I19*J19,2))');
assert.equal(quote.K30.f, 'IF(OR(I30="",J30=""),"",ROUND(I30*J30,2))');
assert.equal(quote.J31.f, "SUM(J19:J30)");
assert.equal(quote.K31.f, "SUM(K19:K30)");
assert.equal(quote.K33.f, "K31+K32");
assert.ok(quote.B19.s, "报价产品行样式必须保留");
assert.ok(containsMedia(quoteBuffer), "报价单必须保留企业 Logo");

const stock = firstSheet(stockBuffer);
assert.equal(stock.G3.v, "ORDER-TEST-001");
assert.equal(stock.C13.v, "Screen 1");
assert.equal(stock.C24.v, "Screen 12");
assert.equal(stock.B11.f, "SUM(K13:K999)");
assert.equal(stock.J11.f, "SUMPRODUCT(J13:J999,K13:K999)");
assert.ok(stock.C13.s, "备货产品行样式必须保留");

await mkdir(".tmp", { recursive: true });
await writeFile(".tmp/quote-template-regression.xlsx", quoteBuffer);
await writeFile(".tmp/stock-template-regression.xlsx", stockBuffer);
console.log("报价单与备货单模板导出回归测试通过。");
