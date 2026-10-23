import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyExistingCustomer, customerImportIdentityKeys, potentialCustomerDuplicateReasons } from "@/lib/import-dedupe";

type Row = {
  company_name?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  [key: string]: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const { user, account } = await requirePermission("imports.create");
    const admin = createAdminClient();
    const payload = (await request.json()) as { rows?: Row[]; destination?: string };
    if (payload.destination === "PUBLIC_POOL" && account.role !== "ADMIN") return NextResponse.json({ error: "仅系统管理员可以向客户公海导入数据" }, { status: 403 });
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) {
      return NextResponse.json({ success_count: 0, conflict_count: 0, existing_duplicate_count: 0, suspected_count: 0, suspected_row_indexes: [], suspected_matches: {}, preflight_matches: {} });
    }

    const data: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      const page = await admin.from("customers")
        .select("id,company_name,contact_name,country,phone,whatsapp,email,website,google_url,owner_id,acquisition_scope,pool_status,status")
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .range(from, from + 999);
      if (page.error) throw page.error;
      data.push(...(page.data || []));
      if ((page.data || []).length < 1000) break;
    }

    const existing = new Map<string, Record<string, unknown>>();
    data.forEach((row) =>
      customerImportIdentityKeys(row as Row).forEach((key) => { if (!existing.has(key)) existing.set(key, row); }),
    );

    let conflictCount = 0;
    let existingDuplicates = 0;
    const suspectedRowIndexes: number[] = [];
    const suspectedMatches: Record<number, Array<Record<string, unknown>>> = {};
    const preflightMatches: Record<number, Array<Record<string, unknown>>> = {};
    rows.forEach((row, rowIndex) => {
      const match = customerImportIdentityKeys(row)
        .map((key) => existing.get(key))
        .find(Boolean);
      if (!match) {
        const candidates = data
          .map((existingRow) => ({ existingRow, match_reasons: potentialCustomerDuplicateReasons(row, existingRow as Row) }))
          .filter((candidate) => candidate.match_reasons.length)
          .slice(0, 5)
          .map(({ existingRow, match_reasons }) => ({
            id: existingRow.id,
            company_name: existingRow.company_name,
            country: existingRow.country,
            website: existingRow.website,
            google_url: existingRow.google_url,
            match_reasons,
            ownership_status: classifyExistingCustomer(existingRow, user.id) === "PUBLIC_POOL_AVAILABLE" ? "客户公海待认领" : "已有归属或待管理员处理",
          }));
        if (candidates.length) {
          suspectedRowIndexes.push(rowIndex);
          suspectedMatches[rowIndex] = candidates;
        }
        return;
      }
      const disposition = classifyExistingCustomer(match, user.id);
      const matchedKeys = customerImportIdentityKeys(row).filter((key) => customerImportIdentityKeys(match).includes(key));
      preflightMatches[rowIndex] = [{
        id: match.id,
        company_name: match.company_name,
        country: match.country,
        website: match.website,
        google_url: match.google_url,
        match_reasons: matchedKeys.map((key) => key.startsWith("phone:") ? "电话或 whatsapp 一致" : key.startsWith("email:") ? "邮箱一致" : key.startsWith("website:") ? "官网一致" : "Google 地图主体一致"),
        ownership_status: payload.destination === "PUBLIC_POOL" && match.owner_id
          ? "已有归属，不能重复加入公海"
          : disposition === "PUBLIC_POOL_AVAILABLE" ? "客户公海待认领" : disposition === "OWN_CUSTOMER" ? "我的客户" : "已有归属或待管理员处理",
        action_url: disposition === "PUBLIC_POOL_AVAILABLE" ? `/customers/pool?tab=available&customer=${encodeURIComponent(String(match.id))}` : disposition === "OWN_CUSTOMER" ? `/customers/${encodeURIComponent(String(match.id))}` : null,
      }];
      if ((payload.destination === "PUBLIC_POOL" && Boolean(match.owner_id))
        || (payload.destination !== "PUBLIC_POOL" && (disposition === "OTHER_OWNED_CUSTOMER" || disposition === "UNOWNED_REVIEW_REQUIRED"))) conflictCount += 1;
      else existingDuplicates += 1;
    });

    return NextResponse.json({
      success_count: Math.max(0, rows.length - conflictCount - existingDuplicates),
      conflict_count: conflictCount,
      existing_duplicate_count: existingDuplicates,
      suspected_count: suspectedRowIndexes.length,
      suspected_row_indexes: suspectedRowIndexes,
      suspected_matches: suspectedMatches,
      preflight_matches: preflightMatches,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "导入数据预检失败" },
      { status: 400 },
    );
  }
}
