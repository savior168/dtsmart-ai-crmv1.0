import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
];

for (const name of required) {
  if (!process.env[name]) throw new Error(`缺少环境变量：${name}`);
}

const baseUrl = process.env.E2E_BASE_URL || "https://dtsmart-ai-crm.vercel.app";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

let authCookies = [];
const auth = createServerClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    cookies: {
      getAll: () => [],
      setAll: (items) => { authCookies = items; },
    },
  },
);

const login = await auth.auth.signInWithPassword({
  email: process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD,
});
if (login.error || !login.data.user) throw new Error("Production 管理员登录验证失败");

const cookie = authCookies.map((item) => `${item.name}=${item.value}`).join("; ");
const request = async (path, init = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { cookie, ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path}：${body.error || `HTTP ${response.status}`}`);
  return body;
};

let customerId = "";
let taskId = "";
try {
  const suffix = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const created = await admin.from("customers").insert({
    company_name: `CODEX AI E2E ${suffix}`,
    country: "西班牙",
    category: "手机配件零售商",
    source: "MANUAL_E2E_TEST",
    source_channel: "新增&导入",
    source_batch: "Codex Production E2E",
    owner_id: login.data.user.id,
    owner_user_id: login.data.user.id,
    created_by: login.data.user.id,
    status: "CLAIMED",
    ai_score: null,
    ai_screening_done: false,
  }).select("id").single();
  if (created.error || !created.data) throw created.error || new Error("测试客户创建失败");
  customerId = created.data.id;

  const createdTask = await request("/api/ai/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: `Production E2E ${suffix}`,
      strategy: "SMART",
      customer_ids: [customerId],
      filters: { source_channel: "新增&导入", source_batch: "Codex Production E2E" },
      notification_mode: "NONE",
    }),
  });
  taskId = createdTask.task.id;

  let task;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    task = (await request(`/api/ai/tasks/${taskId}`)).task;
    if (["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) break;
  }

  const result = await admin.from("ai_screening_results")
    .select("id,score,grade,target_decision,strategy,total_tokens,cost_usd")
    .eq("task_id", taskId)
    .maybeSingle();
  const evidence = await admin.from("ai_screening_evidence")
    .select("id", { count: "exact", head: true })
    .eq("task_id", taskId);
  const customer = await admin.from("customers")
    .select("ai_score,ai_level,ai_reason,ai_last_result_id,ai_last_screened_at")
    .eq("id", customerId)
    .single();

  const passed = task?.status === "COMPLETED"
    && Boolean(result.data?.id)
    && Number(evidence.count || 0) > 0
    && customer.data?.ai_last_result_id === result.data?.id;

  console.log(JSON.stringify({
    passed,
    task_status: task?.status || "TIMEOUT",
    result_saved: Boolean(result.data?.id),
    evidence_count: evidence.count || 0,
    customer_writeback: customer.data?.ai_last_result_id === result.data?.id,
    strategy: result.data?.strategy || null,
    tokens: result.data?.total_tokens || 0,
    cost_usd: result.data?.cost_usd || 0,
  }));
  if (!passed) throw new Error("Production AI筛选闭环验证未通过");
} finally {
  if (taskId) await admin.from("ai_screening_tasks").delete().eq("id", taskId);
  if (customerId) await admin.from("customers").delete().eq("id", customerId);
}
