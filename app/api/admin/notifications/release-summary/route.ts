import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requireAdmin } from "@/lib/auth/current-user";
import { USER_ROLES } from "@/lib/auth/permissions";
import { buildReleaseAnnouncement, inferAffectedRoles, inferReleaseCategory, RELEASE_CATEGORIES, type ReleaseCategory, type ReleaseCommit } from "@/lib/notifications/release-announcement";
import { listVerifiedVercelProductionDeployments, type VerifiedProductionDeployment } from "@/lib/notifications/github-deployments";

type GitHubCommitDetail = { sha?: string; html_url?: string; commit?: { message?: string }; files?: Array<{ filename?: string }> };

const jsonHeaders = { "Cache-Control": "no-store", "Content-Type": "application/json" };

export async function GET(request: NextRequest) {
  try {
    await requireAdmin();
    const params = request.nextUrl.searchParams;
    const from = params.get("from") || "";
    const to = params.get("to") || "";
    const rawRoles = params.getAll("role");
    const rawCategory = params.get("category") || "";
    const roles = rawRoles.length ? rawRoles.filter((role): role is (typeof USER_ROLES)[number] => (USER_ROLES as readonly string[]).includes(role)) : null;
    if (rawRoles.length && (!roles?.length || roles.length !== rawRoles.length)) return NextResponse.json({ error: "通知角色选择无效" }, { status: 400, headers: jsonHeaders });
    if (!Object.hasOwn(RELEASE_CATEGORIES, rawCategory)) return NextResponse.json({ error: "请选择有效的公告类型" }, { status: 400, headers: jsonHeaders });
    const isValidDate = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };
    if (!isValidDate(from) || !isValidDate(to) || from > to) {
      return NextResponse.json({ error: "请选择有效的开始和结束日期" }, { status: 400, headers: jsonHeaders });
    }
    const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
    if (days > 366) return NextResponse.json({ error: "单次发布摘要最多查询 366 天，请缩小日期范围" }, { status: 400, headers: jsonHeaders });

    const githubToken = process.env.GITHUB_TOKEN;
    const repository = process.env.GITHUB_REPOSITORY || "savior168/dtsmart-ai-crmv1.0";
    const [owner, repo] = repository.split("/");
    if (!owner || !repo || repository.split("/").length !== 2) return NextResponse.json({ error: "GITHUB_REPOSITORY 配置格式应为 owner/repo" }, { status: 500, headers: jsonHeaders });

    const productionDeployments = await listVerifiedVercelProductionDeployments({ repository, from, to, token: githubToken });
    const deploymentBySha = new Map<string, VerifiedProductionDeployment>();
    for (const deployment of productionDeployments) {
      if (!deploymentBySha.has(deployment.sha)) deploymentBySha.set(deployment.sha, deployment);
    }
    if (deploymentBySha.size > 10) return NextResponse.json({ error: "所选时段已部署改动超过 10 项，请缩小日期范围后生成，避免公告遗漏或超长。" }, { status: 400, headers: jsonHeaders });

    const details = await Promise.all([...deploymentBySha.entries()].map(async ([shaKey, deployment]) => {
      const detailResponse = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(shaKey)}`, { headers: { ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}), Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, cache: "no-store" });
      if (!detailResponse.ok) throw new Error(`GitHub 提交详情读取失败（HTTP ${detailResponse.status}）`);
      const detail = await detailResponse.json() as GitHubCommitDetail;
      const sha = (detail.sha || shaKey).slice(0, 7);
      const message = (detail.commit?.message || "").split(/\r?\n/)[0].trim().slice(0, 100) || `提交 ${sha}`;
      return {
        sha,
        message,
        url: detail.html_url || `https://github.com/${owner}/${repo}/commit/${shaKey}`,
        deployedAt: deployment.deployedAt,
        files: (detail.files || []).map(file => file.filename || "").filter(Boolean),
        deploymentUrl: deployment.deploymentUrl,
        category: inferReleaseCategory(message),
      } satisfies Omit<ReleaseCommit, "affectedRoles">;
    }));
    const releases: ReleaseCommit[] = details.map(commit => ({ ...commit, affectedRoles: inferAffectedRoles(commit.files) }));
    const generated = buildReleaseAnnouncement(releases, from, to, roles, rawCategory as ReleaseCategory);
    const selectedRoleSet = new Set<string>(roles || []);
    const roleMatches = (commit: ReleaseCommit) => !selectedRoleSet.size || commit.affectedRoles.includes("ALL") || commit.affectedRoles.some(role => selectedRoleSet.has(role));
    const matched = releases.filter(commit => commit.category === rawCategory && roleMatches(commit));
    return NextResponse.json({ ...generated, commit_count: releases.length, matched_count: matched.length, deployments_checked: productionDeployments.length, commits: releases.map(({ sha, message, url, deploymentUrl, affectedRoles }) => ({ sha, message, url, deploymentUrl, affectedRoles })), source: "GitHub commits matched by SHA to Vercel Production successful deployment statuses in the selected release window" }, { headers: jsonHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "发布记录读取失败";
    const authStatus = authErrorStatus(message);
    const status = authStatus || (/^GitHub .*读取失败/.test(message) ? 502 : 400);
    return NextResponse.json({ error: message }, { status, headers: jsonHeaders });
  }
}
