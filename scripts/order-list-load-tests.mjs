import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const scope = read("components/user-scope-select.tsx");
const orders = read("components/orders-view.tsx");
const stock = read("components/stock-orders-view.tsx");

assert.match(scope, /preserveImplicitDefault[\s\S]*!preserveImplicitDefault[\s\S]*onChangeRef\.current/, "implicit server scope must not trigger a second initial list request");
for (const view of [orders, stock]) {
  assert.match(view, /kind="sales_owner"[^\n]*preserveImplicitDefault/);
  assert.match(view, /kind="pi_creator"[^\n]*preserveImplicitDefault/);
  assert.match(view, /lastListRequestAt\.current\s*=\s*Date\.now\(\)/);
  assert.match(view, /Date\.now\(\)\s*-\s*lastListRequestAt\.current\s*>=\s*14000/);
}
console.log("PI and stock list load contracts passed");
