import { NextRequest, NextResponse } from "next/server";
import { countryFilterOptions, countryFilterRawValues } from "@/lib/countries";
import { authErrorStatus, hasPermission, requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { officialWebsiteUrl, publicChannelForUrl } from "@/lib/public-url";

const validScopes = new Set(["today", "week", "accepted", "review"]);
type CountedFilterOption = { value: string; count: number };
type FilterOptions = { countries: CountedFilterOption[]; industries: CountedFilterOption[] };
type AcquisitionResultRow = {
  imported_customer_id: string | null;
  staging_customer_id: string | null;
  task: { id: string; task_number: string; name: string; user_id: string } | Array<{ id: string; task_number: string; name: string; user_id: string }> | null;
  [key: string]: unknown;
};
const filterOptionsCache = new Map<string, { expiresAt: number; value: FilterOptions }>();

export async function GET(request: NextRequest) {
  try {
    const { account } = await requirePermission("ai.acquisition.view");
    const ownerId = await requestedOwnerId(request, account, "ai.acquisition.data_all");
    const params = request.nextUrl.searchParams;
    const mode = params.get("mode") === "summary" ? "summary" : params.get("mode") === "filters" ? "filters" : "core";
    const scope = validScopes.has(params.get("scope") || "") ? String(params.get("scope")) : "accepted";
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(500, Math.max(10, Number(params.get("pageSize") || 20)));
    const search = (params.get("search")?.trim() || "").replace(/[%_,()]/g, " ");
    const countries = [...new Set(params.getAll("country").map((value) => value.trim()).filter(Boolean))];
    const industries = [...new Set(params.getAll("industry").map((value) => value.trim()).filter(Boolean))];
    const level = params.get("level") || "";
    if (level && !["A", "B", "C", "D"].includes(level)) {
      return NextResponse.json({ error: "无效的AI等级筛选条件" }, { status: 400 });
    }
    const taskSearch = (params.get("task_search")?.trim() || "").replace(/[%_,()]/g, " ");
    const taskCostMode = params.get("task_cost_mode") || "";
    const taskCountries = [...new Set(params.getAll("task_country").map((value) => value.trim()).filter(Boolean))];
    const taskIndustries = [...new Set(params.getAll("task_industry").map((value) => value.trim()).filter(Boolean))];
    const taskFrom = /^\d{4}-\d{2}-\d{2}$/.test(params.get("task_from") || "") ? String(params.get("task_from")) : "";
    const taskTo = /^\d{4}-\d{2}-\d{2}$/.test(params.get("task_to") || "") ? String(params.get("task_to")) : "";
    const taskId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.get("task_id") || "") ? String(params.get("task_id")) : "";
    const from = /^\d{4}-\d{2}-\d{2}$/.test(params.get("from") || "") ? String(params.get("from")) : "";
    const to = /^\d{4}-\d{2}-\d{2}$/.test(params.get("to") || "") ? String(params.get("to")) : "";
    const chinaNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const today = chinaNow.toISOString().slice(0, 10);
    const weekStart = new Date(chinaNow);
    weekStart.setUTCDate(chinaNow.getUTCDate() - ((chinaNow.getUTCDay() + 6) % 7));
    const weekStartDate = weekStart.toISOString().slice(0, 10);
    const admin = createAdminClient();

    const base = (filterIndustry = false) => {
      // REVIEW rows reference their staging customer; accepted rows reference
      // the promoted customer. Filter on that FK in PostgREST instead of
      // expanding every matching customer into a potentially enormous URL.
      const selectColumns: string = filterIndustry
        ? scope === "review"
          ? "*,task:ai_acquisition_tasks!inner(id,task_number,name,user_id,cost_mode,countries,industries,created_at),industry_customer:staging_customer_id!inner(id,industry,category)"
          : "*,task:ai_acquisition_tasks!inner(id,task_number,name,user_id,cost_mode,countries,industries,created_at),industry_customer:imported_customer_id!inner(id,industry,category)"
        : "*,task:ai_acquisition_tasks!inner(id,task_number,name,user_id,cost_mode,countries,industries,created_at)";
      let query = admin
        .from("ai_acquisition_candidates")
        .select(selectColumns, { count: "exact" });
      if (ownerId) query = query.eq("task.user_id", ownerId);
      if (taskId) query = query.eq("task_id", taskId);
      if (taskSearch) query = query.or(`name.ilike.%${taskSearch}%,task_number.ilike.%${taskSearch}%`, { referencedTable:"task" });
      if (["FREE_ONLY", "ADAPTIVE"].includes(taskCostMode)) query = query.eq("task.cost_mode", taskCostMode);
      if (taskCountries.length) query = query.overlaps("task.countries", countryFilterRawValues(taskCountries));
      if (taskIndustries.length) query = query.overlaps("task.industries", taskIndustries);
      if (taskFrom) query = query.gte("task.created_at", `${taskFrom}T00:00:00.000+08:00`);
      if (taskTo) query = query.lte("task.created_at", `${taskTo}T23:59:59.999+08:00`);
      return query;
    };

    let query = base(mode === "core" && industries.length > 0);
    if (scope === "review") query = query.eq("decision", "REVIEW");
    else query = query.eq("decision", "ACCEPTED").not("imported_customer_id", "is", null);
    if (scope === "today") query = query.gte("processed_at", `${today}T00:00:00.000+08:00`).lte("processed_at", `${today}T23:59:59.999+08:00`);
    if (scope === "week") query = query.gte("processed_at", `${weekStartDate}T00:00:00.000+08:00`).lte("processed_at", `${today}T23:59:59.999+08:00`);
    if (search) {
      const [customerMatches,contactMatches] = await Promise.all([
        admin.from("customers").select("id").or(`company_name.ilike.%${search}%,address.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%,whatsapp.ilike.%${search}%,website.ilike.%${search}%,google_url.ilike.%${search}%`).limit(5000),
        admin.from("customer_contacts").select("customer_id").or(`value_raw.ilike.%${search}%,value_normalized.ilike.%${search}%`).limit(5000),
      ]);
      if (customerMatches.error || contactMatches.error) throw customerMatches.error || contactMatches.error;
      const matchingCustomerIds = [...new Set([...(customerMatches.data || []).map((row) => String(row.id)),...(contactMatches.data || []).map((row) => String(row.customer_id))])];
      const searchConditions = [`company_name.ilike.%${search}%`,`address.ilike.%${search}%`];
      if (matchingCustomerIds.length) searchConditions.push(`staging_customer_id.in.(${matchingCustomerIds.join(",")})`,`imported_customer_id.in.(${matchingCustomerIds.join(",")})`);
      query = query.or(searchConditions.join(","));
    }
    if (countries.length) query = query.in("country", countryFilterRawValues(countries));
    if (industries.length && mode === "core") {
      const quoted = industries.map((industry) => JSON.stringify(industry)).join(",");
      query = query.or(`industry.in.(${quoted}),category.in.(${quoted})`, { referencedTable: "industry_customer" });
    }
    if (["A", "B", "C", "D"].includes(level)) query = query.eq("effective_level", level);
    if (from) query=query.gte("processed_at",`${from}T00:00:00.000+08:00`);
    if (to) query=query.lte("processed_at",`${to}T23:59:59.999+08:00`);
    const result = mode === "core"
      ? await query.order("processed_at", { ascending: false, nullsFirst: false }).range((page - 1) * pageSize, page * pageSize - 1).returns<AcquisitionResultRow[]>()
      : { data: [], count: 0, error: null };
    if (result.error) throw result.error;
    const rows = result.data || [];
    const customerIds = [...new Set(rows.map((row) => String(row.imported_customer_id || row.staging_customer_id || "")).filter(Boolean))];
    const [profiles,customerContacts] = customerIds.length ? await Promise.all([
      admin.from("customers").select("id,source,country,industry,category,phone,whatsapp,email,website,website_phone,website_email,facebook_url,instagram_url,linkedin_url,tiktok_url,other_public_urls").in("id", customerIds),
      admin.from("customer_contacts").select("customer_id,type,value_raw,source_channel,exact_source_url,verification_status,captured_at").in("customer_id",customerIds).in("type",["PHONE","EMAIL","WHATSAPP","WEBSITE"]).order("captured_at",{ascending:false}),
    ]) : [{ data: [], error: null },{ data: [], error: null }];
    if (profiles.error||customerContacts.error) throw profiles.error||customerContacts.error;
    const profileById = new Map((profiles.data || []).map((profile) => [String(profile.id), profile]));
    const sourceWebsiteByCustomer=new Map<string,{value_raw:string;source_channel:string;verification_status:string}>();
    const verifiedContactsByCustomer=new Map<string,Array<{type:string|null;value_raw:string|null;source_channel:string|null;exact_source_url:string|null;verification_status:string|null;captured_at:string|null}>>();
    for(const contact of customerContacts.data||[]){
      const customerId=String(contact.customer_id);
      if(contact.type==="WEBSITE"){
        if(!sourceWebsiteByCustomer.has(customerId)&&String(contact.value_raw||"").trim())sourceWebsiteByCustomer.set(customerId,contact as {value_raw:string;source_channel:string;verification_status:string});
        continue;
      }
      const items=verifiedContactsByCustomer.get(customerId)||[];
      items.push(contact);
      verifiedContactsByCustomer.set(customerId,items);
    }

    const summaryQueries = mode === "summary" ? [
      base().eq("decision", "ACCEPTED").not("imported_customer_id", "is", null).gte("processed_at", `${today}T00:00:00.000+08:00`).lte("processed_at", `${today}T23:59:59.999+08:00`).limit(0),
      base().eq("decision", "ACCEPTED").not("imported_customer_id", "is", null).gte("processed_at", `${weekStartDate}T00:00:00.000+08:00`).lte("processed_at", `${today}T23:59:59.999+08:00`).limit(0),
      base().eq("decision", "ACCEPTED").not("imported_customer_id", "is", null).limit(0),
      base().eq("decision", "REVIEW").limit(0),
    ] : [];
    const [todayResult, weekResult, acceptedResult, reviewResult] = mode === "summary"
      ? await Promise.all(summaryQueries)
      : [{ count: 0, error: null }, { count: 0, error: null }, { count: 0, error: null }, { count: 0, error: null }];
    const summaryError = todayResult.error || weekResult.error || acceptedResult.error || reviewResult.error;
    if (summaryError) throw summaryError;

    // Filter choices must describe the current result set, not every industry
    // and country the product can theoretically support. Load the scoped
    // candidates in pages so the option counts are not limited to the visible
    // table page or Supabase's default row cap.
    let filterOptions: FilterOptions = { countries: [], industries: [] };
    if (mode === "filters") {
      const optionsCacheKey = JSON.stringify([ownerId || "all", taskId || "all", taskSearch, taskCostMode, taskCountries, taskIndustries, taskFrom, taskTo, scope, today]);
      const cachedFilterOptions = filterOptionsCache.get(optionsCacheKey);
      const cachedValue = cachedFilterOptions?.expiresAt && cachedFilterOptions.expiresAt > Date.now()
        ? cachedFilterOptions.value
        : null;
      if (cachedValue) filterOptions = cachedValue;
      else {
      const optionCandidates: Array<{country:string|null;staging_customer_id:string|null;imported_customer_id:string|null}> = [];
      for (let offset = 0; offset < 20000; offset += 1000) {
        let optionQuery = admin
          .from("ai_acquisition_candidates")
          .select("country,staging_customer_id,imported_customer_id,task:ai_acquisition_tasks!inner(user_id,name,task_number,cost_mode,countries,industries,created_at)");
        if (ownerId) optionQuery = optionQuery.eq("task.user_id", ownerId);
        if (taskId) optionQuery = optionQuery.eq("task_id", taskId);
        if (taskSearch) optionQuery = optionQuery.or(`name.ilike.%${taskSearch}%,task_number.ilike.%${taskSearch}%`, { referencedTable:"task" });
        if (["FREE_ONLY", "ADAPTIVE"].includes(taskCostMode)) optionQuery = optionQuery.eq("task.cost_mode", taskCostMode);
        if (taskCountries.length) optionQuery = optionQuery.overlaps("task.countries", countryFilterRawValues(taskCountries));
        if (taskIndustries.length) optionQuery = optionQuery.overlaps("task.industries", taskIndustries);
        if (taskFrom) optionQuery = optionQuery.gte("task.created_at", `${taskFrom}T00:00:00.000+08:00`);
        if (taskTo) optionQuery = optionQuery.lte("task.created_at", `${taskTo}T23:59:59.999+08:00`);
        if (scope === "review") optionQuery = optionQuery.eq("decision", "REVIEW");
        else optionQuery = optionQuery.eq("decision", "ACCEPTED").not("imported_customer_id", "is", null);
        if (scope === "today") optionQuery = optionQuery.gte("processed_at", `${today}T00:00:00.000+08:00`).lte("processed_at", `${today}T23:59:59.999+08:00`);
        if (scope === "week") optionQuery = optionQuery.gte("processed_at", `${weekStartDate}T00:00:00.000+08:00`).lte("processed_at", `${today}T23:59:59.999+08:00`);
        const optionPage = await optionQuery.range(offset, offset + 999);
        if (optionPage.error) throw optionPage.error;
        const pageRows = optionPage.data || [];
        optionCandidates.push(...pageRows.map((row) => ({
          country: row.country,
          staging_customer_id: row.staging_customer_id,
          imported_customer_id: row.imported_customer_id,
        })));
        if (pageRows.length < 1000) break;
      }
      const optionCustomerIds = [...new Set(optionCandidates.map((row) => String(row.imported_customer_id || row.staging_customer_id || "")).filter(Boolean))];
      const optionProfiles: Array<{id:string;industry:string|null;category:string|null}> = [];
      for (let offset = 0; offset < optionCustomerIds.length; offset += 500) {
        const profilePage = await admin.from("customers").select("id,industry,category").in("id", optionCustomerIds.slice(offset, offset + 500));
        if (profilePage.error) throw profilePage.error;
        optionProfiles.push(...(profilePage.data || []));
      }
      const optionProfileById = new Map(optionProfiles.map((profile) => [String(profile.id), profile]));
      const industryCounts = new Map<string,number>();
      for (const candidate of optionCandidates) {
        const customerId = String(candidate.imported_customer_id || candidate.staging_customer_id || "");
        const profile = optionProfileById.get(customerId);
        const industryValue = String(profile?.industry || profile?.category || "").trim();
        if (industryValue) industryCounts.set(industryValue, (industryCounts.get(industryValue) || 0) + 1);
      }
      const countedOptions = (counts:Map<string,number>) => [...counts.entries()]
        .map(([value,count]) => ({ value, count }))
        .sort((left,right) => right.count - left.count || left.value.localeCompare(right.value, "zh-CN"));
        filterOptions = { countries: countryFilterOptions(optionCandidates.map((candidate)=>candidate.country)), industries: countedOptions(industryCounts) };
        filterOptionsCache.set(optionsCacheKey, { expiresAt: Date.now() + 5 * 60_000, value: filterOptions });
      }
    }

    const canControlTasks = hasPermission(account, "ai.acquisition.control");
    let filterTask:null|{id:string;task_number:string;name:string;countries:string[];industries:string[];keywords:string[]}=null;
    if(taskId){
      let filterTaskQuery=admin.from("ai_acquisition_tasks").select("id,task_number,name,user_id,countries,industries,industry,keywords").eq("id",taskId);
      if(ownerId)filterTaskQuery=filterTaskQuery.eq("user_id",ownerId);
      const filterTaskResult=await filterTaskQuery.maybeSingle();
      if(filterTaskResult.error)throw filterTaskResult.error;
      if(filterTaskResult.data)filterTask={
        id:String(filterTaskResult.data.id),
        task_number:String(filterTaskResult.data.task_number),
        name:String(filterTaskResult.data.name),
        countries:Array.isArray(filterTaskResult.data.countries)?filterTaskResult.data.countries.map(String):[],
        industries:Array.isArray(filterTaskResult.data.industries)&&filterTaskResult.data.industries.length?filterTaskResult.data.industries.map(String):[String(filterTaskResult.data.industry||"")].filter(Boolean),
        keywords:Array.isArray(filterTaskResult.data.keywords)?filterTaskResult.data.keywords.map(String):[],
      };
    }
    return NextResponse.json({
      data: rows.map((row) => {
        const customerId=String(row.imported_customer_id || row.staging_customer_id || "");
        const profile=profileById.get(customerId);
        const sourceWebsite=sourceWebsiteByCustomer.get(customerId);
        const task = Array.isArray(row.task) ? row.task[0] : row.task;
        const rawWebsite=profile?.website||sourceWebsite?.value_raw||null;
        const website=officialWebsiteUrl(rawWebsite);
        const historicalChannel=publicChannelForUrl(rawWebsite);
        return { ...row, task, source:profile?.source||"AI_ACQUISITION", phone:profile?.phone||null, whatsapp:profile?.whatsapp||null, email:profile?.email||null, website_phone:profile?.website_phone||null, website_email:profile?.website_email||null, verified_contacts:verifiedContactsByCustomer.get(customerId)||[], display_industry:profile?.industry||profile?.category||"待确认行业", website, website_source:website?(profile?.website?"customer_profile":sourceWebsite?.source_channel||null):null, facebook_url:profile?.facebook_url||(historicalChannel==="facebook"?rawWebsite:null),instagram_url:profile?.instagram_url||(historicalChannel==="instagram"?rawWebsite:null),linkedin_url:profile?.linkedin_url||(historicalChannel==="linkedin"?rawWebsite:null),tiktok_url:profile?.tiktok_url||(historicalChannel==="tiktok"?rawWebsite:null),other_public_urls:profile?.other_public_urls||[],can_control:canControlTasks&&(String(task?.user_id||"")===account.id||account.role==="ADMIN") };
      }),
      count: result.count || 0,
      summary: { today: todayResult.count || 0, week: weekResult.count || 0, accepted: acceptedResult.count || 0, review: reviewResult.count || 0 },
      filter_options: filterOptions,
      filter_task: filterTask,
      show_owner: hasPermission(account, "ai.acquisition.data_all"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI获客客户结果加载失败";
    console.error("AI acquisition customer results failed", error);
    const publicMessage = ["UNAUTHORIZED", "SESSION_REVOKED", "FORBIDDEN", "PASSWORD_CHANGE_REQUIRED"].includes(message) || message.startsWith("ACCOUNT_") ? message : "AI获客客户结果加载失败，请稍后重试";
    return NextResponse.json({ error: publicMessage }, { status: authErrorStatus(publicMessage) });
  }
}
