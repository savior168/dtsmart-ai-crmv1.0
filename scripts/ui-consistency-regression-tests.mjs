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
assert.match(read("components/customer-public-pool-view.tsx"), /available:\s*\["company_name",\s*"country",\s*"ai_score"[\s\S]*customerIndustryDisplay\(row\)/, "待认领客户必须在客户名称下统一显示行业并优先展示AI判断");
assert.match(read("components/customer-public-pool-view.tsx"), /sticky right-0[\s\S]*>操作</, "客户公海操作列必须固定在右侧");
assert.match(read("components/customer-public-pool-view.tsx"), /selectAllResults[\s\S]*全选筛选结果[\s\S]*分配已选[\s\S]*删除已选/, "客户公海可操作列表必须在统一工具栏提供全选筛选结果和批量操作");
assert.match(read("components/import-view.tsx"), /publicPoolMatches[\s\S]*条客户已存在于客户公海[\s\S]*前往客户公海认领/, "我的客户导入命中公海客户后必须提供醒目的认领引导");
assert.doesNotMatch(read("components/customer-public-pool-view.tsx"), /mt-3 flex justify-end gap-2[\s\S]*分配已选/, "客户公海批量操作不得独占一行造成工具栏错位");
assert.match(read("components/app-shell.tsx"), /fromPool[\s\S]*href === "\/customers\/pool"/, "从公海进入客户详情后必须保持客户公海菜单选中");
for (const path of ["components/orders-view.tsx", "components/quotes-view.tsx", "components/stock-orders-view.tsx", "components/followups-view.tsx"]) {
  assert.match(read(path), /sticky right-0[\s\S]*>操作</, `${path} 的操作列必须固定在右侧`);
}
assert.doesNotMatch(read("components/followups-view.tsx"), /进入客户库/, "跟进管理不得显示含义重复的进入客户库按钮");
assert.match(read("components/customers-view.tsx"), /selected\.size >= count \? "取消全选" : "全选筛选结果"/, "我的客户跨页全选与取消必须合并为同一按钮");
assert.match(read("components/customer-public-pool-view.tsx"), /selected\.size >= count \? "取消全选" : "全选筛选结果"/, "客户公海跨页全选与取消必须合并为同一按钮");
assert.doesNotMatch(read("components/customer-public-pool-view.tsx"), />取消全选<\/button>/, "客户公海不得额外堆叠独立取消全选按钮");

console.log("统一弹框、分页和客户阶段交互回归测试通过。");
