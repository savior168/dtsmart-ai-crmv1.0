import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { customerLookupIdentityKeys } from "@/lib/import-dedupe";

type ConflictRow = {
  id: string;
  customer_id: string | null;
  reported_by: string | null;
  conflict_type: string;
  status: string;
  details: Record<string, unknown>;
  created_at: string;
  source: "table" | "audit";
  submitter_ids?: string[];
  submitter_events?: Array<{ id: string; created_at: string }>;
};

type ConflictCustomer = {
  id: string;
  owner_id: string | null;
  created_at: string;
  status: string;
};

const IN_QUERY_BATCH_SIZE = 100;

function batches<T>(items: T[], size = IN_QUERY_BATCH_SIZE) {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) result.push(items.slice(offset, offset + size));
  return result;
}

function customerConflictKey(item: ConflictRow) {
  if (item.customer_id) return `customer:${item.customer_id}`;
  const submitted = item.details?.submitted;
  const identity = submitted && typeof submitted === "object"
    ? customerLookupIdentityKeys(submitted as { company_name?: unknown; phone?: unknown; email?: unknown; website?: unknown; google_url?: unknown })[0]
    : "";
  return `identity:${identity || item.id}`;
}

function reporterConflictKey(item: ConflictRow) {
  return `${item.reported_by || "unknown"}|${customerConflictKey(item)}`;
}

function aggregateOpenConflicts(rows: ConflictRow[]) {
  const sorted = [...rows].sort((a, b) => {
    const time = String(b.created_at).localeCompare(String(a.created_at));
    if (time) return time;
    return a.source === b.source ? 0 : a.source === "table" ? -1 : 1;
  });
  const latestByReporter = new Map<string, ConflictRow>();
  for (const item of sorted) {
    const key = reporterConflictKey(item);
    if (!latestByReporter.has(key)) latestByReporter.set(key, item);
  }
  const grouped = new Map<string, ConflictRow>();
  for (const item of latestByReporter.values()) {
    if (item.status !== "OPEN") continue;
    const key = customerConflictKey(item);
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        ...item,
        submitter_ids: item.reported_by ? [item.reported_by] : [],
        submitter_events: item.reported_by ? [{ id: item.reported_by, created_at: item.created_at }] : [],
      });
      continue;
    }
    if (item.reported_by && !current.submitter_ids?.includes(item.reported_by)) {
      current.submitter_ids = [...(current.submitter_ids || []), item.reported_by];
      current.submitter_events = [...(current.submitter_events || []), { id: item.reported_by, created_at: item.created_at }];
    }
  }
  return [...grouped.values()];
}

async function loadConflictCustomers(customerIds: string[]) {
  const admin = createAdminClient();
  const customers: ConflictCustomer[] = [];
  for (const customerIdBatch of batches(Array.from(new Set(customerIds)))) {
    const result = await admin.from("customers").select("id,owner_id,created_at,status").in("id", customerIdBatch);
    if (result.error) throw result.error;
    customers.push(...(result.data || []));
  }
  return customers;
}

async function enrichConflicts(rows: ConflictRow[], loadedCustomers?: ConflictCustomer[]) {
  const admin = createAdminClient();
  const customerIds = Array.from(new Set(rows.map((item) => item.customer_id).filter((id): id is string => Boolean(id))));
  const customers = loadedCustomers || await loadConflictCustomers(customerIds);
  const userIds = Array.from(new Set([
    ...customers.map((item) => item.owner_id),
    ...rows.flatMap((item) => item.submitter_ids || (item.reported_by ? [item.reported_by] : [])),
  ].filter((id): id is string => Boolean(id))));
  const users = userIds.length ? await admin.from("users").select("id,name,email").in("id", userIds) : { data: [], error: null };
  if (users.error) throw users.error;
  const userById = new Map((users.data || []).map((item) => [item.id, { id: item.id, name: String(item.name || "").trim() || item.email || "未设置用户名" }]));
  const customerById = new Map(customers.map((item) => [item.id, item]));
  const protectionRows: Array<{ customer_id: string; expire_date: string | null; status: string }> = [];
  for (const customerIdBatch of batches(customerIds)) {
    const result = await admin.from("customer_protection").select("customer_id,expire_date,status").in("customer_id", customerIdBatch).eq("status", "ACTIVE").order("expire_date", { ascending: false });
    if (result.error) throw result.error;
    protectionRows.push(...(result.data || []));
  }
  const expiryByCustomer = new Map<string, string | null>();
  for (const item of protectionRows) if (!expiryByCustomer.has(item.customer_id)) expiryByCustomer.set(item.customer_id, item.expire_date);
  return rows.map((item) => {
    const customer = item.customer_id ? customerById.get(item.customer_id) : null;
    const owner = customer?.owner_id ? userById.get(customer.owner_id) || { id: customer.owner_id, name: "已归属其他用户" } : null;
    const eventBySubmitter = new Map((item.submitter_events || []).map((event) => [event.id, event.created_at]));
    const submitters = (item.submitter_ids || [])
      .map((id) => ({ ...(userById.get(id) || { id, name: "未设置用户名" }), submitted_at: eventBySubmitter.get(id) || item.created_at }))
      .sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)));
    const expiry = item.customer_id ? expiryByCustomer.get(item.customer_id) : null;
    const fallbackExpiry = customer?.created_at ? new Date(new Date(customer.created_at).getTime() + 90 * 86400000).toISOString() : null;
    const protectionDays = expiry || fallbackExpiry ? Math.max(0, Math.ceil((new Date(String(expiry || fallbackExpiry)).getTime() - Date.now()) / 86400000)) : 0;
    return { ...item, owner, submitters, protection_days: protectionDays };
  });
}

