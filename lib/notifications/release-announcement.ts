import type { UserRole } from "@/lib/auth/permissions";

export type ReleaseCommit = {
  sha: string;
  message: string;
  url: string;
  deployedAt: string;
  files: string[];
  deploymentUrl: string;
  affectedRoles: UserRole[] | ["ALL"];
  category: ReleaseCategory;
};

export type ReleaseCategory = "FEATURE" | "BUG_FIX" | "OPTIMIZATION" | "MAINTENANCE" | "SECURITY" | "GENERAL";

export const RELEASE_CATEGORIES: Record<ReleaseCategory, { label: string; title: string; icon: string }> = {
  FEATURE: { label: "功能新增", title: "功能新增与发布", icon: "✨" },
  BUG_FIX: { label: "问题修复", title: "问题修复与改进", icon: "🛠️" },
  OPTIMIZATION: { label: "功能优化", title: "功能优化升级", icon: "⚙️" },
  MAINTENANCE: { label: "系统维护", title: "系统维护通知", icon: "🔧" },
  SECURITY: { label: "安全通知", title: "系统安全更新", icon: "🛡️" },
  GENERAL: { label: "其他通知", title: "系统更新摘要", icon: "📢" },
};

const ROLE_PATHS: Array<{ roles: UserRole[]; pattern: RegExp }> = [
  { roles: ["SALES", "SUPERVISOR", "ADMIN"], pattern: /(^|\/)(customers?|customer-[^/]*|followups?|ai-acquisition|ai-screening|sales\/performance)(\/|\.|$)/i },
  { roles: ["SALES", "SUPERVISOR", "ORDER_CLERK", "ADMIN"], pattern: /(^|\/)(orders?|order-[^/]*|pi|pi-[^/]*|components\/pi-)(\/|\.|$)/i },
  { roles: ["WAREHOUSE", "ORDER_CLERK", "ADMIN"], pattern: /(^|\/)(stock-orders?|stock-order-[^/]*|warehouse)(\/|\.|$)/i },
  { roles: ["WAREHOUSE", "FINANCE", "ADMIN"], pattern: /(^|\/)(suppliers?|supplier-[^/]*|supplier-reconciliation|reconciliation)(\/|\.|$)/i },
  { roles: ["FINANCE", "ADMIN"], pattern: /(^|\/)(reports?|costs?|pi-exchange-rates|pi-payment-accounts)(\/|\.|$)/i },
  { roles: ["ADMIN"], pattern: /(^|\/)(settings|api\/admin|middleware|lib\/auth)(\/|\.|$)/i },
];

const ROLE_LABELS: Record<UserRole, string> = { ADMIN: "系统管理员", SUPERVISOR: "主管", SALES: "销售员", ORDER_CLERK: "跟单员", WAREHOUSE: "仓库员", FINANCE: "财务员" };

export function inferAffectedRoles(paths: string[]): UserRole[] | ["ALL"] {
  const roles = new Set<UserRole>();
  for (const path of paths) {
    for (const rule of ROLE_PATHS) if (rule.pattern.test(path)) rule.roles.forEach(role => roles.add(role));
  }
  return roles.size ? [...roles] : ["ALL"];
}

export function inferReleaseCategory(message: string): ReleaseCategory {
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
  const matchingCategory = commits.filter(commit => commit.category === selectedCategory);
  const targeted = selectedRoles?.length ? matchingCategory.filter(commit => commit.affectedRoles.includes("ALL") || commit.affectedRoles.some(role => selectedRoles.includes(role))) : matchingCategory;
  const title = `${category.icon} ${category.title}｜${from} 至 ${to}`;
  if (!targeted.length) {
    return { title, content: `${category.icon} ${category.label}\n📅 统计周期：${from} 至 ${to}\n👥 接收范围：${selectedRoles?.length ? selectedRoles.join("、") : "所有启用用户"}\n\n该周期内未发现符合此类型、且已在 Vercel 正式环境成功部署的 GitHub 提交。` };
  }
  const grouped = new Map<string, ReleaseCommit[]>();
  for (const commit of targeted) {
    const group = commit.affectedRoles.includes("ALL") ? "全系统" : commit.affectedRoles.filter(role => !selectedRoles?.length || selectedRoles.includes(role)).map(role => ROLE_LABELS[role]).join("、") || "全系统";
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
    ...items.map((item, index) => `${index + 1}. ${item.message}（上线：${new Date(item.deployedAt).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })}）\n   ↳ GitHub: ${item.url}\n   ↳ Vercel: ${item.deploymentUrl}`),
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
