export type GitHubDeployment = {
  id: number;
  sha: string;
  environment: string;
  production_environment?: boolean;
  created_at: string;
  creator?: { login?: string; type?: string };
};

type GitHubDeploymentStatus = {
  state: string;
  created_at: string;
  environment_url?: string | null;
  target_url?: string | null;
};

export type VerifiedProductionDeployment = {
  sha: string;
  deploymentUrl: string;
  deployedAt: string;
};

const API_ROOT = "https://api.github.com";
const PER_PAGE = 100;
const MAX_PAGES = 20;

function isInRange(value: string, start: number, endExclusive: number) {
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= start && time < endExclusive;
}

function isVercelUrl(value: string | null | undefined) {
  if (!value) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "vercel.com" || hostname.endsWith(".vercel.com") || hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function requestHeaders(token?: string) {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Vercel's GitHub integration records production deployments/statuses in the
 * repository's Deployments API. This lets the release summary work without
 * adding Vercel service credentials to the application environment.
 */
export async function listVerifiedVercelProductionDeployments({
  repository,
  from,
  to,
  token,
  fetcher = fetch,
}: {
  repository: string;
  from: string;
  to: string;
  token?: string;
  fetcher?: typeof fetch;
}): Promise<VerifiedProductionDeployment[]> {
  const [owner, repo, ...extra] = repository.split("/");
  if (!owner || !repo || extra.length) throw new Error("GITHUB_REPOSITORY 配置格式应为 owner/repo");

  const start = new Date(`${from}T00:00:00+08:00`).getTime();
  const end = new Date(`${to}T00:00:00+08:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  const endExclusive = end.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(endExclusive)) throw new Error("发布日期范围无效");

  const base = `${API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers = requestHeaders(token);
  const deploymentRows: GitHubDeployment[] = [];
  let reachedOlderRecords = false;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = new URL(`${base}/deployments`);
    url.searchParams.set("environment", "Production");
    url.searchParams.set("per_page", String(PER_PAGE));
    url.searchParams.set("page", String(page));
    const response = await fetcher(url, { headers, cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 404
      ? `GitHub 正式部署记录返回 404：无法访问私有仓库 ${repository}，请检查服务端 GITHUB_TOKEN 仓库权限。`
      : `GitHub 正式部署记录读取失败（HTTP ${response.status}）`);
    const rows = await response.json() as GitHubDeployment[];
    if (!Array.isArray(rows)) throw new Error("GitHub 正式部署记录格式无效");
    deploymentRows.push(...rows);
    if (rows.some(row => Date.parse(row.created_at) < start)) reachedOlderRecords = true;
    if (rows.length < PER_PAGE || reachedOlderRecords) break;
    if (page === MAX_PAGES) throw new Error("所选时间范围内部署记录过多，无法保证摘要完整，请缩小日期范围后重试");
  }

  const candidates = deploymentRows.filter(row =>
    row.environment.toLowerCase() === "production" &&
    row.production_environment === true &&
    Boolean(row.id) &&
    /^[0-9a-f]{40}$/i.test(row.sha) &&
    isInRange(row.created_at, start, endExclusive) &&
    (row.creator?.login || "").toLowerCase().includes("vercel"),
  );

  const verified = await Promise.all(candidates.map(async deployment => {
    const statusUrl = `${base}/deployments/${deployment.id}/statuses?per_page=${PER_PAGE}`;
    const response = await fetcher(statusUrl, { headers, cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 404
      ? `GitHub 部署状态返回 404：无法访问仓库 ${repository} 的部署记录，请检查服务端 GITHUB_TOKEN 的 Deployments/Statuses 读取权限。`
      : `GitHub 部署状态读取失败（HTTP ${response.status}）`);
    const statuses = await response.json() as GitHubDeploymentStatus[];
    if (!Array.isArray(statuses)) throw new Error("GitHub 部署状态格式无效");
    const success = statuses.find(status => status.state === "success" && isInRange(status.created_at, start, endExclusive));
    if (!success) return null;
    const deploymentUrl = success.environment_url || success.target_url || "";
    if (!isVercelUrl(deploymentUrl)) return null;
    return { sha: deployment.sha.toLowerCase(), deploymentUrl, deployedAt: success.created_at };
  }));

  return verified.filter((item): item is VerifiedProductionDeployment => item !== null);
}

