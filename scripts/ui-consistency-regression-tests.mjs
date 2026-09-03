import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const root = process.cwd();
const sourceRoots = ["app", "components", "lib"];
const sourceFiles = [];

function collect(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) collect(path);
    else if ([".ts", ".tsx", ".js", ".jsx"].includes(extname(path))) sourceFiles.push(path);
  }
}

for (const directory of sourceRoots) collect(resolve(root, directory));

const nativeDialog = /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/;
const offenders = sourceFiles.filter((path) => nativeDialog.test(readFileSync(path, "utf8")));
assert.deepEqual(offenders, [], `禁止使用浏览器原生弹框：${offenders.join(", ")}`);

const read = (path) => readFileSync(resolve(root, path), "utf8");
for (const path of [
  "components/orders-view.tsx",
  "components/quotes-view.tsx",
  "components/stock-orders-view.tsx",
  "components/followups-view.tsx",
  "components/cost-center-view.tsx",
  "components/customer-public-pool-view.tsx",
]) {
  assert.match(read(path), /AppPagination/, `${path} 必须使用统一分页组件`);
}

assert.match(read("components/quote-form.tsx"), /AppDialog[\s\S]*记录客户确认并创建订单/, "报价确认必须使用统一弹框");
assert.match(read("components/customer-crm-detail-view.tsx"), /AppDialog[\s\S]*变更客户阶段[\s\S]*变更跟进状态/, "客户阶段和跟进状态必须使用统一弹框单条修改");
assert.match(read("components/ai-screening/ui.tsx"), /AppPagination[\s\S]*SharedConfirmDialog/, "AI筛选必须复用统一分页和确认弹框");
assert.match(read("components/customers-view.tsx"), /AppTabs[\s\S]*我的客户[\s\S]*保护到期与续期[\s\S]*冲突客户/, "我的客户与客户公海必须复用统一子页签组件");

console.log("统一弹框、分页和客户阶段交互回归测试通过。");
