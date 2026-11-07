import type { UserRole } from "@/lib/auth/permissions";

export type ReleaseCommit = {
  sha: string;
  message: string;
  url: string;
  deployedAt: string;
  files: string[];
  deploymentUrl: string;
  affectedRoles: UserRole[] | ["ALL"];
  category: ReleaseCommitCategory;
};

export type ReleaseCategory = "ALL" | "FEATURE" | "BUG_FIX" | "OPTIMIZATION" | "MAINTENANCE" | "SECURITY" | "GENERAL";
export type ReleaseCommitCategory = Exclude<ReleaseCategory, "ALL">;

export const RELEASE_CATEGORIES: Record<ReleaseCategory, { label: string; title: string; icon: string }> = {
  ALL: { label: "全部类型", title: "正式发布变更摘要", icon: "📋" },
  FEATURE: { label: "功能新增", title: "功能新增与发布", icon: "✨" },
  BUG_FIX: { label: "问题修复", title: "问题修复与改进", icon: "🛠️" },
  OPTIMIZATION: { label: "功能优化", title: "功能优化升级", icon: "⚙️" },
  MAINTENANCE: { label: "系统维护", title: "系统维护通知", icon: "🔧" },
  SECURITY: { label: "安全通知", title: "系统安全更新", icon: "🛡️" },
  GENERAL: { label: "其他通知", title: "系统更新摘要", icon: "📢" },
};

const ROLE_PATHS: Array<{ roles: UserRole[]; pattern: RegExp }> = [
  { roles: ["ADMIN", "SUPERVISOR", "SALES", "ORDER_CLERK", "WAREHOUSE", "FINANCE"], pattern: /(^|\/)(dashboard|crm-dashboard|workbench)(\/|\.|$)/i },
  { roles: ["SALES", "SUPERVISOR", "ADMIN"], pattern: /(^|\/)(customers?|customer-[^/]*|followups?|ai-acquisition|ai-screening|sales\/performance)(\/|\.|$)/i },
  { roles: ["SALES", "SUPERVISOR", "ORDER_CLERK", "ADMIN"], pattern: /(^|\/)(orders?|order-[^/]*|pi|pi-[^/]*|components\/pi-)(\/|\.|$)/i },
  { roles: ["WAREHOUSE", "ORDER_CLERK", "ADMIN"], pattern: /(^|\/)(stock-orders?|stock-order-[^/]*|warehouse)(\/|\.|$)/i },
  { roles: ["WAREHOUSE", "FINANCE", "ADMIN"], pattern: /(^|\/)(suppliers?|supplier-[^/]*|supplier-reconciliation|reconciliation)(\/|\.|$)/i },
  { roles: ["SALES", "SUPERVISOR", "FINANCE", "ADMIN"], pattern: /(^|\/)(reports?|sales-performance|sales-reports|costs?|pi-exchange-rates|pi-payment-accounts)(\/|\.|$)/i },
  { roles: ["ADMIN"], pattern: /(^|\/)(settings|api\/admin|middleware|lib\/auth)(\/|\.|$)/i },
];

const ROLE_LABELS: Record<UserRole, string> = { ADMIN: "系统管理员", SUPERVISOR: "主管", SALES: "销售员", ORDER_CLERK: "跟单员", WAREHOUSE: "仓库员", FINANCE: "财务员" };
const GLOBAL_PATHS = [
  /^(app\/layout\.[^/]+|app\/globals?\.css)$/i,
  /^components\/ui\//i,
  /^lib\/notifications\//i,
  /^lib\/auth\//i,
];

const MODULE_PATHS: Array<{ label: string; pattern: RegExp }> = [
  { label: "客户与客户公海", pattern: /(^|\/)(customers?|customer-[^/]*|followups?)(\/|\.|$)/i },
  { label: "工作台与数据总览", pattern: /(^|\/)(dashboard|crm-dashboard|workbench)(\/|\.|$)/i },
  { label: "AI获客与筛选", pattern: /(^|\/)(ai-acquisition|ai-screening)(\/|\.|$)/i },
  { label: "PI订单与订单变更", pattern: /(^|\/)(orders?|order-[^/]*|pi|pi-[^/]*|components\/pi-)(\/|\.|$)/i },
  { label: "备货单与仓库", pattern: /(^|\/)(stock-orders?|stock-order-[^/]*|warehouse)(\/|\.|$)/i },
  { label: "供应商与供应商对账", pattern: /(^|\/)(suppliers?|supplier-[^/]*|supplier-reconciliation|reconciliation)(\/|\.|$)/i },
  { label: "业绩与报表", pattern: /(^|\/)(reports?|sales\/performance|sales-performance|sales-reports|costs?)(\/|\.|$)/i },
  { label: "通知与公告", pattern: /(^|\/)(notifications?|announcements?)(\/|\.|$)/i },
  { label: "系统设置与权限", pattern: /(^|\/)(settings|api\/admin|middleware|lib\/auth)(\/|\.|$)/i },
  { label: "全局界面与基础配置", pattern: /(^|\/)(app\/globals?\.css|components\/ui|package\.json|next\.config\.[^/]+|tailwind\.config\.[^/]+|tsconfig\.json)$/i },
];

