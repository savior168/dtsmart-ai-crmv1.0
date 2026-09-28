import { createAdminClient } from "@/lib/supabase/admin";

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
  const summaryRows: Array<{ id:string; status:string; accepted_count:number|null; review_count:number|null }> = [];
  for (let offset = 0; ; offset += 1000) {
    let query = admin.from("ai_acquisition_tasks").select("id,status,accepted_count,review_count");
    if (ownerId) query = query.eq("user_id", ownerId);
    if (["FREE_ONLY", "ADAPTIVE"].includes(costMode)) query = query.eq("cost_mode", costMode);
    if (countries.length) query = query.overlaps("countries", countries);
    if (industries.length) query = query.overlaps("industries", industries);
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("created_at", `${from}T00:00:00.000+08:00`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("created_at", `${to}T23:59:59.999+08:00`);
    if (search) query = query.or(`name.ilike.%${search}%,task_number.ilike.%${search}%`);
    const chunk = await query.order("created_at", { ascending: false }).range(offset, offset + 999);
    if (chunk.error) throw chunk.error;
    summaryRows.push(...(chunk.data || []));
    if ((chunk.data || []).length < 1000) break;
  }
  const sum = (key: "accepted_count" | "review_count") => summaryRows.reduce((total, row) => total + Number(row[key] || 0), 0);
  const historicalAccepted = sum("accepted_count");
  const acceptedCandidates: Array<{ imported_customer_id:string|null; processed_at:string|null }> = [];
  const summaryTaskIds = summaryRows.map((row) => row.id);
  for (let offset = 0; offset < summaryTaskIds.length; offset += 150) {
    for (let rowOffset = 0; ; rowOffset += 1000) {
      const result = await admin.from("ai_acquisition_candidates")
        .select("imported_customer_id,processed_at")
        .in("task_id", summaryTaskIds.slice(offset, offset + 150))
        .eq("decision", "ACCEPTED")
        .order("processed_at", { ascending:false, nullsFirst:false })
        .range(rowOffset, rowOffset + 999);
      if (result.error) throw result.error;
      acceptedCandidates.push(...(result.data || []));
      if ((result.data || []).length < 1000) break;
    }
  }
  const linkedAccepted = acceptedCandidates.filter((row) => Boolean(row.imported_customer_id));
  const acceptedCustomerIds = [...new Set(linkedAccepted.map((row) => String(row.imported_customer_id)))];
  const customerProfiles: Array<{id:string;deleted_at:string|null;acquisition_scope:string|null;pool_status:string|null;status:string|null;owner_id:string|null}> = [];
  for (let offset = 0; offset < acceptedCustomerIds.length; offset += 200) {
    const profilePage = await admin.from("customers")
      .select("id,deleted_at,acquisition_scope,pool_status,status,owner_id")
      .in("id", acceptedCustomerIds.slice(offset, offset + 200));
    if (profilePage.error) throw profilePage.error;
    customerProfiles.push(...(profilePage.data || []));
  }
  const currentCustomers = customerProfiles.filter((row) => !row.deleted_at && row.acquisition_scope === "PUBLIC_POOL" && ["AVAILABLE", "CLAIMED"].includes(String(row.pool_status || "")));
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
    historical_accepted: historicalAccepted,
    removed_results: Math.max(0, historicalAccepted - linkedAccepted.length),
    repeated_results: Math.max(0, linkedAccepted.length - acceptedCustomerIds.length),
    unique_linked_customers: acceptedCustomerIds.length,
    current_customers: currentCustomers.length,
    available_customers: availableCustomers.length,
    claimed_customers: claimedCustomers.length,
    review: sum("review_count"),
    failed_tasks: summaryRows.filter((row) => row.status === "FAILED").length,
  };
}