/** 冲突记录按提交人授权；同一客户的多个提交人聚合在一行。 */
export async function GET(request: NextRequest) {
  try {
    const { account } = await requirePermission("customers.view");
    const admin = createAdminClient();
    const scopeUserId = requestedOwnerId(request, account, "customers.data_all");
    const summaryOnly = request.nextUrl.searchParams.get("summary") === "1";
    const tableRows: ConflictRow[] = [];
    let tableAvailable = true;
    for (let from = 0; ; from += 1000) {
      const query = admin.from("customer_conflicts").select("id,customer_id,reported_by,conflict_type,status,details,created_at").order("created_at", { ascending: false }).range(from, from + 999);
      const page = await query;
      if (page.error) { tableAvailable = false; break; }
      tableRows.push(...(page.data || []).map((item) => ({ ...item, details: (item.details || {}) as Record<string, unknown>, source: "table" as const })));
      if ((page.data || []).length < 1000) break;
    }

    // 审计记录是不可变的历史提交事件，其中可能包含已经物理删除的客户。
    // 正式冲突表可用时只能以正式表作为当前队列，不能把历史事件次数
    // 重新当成当前冲突客户数。仅在旧库确实无法读取冲突表时降级使用审计。
    const auditRows: ConflictRow[] = [];
    if (!tableAvailable) {
      for (let from = 0; ; from += 1000) {
        const query = admin.from("audit_logs").select("id,target_id,user_id,content,created_at").eq("action", "CUSTOMER_CONFLICT_DETECTED").order("created_at", { ascending: false }).range(from, from + 999);
        const page = await query;
        if (page.error) throw page.error;
        auditRows.push(...(page.data || []).map((item) => {
          const content = item.content && typeof item.content === "object" ? item.content as Record<string, unknown> : {};
          const details = content.details && typeof content.details === "object" ? content.details as Record<string, unknown> : content;
          return {
            id: `audit-${item.id}`,
            customer_id: item.target_id,
            reported_by: String(content.reported_by || item.user_id || "") || null,
            conflict_type: String(content.conflict_type || "CROSS_OWNER_DUPLICATE"),
            status: String(content.status || "OPEN"),
            details,
            created_at: item.created_at,
            source: "audit" as const,
          };
        }));
        if ((page.data || []).length < 1000) break;
      }
    }
    if (!tableAvailable && !auditRows.length) throw new Error("冲突客户存储暂不可用");
    const sourceRows = tableAvailable ? tableRows : auditRows;
    const customers = await loadConflictCustomers(sourceRows.map((item) => item.customer_id).filter((id): id is string => Boolean(id)));
    const ownerByCustomer = new Map(customers.map((item) => [item.id, item.owner_id]));
    // 客户物理删除后历史审计仍需保留追溯，但绝不能继续出现在当前
    // 冲突队列；客户后来转归该提交人后，双方已不再冲突，也应实时排除。
    // 先过滤再聚合，确保最终一行保留的也是仍然有效的冲突提交快照。
    const currentRows = sourceRows.filter((item) => Boolean(
      item.customer_id
      && item.reported_by
      && ownerByCustomer.has(item.customer_id)
      && ownerByCustomer.get(item.customer_id) !== item.reported_by
    ));
    const current = aggregateOpenConflicts(currentRows);
    // The submitter filter determines whether a customer row is included; it
    // must not truncate the row's complete submitter list.
    const scoped = scopeUserId ? current.filter((item) => item.submitter_ids?.includes(scopeUserId)) : current;
    if (summaryOnly) return NextResponse.json({ count: scoped.length }, { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=60" } });
    const scopedCustomerIds = new Set(scoped.map((item) => item.customer_id).filter(Boolean));
    return NextResponse.json({ data: await enrichConflicts(scoped, customers.filter((item) => scopedCustomerIds.has(item.id))), count: scoped.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "冲突客户加载失败";
    const authMessages: Record<string, string> = {
      UNAUTHORIZED: "登录已失效，请重新登录",
      SESSION_REVOKED: "当前会话已失效，请重新登录",
      FORBIDDEN: "当前账号没有查看冲突客户的权限",
      ACCOUNT_PENDING: "账号尚未审核通过",
      ACCOUNT_REJECTED: "账号申请未通过",
      ACCOUNT_DISABLED: "账号已停用，请联系系统管理员",
      ACCOUNT_LOCKED: "账号已锁定，请联系系统管理员",
      PASSWORD_CHANGE_REQUIRED: "请先修改管理员分配的临时密码",
    };
    const status = authMessages[message] ? authErrorStatus(message) : 500;
    if (status === 500) console.error("冲突客户加载失败", error);
    return NextResponse.json({ error: authMessages[message] || "冲突客户加载失败，请稍后重试" }, { status });
  }
}