export function inferAffectedRoles(paths: string[]): UserRole[] | ["ALL"] {
  if (paths.some(path => GLOBAL_PATHS.some(pattern => pattern.test(path)))) return ["ALL"];
  const roles = new Set<UserRole>();
  for (const path of paths) {
    for (const rule of ROLE_PATHS) if (rule.pattern.test(path)) rule.roles.forEach(role => roles.add(role));
  }
  return [...roles];
}

export function inferReleaseModules(paths: string[]): string[] {
  const modules = new Set<string>();
  for (const path of paths) for (const rule of MODULE_PATHS) if (rule.pattern.test(path)) modules.add(rule.label);
  return [...modules];
}

export function inferReleaseCategory(message: string): ReleaseCommitCategory {
  const value = message.toLowerCase();
  if (/(security|vulnerab|权限|安全|认证|鉴权)/i.test(value)) return "SECURITY";
  if (/^(fix|hotfix|bugfix)(\(|:|\s)|\bfix(es|ed)?\b|修复|纠正|更正/i.test(value)) return "BUG_FIX";
  if (/^(feat|feature)(\(|:|\s)|\badd(ed|s)?\b|新增|新建|增加/i.test(value)) return "FEATURE";
  if (/^(perf|refactor|style|improve)(\(|:|\s)|优化|改进|重构|调整/i.test(value)) return "OPTIMIZATION";
  if (/deploy|release|maintenance|维护|升级|migration|迁移|build|ci\b/i.test(value)) return "MAINTENANCE";
  return "GENERAL";
}

export function buildReleaseAnnouncement(commits: ReleaseCommit[], from: string, to: string, selectedRoles: UserRole[] | null, selectedCategory: ReleaseCategory) {
  const category = RELEASE_CATEGORIES[selectedCategory];
  const matchingCategory = commits.filter(commit => selectedCategory === "ALL" || commit.category === selectedCategory);
  const targeted = selectedRoles?.length ? matchingCategory.filter(commit => commit.affectedRoles.includes("ALL") || commit.affectedRoles.some(role => role !== "ALL" && selectedRoles.includes(role))) : matchingCategory;
  const title = `${category.icon} ${category.title}｜${from} 至 ${to}`;
  if (!targeted.length) {
    return { title, content: `${category.icon} ${category.label}\n📅 统计周期：${from} 至 ${to}\n👥 接收范围：${selectedRoles?.length ? selectedRoles.map(role => ROLE_LABELS[role]).join("、") : "所有启用用户"}\n\n该周期内未发现符合筛选条件、且已在 Vercel 正式环境成功部署的 GitHub 提交。` };
  }
  const grouped = new Map<string, ReleaseCommit[]>();
  for (const commit of targeted) {
    const group = commit.affectedRoles.includes("ALL") ? "全系统" : commit.affectedRoles.filter(role => !selectedRoles?.length || selectedRoles.includes(role)).map(role => ROLE_LABELS[role]).join("、") || "功能范围待核对";
    grouped.set(group, [...(grouped.get(group) || []), commit]);
  }
  const lines = [
    `${category.icon} ${category.label}`,
    `📅 统计周期：${from} 至 ${to}`,
    `👥 接收范围：${selectedRoles?.length ? selectedRoles.map(role => ROLE_LABELS[role]).join("、") : "所有启用用户"}`,
    `🔎 发布依据：GitHub 已提交代码与所选周期内 Vercel 成功的正式部署记录（按 commit SHA 关联；类别由提交说明初步归类）`,
  ];
  const footer = `✅ 已关联 ${targeted.length} 项正式部署提交。发布前请核对受众和摘要。`;
  const entries = [...grouped.entries()].flatMap(([group, items]) => [
    `🔹 ${group}`,
    ...items.flatMap((item, index) => {
      const modules = inferReleaseModules(item.files);
      const moduleLabel = modules.length ? modules.join("、") : "功能范围待核对";
      return [`${index + 1}. ${moduleLabel}｜${RELEASE_CATEGORIES[item.category].label}：${item.message}（上线：${new Date(item.deployedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}）`, `   ↳ GitHub: ${item.url}`, `   ↳ Vercel: ${item.deploymentUrl}`];
    }),
  ]);
  const join = (selected: string[], truncated: boolean) => [
    ...lines,
    "",
    ...selected,
    ...(truncated ? ["", "⚠️ 摘要已按长度限制收敛；如需查看全部改动，请缩小统计日期范围后重新生成。"] : []),
    footer,
  ].join("\n");
  const selectedEntries: string[] = [];
  let truncated = false;
  for (const entry of entries) {
    selectedEntries.push(entry);
    if (join(selectedEntries, false).length > 4000) {
      selectedEntries.pop();
      truncated = true;
      break;
    }
  }
  if (truncated) {
    const notice = "⚠️ 摘要已按长度限制收敛；如需查看全部改动，请缩小统计日期范围后重新生成。";
    while (selectedEntries.length && join([...selectedEntries, notice], false).length > 4000) selectedEntries.pop();
    return { title, content: join(selectedEntries, true) };
  }
  return { title, content: join(selectedEntries, false) };
}

