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
assert.match(read("components/ui/app-tabs.tsx"), /description\?: string[\s\S]*bg-blue-50[\s\S]*bottom-0/, "统一子页签必须用浅色激活态、业务说明和清晰指示条");
assert.match(read("components/customers-view.tsx"), /保护到期与续期[\s\S]*countTone: "warning"[\s\S]*冲突客户[\s\S]*countTone: "danger"/, "保护到期与冲突数量必须使用不同的语义颜色");
assert.match(read("components/ui/app-tabs.tsx"), /countTone\?: "warning" \| "danger"[\s\S]*bg-rose-50[\s\S]*bg-amber-50/, "统一子页签必须支持冲突色和预警色数量徽标");
assert.match(read("components/customer-public-pool-view.tsx"), /available:\s*\["company_name",\s*"country",\s*"industry",\s*"ai_score"/, "待认领客户必须优先显示身份、行业和AI判断");
assert.match(read("components/customer-public-pool-view.tsx"), /sticky right-0[\s\S]*>操作</, "客户公海操作列必须固定在右侧");
assert.match(read("components/app-shell.tsx"), /fromPool[\s\S]*href === "\/customers\/pool"/, "从公海进入客户详情后必须保持客户公海菜单选中");

console.log("统一弹框、分页和客户阶段交互回归测试通过。");
