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
const screeningResults = read("components/ai-screening/results-view.tsx");
const screeningResultsRoute = read("app/api/ai/results/route.ts");
assert.doesNotMatch(screeningResults, /<option value="REVIEW">需人工复核<\/option>/, "仅展示已完成分析的结果列表不得提供永远无匹配结果的复核状态选项");
assert.match(screeningResultsRoute, /dashboardBusinessDateKey\(new Date\(\)\)[\s\S]*todayStart[\s\S]*todayEnd[\s\S]*query\.gte\("completed_at", todayStart\)\.lt\("completed_at", todayEnd\)/, "今日分析结果必须按北京时间完整自然日过滤，且与统计使用相同边界");
assert.match(screeningResultsRoute, /if \(grade && !\["A", "B", "C", "D"\]\.includes\(grade\)\)[\s\S]*status: 400/, "筛选值不受支持时必须明确报错，不能静默忽略条件");
assert.match(read("app/api/ai/tasks/route.ts"), /if \(from\) query = query\.gte\("created_at", `\$\{from\}T00:00:00\.000\+08:00`\)[\s\S]*if \(to\) query = query\.lte\("created_at", `\$\{to\}T23:59:59\.999\+08:00`\)/, "AI筛选任务的创建日期必须按北京时间筛选");
assert.match(read("app/api/ai/customers/route.ts"), /fromTimestamp = from \? Date\.parse\(`\$\{from\}T00:00:00\.000\+08:00`\)[\s\S]*toTimestamp = to \? Date\.parse\(`\$\{to\}T23:59:59\.999\+08:00`\)[\s\S]*createdAt = Date\.parse/, "AI待筛选客户的创建日期必须按真实时间戳与北京时间区间比较");
assert.match(read("app/api/admin/customer-assignments/route.ts"), /dateFrom\) query = query\.gte\("created_at", `\$\{dateFrom\}T00:00:00\.000\+08:00`\)[\s\S]*dateTo\) query = query\.lte\("created_at", `\$\{dateTo\}T23:59:59\.999\+08:00`\)/, "客户分配历史的日期筛选必须按北京时间匹配界面显示的日期");
assert.match(read("components/ui/app-pagination.tsx"), /STANDARD_PAGE_SIZES = \[10, 20, 50, 100, 300, 500\]/, "通用列表分页必须统一为六档");
assert.match(read("components/ai-screening/ui.tsx"), /pageSizes = \[10, 20, 50, 100, 300, 500\]/, "AI筛选分页必须使用相同六档");
for (const path of [
  "app/api/admin/users/route.ts", "app/api/admin/audit/route.ts", "app/api/ai/results/route.ts",
  "app/api/customers/public-pool/route.ts", "app/api/followups/route.ts", "app/api/notifications/route.ts",
  "app/api/orders/route.ts", "app/api/product-imports/route.ts", "app/api/products/route.ts",
  "app/api/quotes/route.ts", "app/api/stock-orders/route.ts",
]) {
  assert.match(read(path), /(?:Math\.min\(\s*500,|exportMode \? 200 : 500|\[10, 20, 50, 100, 300, 500\]\.includes\(requestedPageSize\))/, `${path} 必须允许普通列表每页读取500条`);
}
assert.match(read("components/admin-settings-panels.tsx"), /pageSize:String\(pageSize\)[\s\S]*pageSize=\{pageSize\} total=\{count\} itemLabel="个用户"/, "用户列表分页选项必须真实传给服务端");
assert.match(read("components/customer-public-pool-view.tsx"), /const selectable = true[\s\S]*onChange=\{togglePage\}/, "有公海查看权限的用户均可跨页勾选客户");
assert.match(read("app/layout.tsx"), /智客云｜AI精准获客，让销售更快成交/, "浏览器默认标题必须精炼表达精准获客和加速成交的销售价值");
assert.match(read("app/login/page.tsx"), /AI智能获客 · 精准筛选/, "登录页品牌副标必须与系统核心定位一致");
assert.doesNotMatch(read("app/login/page.tsx"), /AI 客户分析与销售转化平台/, "登录页不得继续显示旧品牌副标");
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
const aiUsageCenter = read("components/ai-usage-center.tsx");
assert.match(aiUsageCenter, /aria-label="业务类型"[\s\S]*business_type=\$\{event\.target\.value\}[\s\S]*businessTypeControl=\{businessTypeControl\}/, "AI用量页必须把AI筛选和AI获客合并为筛选区内的业务类型选项");
assert.doesNotMatch(aiUsageCenter, /AppTabs|AI用量业务类型/, "AI用量页不得继续用大型子页签分割两类用量报表");
assert.match(read("app/ai-usage/page.tsx"), /params\.business_type \|\| params\.module/, "统一AI用量页必须兼容历史module链接并优先使用业务类型参数");
assert.match(read("components/ai-screening/usage-view.tsx"), /businessTypeControl[\s\S]*CompactDateRange label="分析日期"[\s\S]*\{businessTypeControl\}[\s\S]*模型/, "AI筛选用量必须在同一筛选栏展示业务类型和分析日期");
assert.match(read("components/ai-acquisition/usage-view.tsx"), /businessTypeControl[\s\S]*CompactDateRange label="用量日期"[\s\S]*\{businessTypeControl\}[\s\S]*任务状态/, "AI获客用量必须在同一筛选栏展示业务类型和用量日期");
const compactDateRange = read("components/ui/compact-date-range.tsx");
assert.match(compactDateRange, /CalendarRange[\s\S]*<span[^>]*>\{label\}<\/span>[\s\S]*type="date"[\s\S]*max=\{to \|\| undefined\}[\s\S]*type="date"[\s\S]*min=\{from \|\| undefined\}/, "日期范围必须共用带简短业务名称的紧凑控件并约束起止日期");
assert.match(read("components/ai-acquisition/usage-view.tsx"), /xl:grid-cols-\[1\.2fr_\.65fr_\.75fr_\.75fr_\.9fr_auto\]/, "AI获客切换后必须保持与AI筛选相同的筛选栏网格和页面宽度");
assert.match(read("components/ai-screening/usage-view.tsx"), /xl:grid-cols-\[1\.2fr_\.65fr_\.75fr_\.75fr_\.9fr_auto\]/, "AI筛选必须使用统一用量页筛选栏网格");
assert.match(read("components/customers-view.tsx"), /AppTabs[\s\S]*我的客户[\s\S]*保护到期与续期[\s\S]*冲突客户/, "我的客户与客户公海必须复用统一子页签组件");
assert.match(read("components/ui/app-tabs.tsx"), /description\?: string[\s\S]*bg-blue-50[\s\S]*bottom-0/, "统一子页签必须用浅色激活态、业务说明和清晰指示条");
assert.match(read("components/customers-view.tsx"), /保护到期与续期[\s\S]*countTone: "warning"[\s\S]*冲突客户[\s\S]*countTone: "danger"/, "保护到期与冲突数量必须使用不同的语义颜色");
assert.match(read("components/ui/app-tabs.tsx"), /countTone\?: "success" \| "warning" \| "danger"[\s\S]*bg-rose-50[\s\S]*bg-amber-50[\s\S]*bg-emerald-50/, "统一子页签必须支持成功、冲突和预警语义数量徽标");
assert.match(read("components/customers-view.tsx"), /label: "我的客户"[\s\S]*count: totalCustomerCount[\s\S]*countTone: "success"/, "我的客户总数必须移入页签并以绿色显示");
assert.match(read("components/customer-public-pool-view.tsx"), /tabCounts[\s\S]*counts=1[\s\S]*countTone/, "客户公海有数据列表的子页签必须显示语义颜色数量");
assert.match(read("components/customer-public-pool-view.tsx"), /available:\s*\["company_name",\s*"country",\s*"ai_score",\s*"phone"/, "待认领客户默认列表应按客户、国家、AI评分排列，且不得重复展示所属行业");
for (const path of ["components/customers-view.tsx", "components/customer-public-pool-view.tsx", "components/ai-acquisition/customer-results.tsx", "components/ai-acquisition/task-detail.tsx"]) {
  assert.match(read(path), /联系号码[\s\S]*邮箱|key === "phone"[\s\S]*display="phone"[\s\S]*key === "email"[\s\S]*display="email"/, `${path} 的客户列表必须将联系号码和邮箱分列展示`);
}
assert.match(read("components/customer-public-pool-view.tsx"), /sticky right-0[\s\S]*>操作</, "客户公海操作列必须固定在右侧");
assert.match(read("components/customer-public-pool-view.tsx"), /CustomerPublicLink[\s\S]*kind="website"[\s\S]*CustomerPublicChannels/, "客户公海官网与公开渠道必须复用统一入口组件");
assert.match(read("components/customers-view.tsx"), /CustomerPublicLink[\s\S]*kind="website"[\s\S]*CustomerPublicChannels/, "我的客户公开渠道图标必须与客户公海统一");
assert.match(read("components/ui/customer-public-link.tsx"), /iconOnly[\s\S]*WebsiteIcon size=\{iconOnly \|\| normal \? 16 : 14\}[\s\S]*GoogleMapsIcon size=\{iconOnly \|\| normal \? 16 : 14\}[\s\S]*!iconOnly[\s\S]*domainLabel/, "统一公开入口必须支持紧凑官方图标，并在普通模式保留可读域名");
assert.match(read("components/ui/google-maps-icon.tsx"), /#4285F4[\s\S]*#EA4335[\s\S]*#FBBC04[\s\S]*#34A853/, "Google Maps 链接必须使用四色定位标识");
assert.match(read("components/customer-public-pool-view.tsx"), /selectAllResults[\s\S]*全选筛选结果[\s\S]*分配已选[\s\S]*删除已选/, "客户公海可操作列表必须在统一工具栏提供全选筛选结果和批量操作");
assert.match(read("components/import-view.tsx"), /publicPoolMatches[\s\S]*条客户已存在于客户公海[\s\S]*前往客户公海认领/, "我的客户导入命中公海客户后必须提供醒目的认领引导");
assert.doesNotMatch(read("components/customer-public-pool-view.tsx"), /mt-3 flex justify-end gap-2[\s\S]*分配已选/, "客户公海批量操作不得独占一行造成工具栏错位");
assert.match(read("components/app-shell.tsx"), /fromPool[\s\S]*href === "\/customers\/pool"/, "从公海进入客户详情后必须保持客户公海菜单选中");
assert.match(read("components/app-shell.tsx"), /AI获客 \/ 任务中心[\s\S]*AI获客 \/ 创建任务[\s\S]*AI获客 \/ 获客设置/, "AI获客面包屑必须统一为模块与当前页面两级结构");
assert.match(read("components/app-shell.tsx"), /href === "\/ai-acquisition"[\s\S]*path !== "\/ai-acquisition\/customers"/, "获客结果页不得同时高亮AI获客任务中心菜单");
assert.match(read("components/app-shell.tsx"), /AI筛选 \/ 任务中心[\s\S]*AI筛选 \/ 创建任务[\s\S]*AI筛选 \/ 筛选设置[\s\S]*AI筛选 \/ 分析规则/, "AI筛选面包屑必须统一为模块与当前页面两级结构");
assert.doesNotMatch(read("components/app-shell.tsx"), /AI筛选 \/ 任务中心 \/|AI筛选 \/ 任务详情 \/|AI获客 \/ 任务中心 \//, "AI模块面包屑不得混用三级层级");
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

const searchableFilter = read("components/ui/searchable-multi-select-filter.tsx");
assert.match(searchableFilter, /item\.label \|\| item\.value}[\s\S]*item\.value/, "国家和行业多选必须同时支持展示名称与原始代码搜索");
assert.match(searchableFilter, /createPortal\(dropdown, document\.body\)/, "统一国家和行业下拉必须通过页面级浮层显示，不能被单行筛选栏或表格容器裁切");
assert.match(searchableFilter, /role="listbox"[\s\S]*aria-haspopup="listbox"[\s\S]*aria-expanded=\{open\}/, "统一国家和行业筛选必须保留明确的展开状态和列表语义");
for (const path of [
  "components/customers-view.tsx",
  "components/customer-public-pool-view.tsx",
  "components/ai-acquisition/customer-results.tsx",
  "components/ai-acquisition/task-center.tsx",
  "components/ai-acquisition/task-detail.tsx",
  "components/ai-screening/task-detail-view.tsx",
]) {
  assert.match(read(path), /SearchableMultiSelectFilter/, `${path} 的国家或所属行业必须使用统一可搜索多选控件`);
}
for (const path of [
  "components/customers-view.tsx",
  "components/customer-public-pool-view.tsx",
  "components/ai-acquisition/customer-results.tsx",
  "components/ai-acquisition/task-center.tsx",
  "components/ai-screening/task-detail-view.tsx",
]) {
  assert.match(read(path), /countryInfo/, `${path} 必须兼容国家代码、中文名称和历史国家值`);
}

const globalStyles = read("app/globals.css");
assert.match(globalStyles, /\.crm-content table th \{[^}]*vertical-align:middle/, "系统所有数据表表头必须统一垂直居中");
assert.match(globalStyles, /\.crm-content table td \{[^}]*vertical-align:middle/, "系统所有数据表单元格必须统一垂直居中");
assert.match(globalStyles, /td:last-child:has\([^}]*text-align:center/, "系统数据表操作单元格必须统一居中");
assert.match(globalStyles, /td:last-child > button,[\s\S]*min-height:32px/, "系统数据表操作按钮必须统一使用适中的紧凑高度");
const publicPool = read("components/customer-public-pool-view.tsx");
const quotesView = read("components/quotes-view.tsx");
assert.match(quotesView, /placeholder="搜索报价编号或公司简称"/, "历史报价搜索提示必须准确说明按公司简称检索");
assert.match(quotesView, /\["报价编号","公司简称","状态"/, "历史报价列表必须将简称字段展示为公司简称");
assert.doesNotMatch(quotesView, /客户简称/, "历史报价列表不得继续显示旧称客户简称");
assert.match(read("components/quote-form.tsx"), /<Field label="公司简称">/, "历史报价编辑必须保留简称含义并使用公司称谓");
assert.match(read("components/warehouse-dashboard.tsx"), /"订单编号", "客户名称", "公司名称"/, "仓库看板必须优先展示客户对接人，并明确区分公司名称");
for (const path of [
  "components/customers-view.tsx",
  "components/orders-view.tsx",
  "components/stock-orders-view.tsx",
  "components/quotes-view.tsx",
  "components/ai-screening/results-view.tsx",
]) {
  assert.match(read(path), /requestVersion\s*!==\s*listRequestVersion\.current/, `${path} 必须忽略过期筛选请求的返回`);
}
assert.match(publicPool, /function changeTab\(value: Tab\) \{[\s\S]*?setAiStatus\("all"\)/, "公海页签切换必须清除不适用的 AI 分析状态条件");
assert.match(publicPool, /\{tab !== "available" \? <select[\s\S]*?aria-label="AI分析状态"/, "待认领页不得显示必然为空的未分析或分析失败选项");
assert.match(publicPool, /w-36[^>]*text-center[^>]*>操作/, "客户公海操作列必须预留一致宽度并居中");
assert.match(publicPool, /grid h-8 w-8 shrink-0 place-items-center/, "客户公海详情操作必须使用紧凑的等宽图标按钮");
assert.match(publicPool, /aria-label=\{`查看\$\{row\.company_name\}详情`}/, "客户公海详情图标必须保留可访问名称");
assert.match(publicPool, /flex items-center justify-center gap-2 whitespace-nowrap/, "客户公海行操作必须统一居中排列");
const appShell = read("components/app-shell.tsx");
assert.match(appShell, /const effectiveWidth = collapsed \? 76 : 232;/, "侧栏展开宽度应固定为协调的 232px，刷新不应改变布局");
assert.match(appShell, /min-h-screen w-full min-w-0 overflow-x-clip/, "主内容横向溢出不得把应用壳层和左侧菜单推出视口");
assert.doesNotMatch(appShell, /dtsmart-sidebar-width|cursor-col-resize/, "侧栏宽度不得受旧浏览器缓存或拖拽状态影响");

console.log("统一弹框、分页和客户阶段交互回归测试通过。");
