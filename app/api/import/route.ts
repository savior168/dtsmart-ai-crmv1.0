import { NextRequest, NextResponse } from "next/server";
import { requireUser, writeAudit } from "@/lib/auth/current-user";

type Row = {
  company_name?: string;
  email?: string;
  phone?: string;
  import_meta?: Record<string, unknown>;
  [key: string]: unknown;
};

function norm(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normPhone(value: unknown) {
  return String(value || "").replace(/[^\d+]/g, "");
}

function rowKeys(row: Row) {
  const name = norm(row.company_name);
  const email = norm(row.email);
  const phone = normPhone(row.phone);
  return {
    name,
    email,
    phone,
    keys: [phone ? `name-phone:${name}|${phone}` : "", email ? `name-email:${name}|${email}` : ""].filter(Boolean),
  };
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const { filename, rows } = await request.json() as { filename: string; rows: Row[] };
    if (!Array.isArray(rows) || !rows.length) return NextResponse.json({ error: "没有可导入的数据" }, { status: 400 });

    let success = 0, duplicate = 0, failed = 0;
    const errors: string[] = [];
    const batchSeen = new Set<string>();

    for (const [index, raw] of rows.entries()) {
      try {
        const { name, email, phone, keys } = rowKeys(raw);
        if (!name) throw new Error("名称为空");
        if (keys.some((key) => batchSeen.has(key))) {
          duplicate++;
          continue;
        }
        keys.forEach((key) => batchSeen.add(key));

        let existingByPhone: unknown[] | null = null;
        let existingByEmail: unknown[] | null = null;
        if (phone) {
          const result = await supabase.from("customers").select("id").is("deleted_at", null).eq("company_name", raw.company_name).eq("phone", raw.phone).limit(1);
          existingByPhone = result.data;
        }
        if (email) {
          const result = await supabase.from("customers").select("id").is("deleted_at", null).eq("company_name", raw.company_name).eq("email", raw.email).limit(1);
          existingByEmail = result.data;
        }
        if (existingByPhone?.length || existingByEmail?.length) {
          duplicate++;
          continue;
        }

        const { import_meta, ...row } = raw;
        const { data, error } = await supabase.from("customers").insert({ ...row, created_by: user.id, owner_id: null }).select("id").single();
        if (error) throw error;
        success++;
        await writeAudit(supabase, user.id, "CUSTOMER_IMPORT", "customer", data.id, { filename, row: index + 2, import_meta });
      } catch (error) {
        failed++;
        errors.push(`第 ${index + 2} 行：${error instanceof Error ? error.message : "导入失败"}`);
      }
    }

    const stats = { total_count: rows.length, success_count: success, duplicate_count: duplicate, failed_count: failed };
    const { data: task, error: taskError } = await supabase.from("import_tasks").insert({ filename, ...stats, created_by: user.id }).select().single();
    if (taskError) throw taskError;
    await writeAudit(supabase, user.id, "IMPORT_COMPLETE", "import_task", task.id, { filename, ...stats });
    return NextResponse.json({ ...stats, errors });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "导入失败" }, { status: 400 });
  }
}
