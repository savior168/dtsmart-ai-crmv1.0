import { NextRequest, NextResponse } from "next/server";
import { requireUser, writeAudit } from "@/lib/auth/current-user";

type Row = {
  company_name?: string;
  email?: string;
  phone?: string;
  import_meta?: Record<string, unknown>;
  [key: string]: unknown;
};

type RowIdentity = {
  name: string;
  email: string;
  phone: string;
  keys: string[];
};

function norm(value: unknown) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normPhone(value: unknown) {
  return String(value || "").replace(/[^\d+]/g, "");
}

function rowKeys(row: Row): RowIdentity {
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

function isSameCustomer(candidate: Row, incoming: RowIdentity) {
  const candidateName = norm(candidate.company_name);
  if (!candidateName || candidateName !== incoming.name) return false;

  const candidatePhone = normPhone(candidate.phone);
  const candidateEmail = norm(candidate.email);
  return Boolean((incoming.phone && candidatePhone === incoming.phone) || (incoming.email && candidateEmail === incoming.email));
}

async function findExistingCustomer(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], raw: Row, identity: RowIdentity) {
  if (!identity.name || (!identity.phone && !identity.email)) return null;

  const phoneResult = identity.phone
    ? await supabase
      .from("customers")
      .select("id, company_name, phone, email, created_at")
      .is("deleted_at", null)
      .eq("phone", raw.phone)
      .order("created_at", { ascending: true })
      .limit(20)
    : { data: [] as Row[] | null, error: null };
  if (phoneResult.error) throw phoneResult.error;

  const emailResult = identity.email
    ? await supabase
      .from("customers")
      .select("id, company_name, phone, email, created_at")
      .is("deleted_at", null)
      .eq("email", raw.email)
      .order("created_at", { ascending: true })
      .limit(20)
    : { data: [] as Row[] | null, error: null };
  if (emailResult.error) throw emailResult.error;

  const candidates = [...(phoneResult.data || []), ...(emailResult.data || [])] as Row[];
  return candidates.find((candidate) => isSameCustomer(candidate, identity)) || null;
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const { filename, rows } = await request.json() as { filename: string; rows: Row[] };
    if (!Array.isArray(rows) || !rows.length) return NextResponse.json({ error: "没有可导入的数据" }, { status: 400 });

    let success = 0;
    let duplicate = 0;
    let failed = 0;
    const errors: string[] = [];
    const batchSeen = new Set<string>();

    for (const [index, raw] of rows.entries()) {
      try {
        const identity = rowKeys(raw);
        if (!identity.name) throw new Error("名称为空");

        if (identity.keys.some((key) => batchSeen.has(key))) {
          duplicate++;
          continue;
        }
        identity.keys.forEach((key) => batchSeen.add(key));

        const existingCustomer = await findExistingCustomer(supabase, raw, identity);
        if (existingCustomer) {
          duplicate++;
          continue;
        }

        const { import_meta, ...row } = raw;
        const { data, error } = await supabase.from("customers").insert({ ...row, created_by: user.id, owner_id: user.id, ai_screening_done: false }).select("id").single();
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
