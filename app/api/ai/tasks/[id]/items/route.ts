import { NextRequest, NextResponse } from "next/server";
import { hasPermission, requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { countryFilterOptions, countryFilterRawValues } from "@/lib/countries";
import { canReadAiOwner } from "@/lib/ai/owner-scope";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, account } = await requirePermission("ai.tasks.view");
    const { id } = await context.params;
    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") || 1));
    const pageSize = Math.min(500, Math.max(10, Number(params.get("pageSize") || 20)));
    const status = params.get("status") || "";
    const step = params.get("step") || "";
    const retry = params.get("retry") || "";
    const industries = [...new Set(params.getAll("industry").map((value) => value.trim()).filter(Boolean))];
    const countries = [...new Set(params.getAll("country").map((value) => value.trim()).filter(Boolean))];
    const target = params.get("target") || "";
    const grade = params.get("grade") || "";
    const options = params.get("options") || "";
    const search = params.get("search")?.trim() || "";
    const admin = createAdminClient();
    const task = await admin.from("ai_screening_tasks").select("id,user_id").eq("id", id).maybeSingle();
    if (task.error) throw task.error;
    if (!task.data) throw new Error("TASK_NOT_FOUND");
    if (task.data.user_id !== user.id && (!hasPermission(account, "ai.data_all") || !await canReadAiOwner(account, task.data.user_id))) throw new Error("FORBIDDEN");
    if (options === "industries" || options === "filters") {
      const values: string[] = [];
      for (let offset = 0; ; offset += 1000) {
        const pageResult = await admin.from("ai_screening_results")
          .select("industry_type")
          .eq("task_id", id)
          .eq("is_latest_valid", true)
          .range(offset, offset + 999);
        if (pageResult.error) throw pageResult.error;
        const rows = pageResult.data || [];
        for (const row of rows) {
          const value = String(row.industry_type || "").trim();
          if (value) values.push(value);
        }
        if (rows.length < 1000) break;
      }
      const data = [...new Set(values)].sort((left, right) => left.localeCompare(right, "zh-CN"));
      if(options === "industries")return NextResponse.json({ data, count: data.length });
      const countryRows:Array<{customer:{country?:string | null} | Array<{country?:string | null}> | null}>=[];
      for(let offset=0;;offset+=1000){const countryPage=await admin.from("ai_screening_task_items").select("customer:customers!inner(country)").eq("task_id",id).range(offset,offset+999);if(countryPage.error)throw countryPage.error;countryRows.push(...(countryPage.data||[]));if((countryPage.data||[]).length<1000)break}
      const counted=(items:string[])=>[...items.reduce((map,value)=>{const normalized=value.trim();if(normalized)map.set(normalized,(map.get(normalized)||0)+1);return map},new Map<string,number>())].map(([value,count])=>({value,label:value,count})).sort((left,right)=>right.count-left.count||left.label.localeCompare(right.label,"zh-CN"));
      return NextResponse.json({industries:counted(values),countries:countryFilterOptions(countryRows.map((row)=>{const customer=Array.isArray(row.customer)?row.customer[0]:row.customer;return customer?.country}))});
    }
    const safeSearch = search.replace(/[,%()]/g," ").trim();
    let query = admin.from("ai_screening_task_items").select("*,customer:customers!inner(id,company_name,contact_name,phone,email,country,industry,is_target_customer,ai_score,ai_level)", { count: "exact" }).eq("task_id", id);
    if (status) query = query.eq("status", status);
    if (step) query = query.eq("current_step", step);
    if (retry === "none") query = query.eq("attempt_count", 0);
    if (retry === "retrying") query = query.gt("attempt_count", 0).lt("attempt_count", 3);
    if (retry === "exhausted") query = query.gte("attempt_count", 3);
    if (countries.length) {
      const customerRows=await admin.from("customers").select("id").in("country",countryFilterRawValues(countries)).limit(10000);
      if(customerRows.error)throw customerRows.error;
      const customerIds=(customerRows.data||[]).map((row)=>String(row.id));
      if(!customerIds.length)return NextResponse.json({data:[],count:0,page,pageSize});
      query=query.in("customer_id",customerIds);
    }
    if (industries.length || (grade && ["A", "B", "C", "D"].includes(grade)) || ["valid", "invalid", "review"].includes(target)) {
      const decision = target === "valid" ? "VALID" : target === "invalid" ? "INVALID" : "REVIEW";
      let resultFilter = admin.from("ai_screening_results").select("task_item_id").eq("task_id", id).eq("is_latest_valid", true);
      if (industries.length) resultFilter = resultFilter.in("industry_type", industries);
      if (grade && ["A", "B", "C", "D"].includes(grade)) resultFilter = resultFilter.eq("grade", grade);
      if (["valid", "invalid", "review"].includes(target)) resultFilter = resultFilter.eq("target_decision", decision);
      const decisions = await resultFilter;
      if (decisions.error) throw decisions.error;
      const itemIds = (decisions.data || []).map((item) => item.task_item_id).filter(Boolean);
      if (!itemIds.length) return NextResponse.json({ data: [], count: 0, page, pageSize });
      query = query.in("id", itemIds);
    }
    if (safeSearch) query = query.or(`company_name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%`, { referencedTable: "customers" });
    const result = await query
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (result.error) throw result.error;
    const rows = result.data || [];
    const resultIds = [...new Set(rows.map((row) => String(row.result_id || "")).filter(Boolean))];
    const analysisResults = resultIds.length
      ? await admin.from("ai_screening_results").select("id,score,grade,target_decision,industry_type").in("id", resultIds)
      : { data: [], error: null };
    if (analysisResults.error) throw analysisResults.error;
    const resultById = new Map((analysisResults.data || []).map((row) => [String(row.id), row]));
    const customerIds = [...new Set(rows.map((row) => String(row.customer_id || "")).filter(Boolean))];
    const placesByCustomer = new Map<string, number>();
    const placeSkusByCustomer = new Map<string, Record<string, { count: number; amount_usd: number }>>();
    if (customerIds.length) {
      for (let offset = 0; ; offset += 1000) {
        const ledger = await admin.from("api_cost_ledger")
          .select("customer_id,quantity,model_or_sku,amount_usd")
          .eq("task_id", id)
          .eq("provider", "GOOGLE_PLACES")
          .in("customer_id", customerIds)
          .range(offset, offset + 999);
        if (ledger.error) throw ledger.error;
        const calls = ledger.data || [];
        for (const call of calls) {
          const customerId = String(call.customer_id || "");
          if (!customerId) continue;
          const quantity = Math.max(0, Number(call.quantity || 1));
          placesByCustomer.set(customerId, (placesByCustomer.get(customerId) || 0) + quantity);
          const sku = String(call.model_or_sku || "HISTORICAL_UNCLASSIFIED");
          const breakdown = placeSkusByCustomer.get(customerId) || {};
          const current = breakdown[sku] || { count: 0, amount_usd: 0 };
          breakdown[sku] = { count: current.count + quantity, amount_usd: Number((current.amount_usd + Number(call.amount_usd || 0)).toFixed(6)) };
          placeSkusByCustomer.set(customerId, breakdown);
        }
        if (calls.length < 1000) break;
      }
    }
    const data = rows.map((row) => ({
      ...row,
      result: resultById.get(String(row.result_id || "")) || null,
      google_places_call_count: placesByCustomer.get(String(row.customer_id || "")) || 0,
      google_places_sku_breakdown: placeSkusByCustomer.get(String(row.customer_id || "")) || {},
    }));
    return NextResponse.json({ data, count: result.count || 0, page, pageSize });
  } catch (error) {
    const message = error instanceof Error ? error.message : "任务客户查询失败";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
