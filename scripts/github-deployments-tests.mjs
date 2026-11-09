import assert from "node:assert/strict";
import { listVerifiedVercelProductionDeployments } from "../lib/notifications/github-deployments.ts";

const deployments = [
  { id: 1, sha: "a".repeat(40), environment: "Production", production_environment: true, created_at: "2026-11-07T02:00:00Z", creator: { login: "vercel[bot]", type: "Bot" } },
  { id: 2, sha: "b".repeat(40), environment: "Production", production_environment: true, created_at: "2026-11-07T03:00:00Z", creator: { login: "github-actions[bot]", type: "Bot" } },
  { id: 3, sha: "c".repeat(40), environment: "Preview", production_environment: false, created_at: "2026-11-07T04:00:00Z", creator: { login: "vercel[bot]", type: "Bot" } },
  { id: 4, sha: "d".repeat(40), environment: "Production", production_environment: true, created_at: "2026-11-07T05:00:00Z", creator: { login: "vercel[bot]", type: "Bot" } },
  { id: 5, sha: "e".repeat(40), environment: "Production", production_environment: true, created_at: "2026-11-07T15:59:59Z", creator: { login: "vercel[bot]", type: "Bot" } },
  { id: 6, sha: "f".repeat(40), environment: "Production", production_environment: true, created_at: "2026-11-07T06:00:00Z", creator: { login: "github-actions[bot]", type: "Bot" } },
  { id: 7, sha: "7".repeat(40), environment: "Production", production_environment: true, created_at: "2026-11-07T07:00:00Z", creator: { login: "vercel[bot]", type: "Bot" } },
];
const requested = [];
const fetcher = async (input, init) => {
  const url = new URL(String(input));
  requested.push({ url, init });
  if (url.pathname.endsWith("/deployments")) return Response.json(deployments);
  const id = Number(url.pathname.match(/\/deployments\/(\d+)\/statuses$/)?.[1]);
  if (id === 1) return Response.json([{ state: "success", created_at: "2026-11-07T02:01:00Z", environment_url: "https://dtsmart-ai.vercel.app" }]);
  if (id === 4) return Response.json([{ state: "failure", created_at: "2026-11-07T05:01:00Z", environment_url: "https://dtsmart-ai.vercel.app" }]);
  if (id === 5) return Response.json([{ state: "success", created_at: "2026-11-07T15:59:59Z", environment_url: "https://dtsmart-ai.vercel.app" }]);
  if (id === 6) return Response.json([{ state: "success", created_at: "2026-11-07T06:01:00Z", environment_url: "https://dtsmart-ai.vercel.app" }]);
  if (id === 7) return Response.json([
    { state: "failure", created_at: "2026-11-07T07:02:00Z", environment_url: "https://dtsmart-ai.vercel.app" },
    { state: "success", created_at: "2026-11-07T07:01:00Z", environment_url: "https://dtsmart-ai.vercel.app" },
  ]);
  return Response.json([]);
};

const result = await listVerifiedVercelProductionDeployments({
  repository: "savior168/dtsmart-ai-crmv1.0",
  from: "2026-11-07",
  to: "2026-11-07",
  token: "test-read-token",
  fetcher,
});
assert.deepEqual(result.map(item => item.sha), ["e".repeat(40), "f".repeat(40), "a".repeat(40)], "verified releases are newest-first and do not depend on the deployment actor name");
assert.equal(result[0].deploymentUrl, "https://dtsmart-ai.vercel.app");
assert.equal(result[0].deployedAt, "2026-11-07T15:59:59Z");
assert.ok(requested.every(item => item.init.headers.Accept === "application/vnd.github+json"));
assert.ok(requested.every(item => item.init.headers.Authorization === "Bearer test-read-token"), "private repository requests must use the server-only token");
assert.ok(requested[0].url.searchParams.get("environment") === "Production");

await assert.rejects(() => listVerifiedVercelProductionDeployments({ repository: "bad", from: "2026-11-07", to: "2026-11-07", fetcher }), /owner\/repo/);
await assert.rejects(() => listVerifiedVercelProductionDeployments({
  repository: "savior168/dtsmart-ai-crmv1.0", from: "2026-11-07", to: "2026-11-07",
  fetcher: async () => new Response("Not Found", { status: 404 }),
}), /返回 404.*私有仓库.*GITHUB_TOKEN/);
console.log("GitHub Vercel production deployment filtering tests passed");
