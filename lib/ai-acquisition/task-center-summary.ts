import { createAdminClient } from "@/lib/supabase/admin";
import { countryFilterRawValues } from "@/lib/countries";

type SummaryFilters = {
  ownerId: string | null;
  costMode: string;
  countries: string[];
  industries: string[];
  from: string;
  to: string;
  search: string;
  today: string;
};

export async function loadAcquisitionTaskSummary(admin: ReturnType<typeof createAdminClient>, filters: SummaryFilters) {
  const { ownerId, costMode, countries, industries, from, to, search, today } = filters;
  const summaryRows: Array<{ id:string; status:string }> = [];
  for (let offset = 0; ; offset += 1000) {
    let query = admin.from("ai_acquisition_tasks").select("id,status");
    if (ownerId) query = query.eq("user_id", ownerId);
    if (["FREE_ONLY", "ADAPTIVE"].includes(costMode)) query = query.eq("cost_mode", costMode);
    if (countries.length) query = query.overlaps("countries", countryFilterRawValues(countries));
    if (industries.length) query = query.overlaps("industries", industries);
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("created_at", `${from}T00:00:00.000+08:00`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("created_at", `${to}T23:59:59.999+08:00`);
    if (search) query = query.or(`name.ilike.%${search}%,task_number.ilike.%${search}%`);
    const chunk = await query.order("created_at", { ascending: false }).range(offset, offset + 999);
    if (chunk.error) throw chunk.error;
    summaryRows.push(...(chunk.data || []));
    if ((chunk.data || []).length < 1000) break;
  }
  const decisionCandidates: Array<{ task_id:string; decision:string; imported_customer_id:string|null; processed_at:string|null }> = [];
  const summaryTaskIds = summaryRows.map((row) => row.id);
  for (let offset = 0; offset < summaryTaskIds.length; offset += 150) {
    for (let rowOffset = 0; ; rowOffset += 1000) {
      const result = await admin.from("ai_acquisition_candidates")
        .select("task_id,decision,imported_customer_id,processed_at")
        .in("task_id", summaryTaskIds.slice(offset, offset + 150))
        .in("decision", ["ACCEPTED", "REVIEW"])
        .order("processed_at", { ascending:false, nullsFirst:false })
        .order("id", { ascending:true })
        .range(rowOffset, rowOffset + 999);
      if (result.error) throw result.error;
      decisionCandidates.push(...(result.data || []));
      if ((result.data || []).length < 1000) break;
    }
  }
  const acceptedCandidates = decisionCandidates.filter((row) => row.decision === "ACCEPTED");
  const reviewCandidates = decisionCandidates.filter((row) => row.decision === "REVIEW");
  const reviewByTask: Record<string, number> = {};
  for (const candidate of reviewCandidates) reviewByTask[candidate.task_id] = (reviewByTask[candidate.task_id] || 0) + 1;
  const historicalAccepted = acceptedCandidates.length;
  const linkedAccepted = acceptedCandidates.filter((row) => Boolean(row.imported_customer_id));
  const acceptedByTask: Record<string, number> = {};
  for (const candidate of linkedAccepted) acceptedByTask[candidate.task_id] = (acceptedByTask[candidate.task_id] || 0) + 1;
  const acceptedCustomerIds = [...new Set(linkedAccepted.map((row) => String(row.imported_customer_id)))];
  const customerProfiles: Array<{id:string;company_name:string|null;deleted_at:string|null;acquisition_scope:string|null;pool_status:string|null;status:string|null;owner_id:string|null}> = [];
  for (let offset = 0; offset < acceptedCustomerIds.length; offset += 200) {
    const profilePage = await admin.from("customers")
      .select("id,company_name,deleted_at,acquisition_scope,pool_status,status,owner_id")
      .in("id", acceptedCustomerIds.slice(offset, offset + 200));
    if (profilePage.error) throw profilePage.error;
    customerProfiles.push(...(profilePage.data || []));
  }
  const currentCustomers = customerProfiles.filter((row) => !row.deleted_at && row.acquisition_scope === "PUBLIC_POOL" && ["AVAILABLE", "CLAIMED"].includes(String(row.pool_status || "")));
  const currentCustomerIds = new Set(currentCustomers.map((row) => row.id));
  const outOfPoolCustomerIds = acceptedCustomerIds.filter((id) => !currentCustomerIds.has(id));
  const customerById = new Map(customerProfiles.map((row) => [row.id, row]));
  const outOfPoolDetails = outOfPoolCustomerIds.map((id) => {
    const profile = customerById.get(id);
    const reason = !profile ? "客户资料不存在" : profile.deleted_at ? "客户已删除" : profile.acquisition_scope !== "PUBLIC_POOL" ? "已不属于客户公海" : profile.pool_status === "PENDING_ALLOCATION" ? "待管理员分配" : profile.pool_status === "INVALID" ? "已标记无效" : "公海状态待核对";
    return { id, company_name: profile?.company_name || "未找到客户名称", reason, acquisition_scope: profile?.acquisition_scope || null, pool_status: profile?.pool_status || null };
  });
  const availableCustomers = currentCustomers.filter((row) => row.pool_status === "AVAILABLE" && row.status === "UNCLAIMED" && !row.owner_id);
  const claimedCustomers = currentCustomers.filter((row) => row.pool_status === "CLAIMED" && row.status !== "UNCLAIMED" && Boolean(row.owner_id));
  const todayStart = new Date(`${today}T00:00:00.000+08:00`).getTime();
  const todayEnd = new Date(`${today}T23:59:59.999+08:00`).getTime();
  const todayAccepted = linkedAccepted.filter((row) => { const timestamp = row.processed_at ? new Date(row.processed_at).getTime() : 0; return timestamp >= todayStart && timestamp <= todayEnd; }).length;
  return {
    tasks: summaryRows.length,
    active_tasks: summaryRows.filter((row) => ["QUEUED", "RUNNING", "PAUSING", "PAUSED"].includes(row.status)).length,
    completed_tasks: summaryRows.filter((row) => row.status === "COMPLETED").length,
    today_accepted: todayAccepted,
    accepted: linkedAccepted.length,
    accepted_by_task: acceptedByTask,
    historical_accepted: historicalAccepted,
    removed_results: Math.max(0, historicalAccepted - linkedAccepted.length),
    repeated_results: Math.max(0, linkedAccepted.length - acceptedCustomerIds.length),
    unique_linked_customers: acceptedCustomerIds.length,
    out_of_pool_customers: outOfPoolCustomerIds.length,
    out_of_pool_details: outOfPoolDetails,
    current_customers: currentCustomers.length,
    available_customers: availableCustomers.length,
    claimed_customers: claimedCustomers.length,
    review: reviewCandidates.length,
    review_by_task: reviewByTask,
    failed_tasks: summaryRows.filter((row) => row.status === "FAILED").length,
  };
}
