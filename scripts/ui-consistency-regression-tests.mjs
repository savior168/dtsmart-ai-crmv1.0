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
assert.match(read("components/customer-crm-detail-view.tsx"), /AppDialog[\s\S]*变更客户阶段/, "客户阶段必须使用统一弹框单条修改");
assert.match(read("components/customer-crm-detail-view.tsx"), /跟进后状态：保持当前/, "跟进状态必须合并到单条跟进记录入口");
assert.match(read("components/ai-screening/ui.tsx"), /AppPagination[\s\S]*SharedConfirmDialog/, "AI筛选必须复用统一分页和确认弹框");
assert.match(read("components/customers-view.tsx"), /AppTabs[\s\S]*我的客户[\s\S]*保护到期与续期[\s\S]*冲突客户/, "我的客户与客户公海必须复用统一子页签组件");
assert.match(read("components/ui/app-tabs.tsx"), /description\?: string[\s\S]*bg-blue-50[\s\S]*bottom-0/, "统一子页签必须用浅色激活态、业务说明和清晰指示条");
assert.match(read("components/customers-view.tsx"), /保护到期与续期[\s\S]*countTone: "warning"[\s\S]*冲突客户[\s\S]*countTone: "danger"/, "保护到期与冲突数量必须使用不同的语义颜色");
assert.match(read("components/ui/app-tabs.tsx"), /countTone\?: "success" \| "warning" \| "danger"[\s\S]*bg-rose-50[\s\S]*bg-amber-50[\s\S]*bg-emerald-50/, "统一子页签必须支持成功、冲突和预警语义数量徽标");
assert.match(read("components/customers-view.tsx"), /label: "我的客户"[\s\S]*count: totalCustomerCount[\s\S]*countTone: "success"/, "我的客户总数必须移入页签并以绿色显示");
assert.match(read("components/customer-public-pool-view.tsx"), /tabCounts[\s\S]*counts=1[\s\S]*countTone/, "客户公海有数据列表的子页签必须显示语义颜色数量");
assert.match(read("components/customer-public-pool-view.tsx"), /available:\s*\["company_name",\s*"ai_score",\s*"industry",\s*"country"[\s\S]*customerIndustryDisplay\(row\)/, "待认领客户必须按销售优先级将所属行业作为独立默认字段显示");
assert.match(read("components/customer-public-pool-view.tsx"), /sticky right-0[\s\S]*>操作</, "客户公海操作列必须固定在右侧");
assert.match(read("components/customer-public-pool-view.tsx"), /CustomerPublicLink[\s\S]*kind="website"[\s\S]*CustomerPublicLink[\s\S]*kind="map"/, "客户公海官网与 Google Maps 必须复用统一入口组件");
assert.match(read("components/customers-view.tsx"), /CustomerPublicLink[\s\S]*kind="website"[\s\S]*CustomerPublicLink[\s\S]*kind="map"/, "我的客户 Google Maps 图标必须与客户公海统一");
assert.match(read("components/ui/customer-public-link.tsx"), /WebsiteIcon size=\{14\}[\s\S]*GoogleMapsIcon size=\{14\}[\s\S]*domainLabel/, "统一公开入口必须保留官方图标和可读域名");
assert.match(read("components/ui/google-maps-icon.tsx"), /#4285F4[\s\S]*#EA4335[\s\S]*#FBBC04[\s\S]*#34A853/, "Google Maps 链接必须使用四色定位标识");
assert.match(read("components/customer-public-pool-view.tsx"), /selectAllResults[\s\S]*全选筛选结果[\s\S]*分配已选[\s\S]*删除已选/, "客户公海可操作列表必须在统一工具栏提供全选筛选结果和批量操作");
assert.match(read("components/import-view.tsx"), /publicPoolMatches[\s\S]*条客户已存在于客户公海[\s\S]*前往客户公海认领/, "我的客户导入命中公海客户后必须提供醒目的认领引导");
assert.doesNotMatch(read("components/customer-public-pool-view.tsx"), /mt-3 flex justify-end gap-2[\s\S]*分配已选/, "客户公海批量操作不得独占一行造成工具栏错位");
assert.match(read("components/app-shell.tsx"), /fromPool[\s\S]*href === "\/customers\/pool"/, "从公海进入客户详情后必须保持客户公海菜单选中");
for (const path of ["components/orders-view.tsx", "components/quotes-view.tsx", "components/stock-orders-view.tsx", "components/followups-view.tsx"]) {
  assert.match(read(path), /sticky right-0[\s\S]*>操作</, `${path} 的操作列必须固定在右侧`);
}
assert.doesNotMatch(read("components/followups-view.tsx"), /进入客户库/, "跟进管理不得显示含义重复的进入客户库按钮");
assert.match(read("components/customers-view.tsx"), /selected\.size >= count \? "取消全选" : "全选筛选结果"/, "我的客户跨页全选与取消必须合并为同一按钮");
assert.match(read("components/customers-view.tsx"), /w-44[\s\S]*min-w-44[\s\S]*RowActionMenu[\s\S]*新增跟进[\s\S]*更新客户阶段/, "我的客户操作列必须预留安全边距，并将高频详情与低频操作分层展示");
assert.match(read("components/customer-public-pool-view.tsx"), /row\.can_claim[\s\S]*>认领<\//, "客户公海的高频认领操作必须直接展示，不得折叠到更多操作");
assert.match(read("components/ui/row-action-menu.tsx"), /closeOnOutside[\s\S]*closeOnEscape[\s\S]*title="更多操作"/, "更多操作菜单必须支持点击、点击外部和 Escape 关闭");
assert.match(read("components/ui/row-action-menu.tsx"), /createPortal[\s\S]*fixed z-\[100\][\s\S]*document\.body/, "更多操作菜单必须挂载到页面浮层，不能被表格滚动容器裁切");
assert.match(read("components/ui/row-action-menu.tsx"), /window\.addEventListener\("scroll", placeMenu, true\)[\s\S]*openUpward/, "更多操作菜单必须随表格滚动重新定位并自动避开页面边界");
assert.match(read("components/ui/row-action-menu.tsx"), /<button[\s\S]*>\{children\}<\/button>/, "更多操作菜单项必须渲染明确的操作文字");
assert.match(read("components/cost-center-view.tsx"), /billingDetailsOpen[\s\S]*查看明细[\s\S]*Google Places SKU明细[\s\S]*OpenAI费用明细/, "平台真实账单必须使用一个统一入口展开两个平台明细");
assert.match(read("components/customer-crm-detail-view.tsx"), /归属与跟进历程[\s\S]*当前归属[\s\S]*曾跟进/, "客户详情必须集中展示当前归属和历史跟进人员");
assert.match(read("app/api/customers/\[id\]/crm/route.ts"), /current_owner:[\s\S]*claims: displayClaims/, "客户详情接口必须返回当前归属和可读的归属变更记录");
assert.match(read("components/customer-public-pool-view.tsx"), /selected\.size >= \(count \?\? 0\) \? "取消全选" : "全选筛选结果"/, "客户公海跨页全选与取消必须合并为同一按钮");
assert.doesNotMatch(read("components/customer-public-pool-view.tsx"), />取消全选<\/button>/, "客户公海不得额外堆叠独立取消全选按钮");
assert.match(read("components/customer-public-pool-view.tsx"), /flex flex-wrap items-end gap-3[\s\S]*重置/, "客户公海主筛选行必须在空间不足时按完整控件自动换行");
assert.match(read("components/customer-public-pool-view.tsx"), /已按 \{screeningTaskIds\.length\} 个 AI 筛选批次加载当前/, "客户公海按AI筛选批次加载后必须明确显示当前页签实际加载数量");
assert.doesNotMatch(read("components/customer-public-pool-view.tsx"), /flex min-w-max items-(?:end|center) gap-3 overflow-x-auto/, "客户公海筛选条件不得强制横向溢出");
const customerPanels = read("components/customer-workspace-panels-v2.tsx");
assert.doesNotMatch(customerPanels, /flex min-w-max items-center gap-3 overflow-x-auto/, "客户续期和冲突列表筛选条件不得强制横向溢出");
assert.match(customerPanels, /setReleaseType\(""\)[\s\S]*>重置<\/button>/, "保护到期与续期必须提供可一次清空全部条件的重置按钮");
assert.match(customerPanels, /setSource\(""\)[\s\S]*>重置<\/button>/, "冲突客户必须提供可一次清空全部条件的重置按钮");
assert.match(customerPanels, /downloadCustomers[\s\S]*客户保护与续期[\s\S]*冲突客户/, "客户保护和冲突列表导出必须采用完整客户字段且只导出当前筛选结果");
assert.match(customerPanels, /protectionColumns[\s\S]*changeSort[\s\S]*conflictColumns[\s\S]*changeSort/, "保护到期和冲突客户列表的业务数据列必须支持正倒序排序");
assert.doesNotMatch(customerPanels, /RefreshCw|>刷新<\//, "保护到期与冲突客户筛选区不得用刷新按钮代替重置");

const aiTaskCenter = read("components/ai-screening/task-center-view.tsx");
const aiTaskApi = read("app/api/ai/tasks/route.ts");
assert.match(aiTaskCenter, /"OpenAI费用","Google调用"/, "AI筛选任务列表必须将OpenAI费用与Google调用次数分开展示");
assert.doesNotMatch(aiTaskCenter, /"第三方费用"/, "AI筛选任务列表不得把Google价目估算贸然计入第三方费用");
assert.match(aiTaskCenter, /formatNumber\(task\.google_places_call_count\).*次/, "AI筛选任务列表必须展示每个任务的Google Places真实调用次数");
assert.match(aiTaskApi, /openai_cost_usd:\s*Number\(task\.total_cost_usd \|\| 0\)/, "AI筛选任务接口必须单独返回OpenAI费用");
assert.match(aiTaskApi, /google_places_call_count:\s*googleCallsByTask/, "AI筛选任务接口必须单独返回Google Places调用次数");
assert.doesNotMatch(aiTaskApi, /third_party_cost_usd:/, "AI筛选任务接口不得返回混入Google估算金额的第三方费用");

console.log("统一弹框、分页和客户阶段交互回归测试通过。");
