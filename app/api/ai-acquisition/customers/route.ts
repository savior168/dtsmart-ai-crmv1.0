import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, hasPermission, requestedOwnerId, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

const validScopes = new Set(["today", "accepted", "review"]);

export async function GET(request: NextRequest) {
  try {
    const { account } = await requirePermission("ai.acquisition.view");
    const ownerId = await requestedOwnerId(request, account, "ai.acquisition.data_all");
    const params = request.nextUrl.searchParams;
    const scope = validScopes.has(params.get("scope") || "") ? String(params.get("scope")) : "accepted";
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize") || 20)));
    const search = (params.get("search")?.trim() || "").replace(/[%_,()]/g, " ");
    const countries = [...new Set(params.getAll("country").map((value) => value.trim()).filter(Boolean))];
    const industries = [...new Set(params.getAll("industry").map((value) => value.trim()).filter(Boolean))];
    const level = params.get("level") || "";
    const taskSearch = (params.get("task_search")?.trim() || "").replace(/[%_,()]/g, " ");
    const taskId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(params.get("task_id") || "") ? String(params.get("task_id")) : "";
    const from = /^\d{4}-\d{2}-\d{2}$/.test(params.get("from") || "") ? String(params.get("from")) : "";
    const to = /^\d{4}-\d{2}-\d{2}$/.test(params.get("to") || "") ? String(params.get("to")) : "";
    const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const admin = createAdminClient();

    // A salesperson normally remembers a task's business name or number, not
    // its UUID. Resolve that text once, then apply the resulting task IDs to
    // every result, summary and option query below.
    let matchedTaskIds: string[] | null = null;
    if (taskSearch) {
      let taskQuery = admin.from("ai_acquisition_tasks").select("id").or(`name.ilike.%${taskSearch}%,task_number.ilike.%${taskSearch}%`).limit(500);
      if (ownerId) taskQuery = taskQuery.eq("user_id", ownerId);
      const taskMatches = await taskQuery;
      if (taskMatches.error) throw taskMatches.error;
      matchedTaskIds = (taskMatches.data || []).map((task) => String(task.id));
    }

    const base = () => {
      let query = admin
        .from("ai_acquisition_candidates")
        .select("*,task:ai_acquisition_tasks!inner(id,task_number,name,user_id)", { count: "exact" });
      if (ownerId) query = query.eq("task.user_id", ownerId);
      if (taskId) query = query.eq("task_id", taskId);
      if (matchedTaskIds) query = matchedTaskIds.length ? query.in("task_id", matchedTaskIds) : query.eq("id", "00000000-0000-0000-0000-000000000000");
      return query;
    };

    let query = base();
    if (scope === "review") query = query.eq("decision", "REVIEW");
    else query = query.eq("decision", "ACCEPTED").not("imported_customer_id", "is", null);
    if (scope === "today") query = query.gte("processed_at", `${today}T00:00:00.000+08:00`).lte("processed_at", `${today}T23:59:59.999+08:00`);
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
    if (countries.length) query = query.in("country", countries);
    if (industries.length) {
      const [industryMatches,categoryMatches]=await Promise.all([
        admin.from("customers").select("id").in("industry",industries).limit(5000),
        admin.from("customers").select("id").in("category",industries).limit(5000),
      ]);
      if(industryMatches.error||categoryMatches.error)throw industryMatches.error||categoryMatches.error;
      const matchingCustomerIds=[...new Set([...(industryMatches.data||[]),...(categoryMatches.data||[])].map((row)=>String(row.id)))];
      query=matchingCustomerIds.length?query.or(`staging_customer_id.in.(${matchingCustomerIds.join(",")}),imported_customer_id.in.(${matchingCustomerIds.join(",")})`):query.eq("id","00000000-0000-0000-0000-000000000000");
    }
    if (["A", "B", "C", "D"].includes(level)) query = query.eq("ai_level", level);
    if (from) query=query.gte("processed_at",`${from}T00:00:00.000+08:00`);
    if (to) query=query.lte("processed_at",`${to}T23:59:59.999+08:00`);
    const result = await query.order("processed_at", { ascending: false, nullsFirst: false }).range((page - 1) * pageSize, page * pageSize - 1);
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

    const summaryQueries = [
      base().eq("decision", "ACCEPTED").not("imported_customer_id", "is", null).gte("processed_at", `${today}T00:00:00.000+08:00`).lte("processed_at", `${today}T23:59:59.999+08:00`).limit(0),
      base().eq("decision", "ACCEPTED").not("imported_customer_id", "is", null).limit(0),
      base().eq("decision", "REVIEW").limit(0),
    ];
    const [todayResult, acceptedResult, reviewResult] = await Promise.all(summaryQueries);
    const summaryError = todayResult.error || acceptedResult.error || reviewResult.error;
    if (summaryError) throw summaryError;

    // Filter choices must describe the current result set, not every industry
    // and country the product can theoretically support. Load the scoped
    // candidates in pages so the option counts are not limited to the visible
    // table page or Supabase's default row cap.
    const optionCandidates: Array<{country:string|null;staging_customer_id:string|null;imported_customer_id:string|null}> = [];
    for (let offset = 0; offset < 20000; offset += 1000) {
      let optionQuery = admin
        .from("ai_acquisition_candidates")
        .select("country,staging_customer_id,imported_customer_id,task:ai_acquisition_tasks!inner(user_id)");
      if (ownerId) optionQuery = optionQuery.eq("task.user_id", ownerId);
      if (taskId) optionQuery = optionQuery.eq("task_id", taskId);
      if (scope === "review") optionQuery = optionQuery.eq("decision", "REVIEW");
      else optionQuery = optionQuery.eq("decision", "ACCEPTED").not("imported_customer_id", "is", null);
      if (scope === "today") optionQuery = optionQuery.gte("processed_at", `${today}T00:00:00.000+08:00`).lte("processed_at", `${today}T23:59:59.999+08:00`);
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
    const countryCounts = new Map<string,number>();
    const industryCounts = new Map<string,number>();
    for (const candidate of optionCandidates) {
      const countryValue = String(candidate.country || "").trim();
      if (countryValue) countryCounts.set(countryValue, (countryCounts.get(countryValue) || 0) + 1);
      const customerId = String(candidate.imported_customer_id || candidate.staging_customer_id || "");
      const profile = optionProfileById.get(customerId);
      const industryValue = String(profile?.industry || profile?.category || "").trim();
      if (industryValue) industryCounts.set(industryValue, (industryCounts.get(industryValue) || 0) + 1);
    }
    const countedOptions = (counts:Map<string,number>) => [...counts.entries()]
      .map(([value,count]) => ({ value, count }))
      .sort((left,right) => right.count - left.count || left.value.localeCompare(right.value, "zh-CN"));

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
        return { ...row, task, source:profile?.source||"AI_ACQUISITION", phone:profile?.phone||null, whatsapp:profile?.whatsapp||null, email:profile?.email||null, website_phone:profile?.website_phone||null, website_email:profile?.website_email||null, verified_contacts:verifiedContactsByCustomer.get(customerId)||[], display_industry:profile?.industry||profile?.category||"待确认行业", website:profile?.website||sourceWebsite?.value_raw||null, website_source:profile?.website?"customer_profile":sourceWebsite?.source_channel||null, facebook_url:profile?.facebook_url||null,instagram_url:profile?.instagram_url||null,linkedin_url:profile?.linkedin_url||null,tiktok_url:profile?.tiktok_url||null,other_public_urls:profile?.other_public_urls||[],can_control:canControlTasks&&(String(task?.user_id||"")===account.id||account.role==="ADMIN") };
      }),
      count: result.count || 0,
      summary: { today: todayResult.count || 0, accepted: acceptedResult.count || 0, review: reviewResult.count || 0 },
      filter_options: { countries: countedOptions(countryCounts), industries: countedOptions(industryCounts) },
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
