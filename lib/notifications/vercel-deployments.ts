export type VercelProductionDeployment = {
  id?: string;
  uid?: string;
  url?: string | null;
  created?: number;
  createdAt?: number;
  readyState: string;
  target?: string | null;
  projectId?: string;
  meta?: {
    githubOrg?: string;
    githubRepo?: string;
    githubCommitSha?: string;
  };
};

type VercelDeploymentList = {
  deployments?: VercelProductionDeployment[];
  pagination?: { count?: number | string; next?: number | string | null };
};

export type VerifiedProductionDeployment = {
  sha: string;
  deploymentUrl: string;
  deployedAt: string;
};

const API_ROOT = "https://api.vercel.com/v7/deployments";
const MAX_DEPLOYMENT_PAGES = 20;

function inRange(value: number, start: number, endExclusive: number) {
  return Number.isFinite(value) && value >= start && value < endExclusive;
}

function deploymentUrl(value: string | null | undefined) {
  if (!value) return "";
  try {
    const url = new URL(value.startsWith("https://") ? value : `https://${value}`);
    return url.protocol === "https:" && (url.hostname.endsWith(".vercel.app") || url.hostname.endsWith(".vercel.com")) ? url.toString() : "";
  } catch {
    return "";
  }
}

/** Reads the canonical Vercel deployment list, not GitHub's optional Deployments API mirror. */
export async function listVerifiedVercelProductionDeployments({
  repository,
  from,
  to,
  token,
  projectId,
  teamId,
  fetcher = fetch,
}: {
  repository: string;
  from: string;
  to: string;
  token?: string;
  projectId: string;
  teamId: string;
  fetcher?: typeof fetch;
}): Promise<VerifiedProductionDeployment[]> {
  const [owner, repo, ...extra] = repository.split("/");
  if (!owner || !repo || extra.length) throw new Error("GITHUB_REPOSITORY 配置格式应为 owner/repo");
  if (!token) throw new Error("缺少服务端 VERCEL_TOKEN，无法核验 Vercel Production READY 部署；请在 Vercel 项目环境变量中配置只读部署访问令牌。");
  if (!projectId || !teamId) throw new Error("缺少 VERCEL_PROJECT_ID 或 VERCEL_TEAM_ID，无法定位正式项目部署记录。");

  const start = new Date(`${from}T00:00:00+08:00`).getTime();
  const end = new Date(`${to}T00:00:00+08:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  const endExclusive = end.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(endExclusive) || start >= endExclusive) throw new Error("发布日期范围无效");

  const baseUrl = new URL(API_ROOT);
  baseUrl.searchParams.set("projectId", projectId);
  baseUrl.searchParams.set("teamId", teamId);
  baseUrl.searchParams.set("target", "production");
  baseUrl.searchParams.set("state", "READY");
  baseUrl.searchParams.set("since", String(start));
  baseUrl.searchParams.set("until", String(endExclusive - 1));
  baseUrl.searchParams.set("limit", "100");

  const rows: VercelProductionDeployment[] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_DEPLOYMENT_PAGES; page += 1) {
    const url = new URL(baseUrl);
    // Vercel's `pagination.next` timestamp is the `from` cursor used by the
    // deployment list endpoint/CLI for fetching the next page.
    if (cursor) url.searchParams.set("from", cursor);
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403
      ? `Vercel 部署记录读取权限不足（HTTP ${response.status}）；请确认 VERCEL_TOKEN 可读取目标团队和项目的部署记录。`
      : response.status === 404
        ? `Vercel 项目或团队不存在（HTTP 404）；请核对 VERCEL_PROJECT_ID 和 VERCEL_TEAM_ID。`
        : `Vercel 正式部署记录读取失败（HTTP ${response.status}）`);

    const payload = await response.json() as VercelDeploymentList;
    const pageRows = payload.deployments;
    if (!Array.isArray(pageRows)) throw new Error("Vercel 部署记录格式无效");
    for (const row of pageRows) {
      const deploymentId = row.uid || row.id;
      if (!deploymentId || !seenIds.has(deploymentId)) {
        if (deploymentId) seenIds.add(deploymentId);
        rows.push(row);
      }
    }

    const next = payload.pagination?.next;
    if (next === undefined || next === null || next === "") break;
    const nextCursor = String(next);
    if (!/^\d+$/.test(nextCursor) || seenCursors.has(nextCursor) || nextCursor === cursor) {
      throw new Error("Vercel 部署分页游标无效，无法保证摘要完整；请缩小日期范围后重试。");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
    if (page === MAX_DEPLOYMENT_PAGES - 1) {
      throw new Error("所选时间范围内正式部署记录超过安全分页上限，无法保证摘要完整，请缩小日期范围后重试。");
    }
  }

  const verified = rows.flatMap(row => {
    const sha = row.meta?.githubCommitSha?.toLowerCase() || "";
    const repoMatches = row.meta?.githubOrg?.toLowerCase() === owner.toLowerCase() && row.meta?.githubRepo?.toLowerCase() === repo.toLowerCase();
    const created = row.created ?? row.createdAt;
    const href = deploymentUrl(row.url);
    if (row.readyState !== "READY" || row.target !== "production" || (row.projectId && row.projectId !== projectId) || !repoMatches || !/^[0-9a-f]{40}$/.test(sha) || !href || typeof created !== "number" || !inRange(created, start, endExclusive)) return [];
    return [{ sha, deploymentUrl: href, deployedAt: new Date(created).toISOString() }];
  });

  const latestBySha = new Map<string, VerifiedProductionDeployment>();
  for (const deployment of verified.sort((a, b) => Date.parse(b.deployedAt) - Date.parse(a.deployedAt))) {
    if (!latestBySha.has(deployment.sha)) latestBySha.set(deployment.sha, deployment);
  }
  return [...latestBySha.values()];
}
