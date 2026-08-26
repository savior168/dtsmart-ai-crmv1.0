import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { customerIndexIdentityKeys, customerLookupIdentityKeys } from "@/lib/import-dedupe";

type Row = {
  company_name?: string;
  phone?: string;
  email?: string;
  [key: string]: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser();
    const admin = createAdminClient();
    const payload = (await request.json()) as { rows?: Row[] };
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) {
      return NextResponse.json({ success_count: 0, conflict_count: 0 });
    }

    const data: Record<string, unknown>[] = [];
    for (let from = 0; ; from += 1000) {
      const page = await admin.from("customers")
        .select("id,company_name,phone,email,website,google_url,owner_id")
        .order("created_at", { ascending: true })
        .range(from, from + 999);
      if (page.error) throw page.error;
      data.push(...(page.data || []));
      if ((page.data || []).length < 1000) break;
    }

    const existing = new Map<string, Record<string, unknown>>();
    data.forEach((row) =>
      customerIndexIdentityKeys(row as Row).forEach((key) => { if (!existing.has(key)) existing.set(key, row); }),
    );

    const conflictIds = new Set<string>();
    let existingDuplicates = 0;
    rows.forEach((row) => {
      const match = customerLookupIdentityKeys(row)
        .map((key) => existing.get(key))
        .find(Boolean);
      if (match?.owner_id && match.owner_id !== user.id) conflictIds.add(String(match.id));
      else if (match) existingDuplicates += 1;
    });

    return NextResponse.json({
      success_count: Math.max(0, rows.length - conflictIds.size - existingDuplicates),
      conflict_count: conflictIds.size,
      existing_duplicate_count: existingDuplicates,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "导入数据预检失败" },
      { status: 400 },
    );
  }
}
