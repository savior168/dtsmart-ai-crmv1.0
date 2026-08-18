import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

type Row = {
  company_name?: string;
  phone?: string;
  email?: string;
  [key: string]: unknown;
};

const text = (value: unknown) => String(value || "").trim();
const nameKey = (value: unknown) => text(value).replace(/\s+/g, " ").toLowerCase();
const phoneKey = (value: unknown) => text(value).replace(/[\s()\-]/g, "");
const emailKey = (value: unknown) => text(value).toLowerCase();

function keys(row: Row) {
  const name = nameKey(row.company_name);
  const phone = phoneKey(row.phone);
  const email = emailKey(row.email);
  return [
    phone ? `p:${name}|${phone}` : "",
    email ? `e:${name}|${email}` : "",
  ].filter(Boolean);
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireUser();
    const admin = createAdminClient();
    const payload = (await request.json()) as { rows?: Row[] };
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    if (!rows.length) {
      return NextResponse.json({ success_count: 0, conflict_count: 0 });
    }

    const { data, error } = await admin
      .from("customers")
      .select("id,company_name,phone,email,owner_id")
      .is("deleted_at", null)
      .limit(10000);
    if (error) throw error;

    const existing = new Map<string, Record<string, unknown>>();
    (data || []).forEach((row) =>
      keys(row as Row).forEach((key) => existing.set(key, row)),
    );

    let conflicts = 0;
    rows.forEach((row) => {
      const match = keys(row)
        .map((key) => existing.get(key))
        .find(Boolean);
      if (match?.owner_id && match.owner_id !== user.id) conflicts += 1;
    });

    return NextResponse.json({
      success_count: Math.max(0, rows.length - conflicts),
      conflict_count: conflicts,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "导入数据预检失败" },
      { status: 400 },
    );
  }
}
