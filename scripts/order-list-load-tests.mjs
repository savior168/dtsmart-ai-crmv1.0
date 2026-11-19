import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const scope = read("components/user-scope-select.tsx");
const orders = read("components/orders-view.tsx");
const stock = read("components/stock-orders-view.tsx");
const stockPage = read("app/stock-orders/page.tsx");
const ordersPage = read("app/orders/page.tsx");

assert.match(scope, /preserveImplicitDefault[\s\S]*!preserveImplicitDefault[\s\S]*onChangeRef\.current/, "implicit server scope must not trigger a second initial list request");
for (const view of [orders, stock]) {
  assert.match(view, /kind="sales_owner"[^\n]*preserveImplicitDefault/);
  assert.match(view, /kind="pi_creator"[^\n]*preserveImplicitDefault/);
  assert.match(view, /lastListRequestAt\.current\s*=\s*Date\.now\(\)/);
  assert.match(view, /Date\.now\(\)\s*-\s*lastListRequestAt\.current\s*>=\s*14000/);
  assert.match(view, /kind="sales_owner"[^\n]*reserveWhileLoading/);
  assert.match(view, /kind="pi_creator"[^\n]*reserveWhileLoading/);
}
assert.match(stockPage, /canFilterOwner=\{hasPermission\(account,"stock\.data_all"\)\}/);
assert.match(ordersPage, /initialCanFilterCreator=\{\["ADMIN","ORDER_CLERK"\]/);
assert.match(scope, /if \(!loaded\) return reserveWhileLoading \? <AppSelect[^\n]*disabled/, "authorized filter slots remain stable while choices load");
assert.match(read("app/ai-acquisition/page.tsx"), /initialShowOwner=\{hasPermission\(account,"ai\.acquisition\.data_all"\)\}/);
assert.match(read("app/ai-acquisition/customers/page.tsx"), /initialShowOwner=\{hasPermission\(account,"ai\.acquisition\.data_all"\)\}/);
assert.match(read("components/ai-acquisition/task-center.tsx"), /\[showOwner, setShowOwner\] = useState\(initialShowOwner\)/);
assert.match(read("components/ai-acquisition/customer-results.tsx"), /\[showOwner,setShowOwner\]=useState\(initialShowOwner\)/);
assert.match(read("components/supplier-reconciliation-view.tsx"), /sticky right-0 z-20[^\n]*>操作<\/th>[\s\S]*sticky right-0 z-10/, "reconciliation actions stay visible while scrolling horizontally");
console.log("PI and stock list load contracts passed");
