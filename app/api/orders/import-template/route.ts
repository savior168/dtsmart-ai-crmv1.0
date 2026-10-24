import { NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { authErrorStatus, hasPermission, requirePermission } from "@/lib/auth/current-user";
import { buildPiImportTemplate, type PiTemplateCustomer, type PiTemplateSeller } from "@/lib/pi-import-template";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { createAdminClient } from "@/lib/supabase/admin";

type Profile = { id: string; phone: string | null; email: string | null; business_phone: string | null; business_email: string | null };

function toSeller(user: { id: string; name: string | null; email: string }, profile?: Profile): PiTemplateSeller {
  return {
    id: user.id,
    name: user.name?.trim() || user.email,
    email: user.email,
    business_phone: profile?.business_phone?.trim() || profile?.phone?.trim() || "",
    business_email: profile?.business_email?.trim() || profile?.email?.trim() || user.email,
  };
}

function toTemplateCustomer(customer: Record<string, unknown>): PiTemplateCustomer {
  const entries = Array.isArray(customer.shipping_contact_entries) ? customer.shipping_contact_entries as Array<Record<string, unknown>> : [];
  const preferred = entries.find((entry) => String(entry.recipient || "").trim() || String(entry.phone || "").trim() || String(entry.address || "").trim()) || {};
  return {
    id: String(customer.id || ""),
    owner_id: String(customer.owner_id || ""),
    company_name: String(customer.company_name || ""),
    contact_name: String(preferred.recipient || customer.contact_name || ""),
    phone: String(preferred.phone || customer.phone || ""),
    tax_number: String(customer.tax_number || ""),
    email: String(customer.email || ""),
    address: String(preferred.address || customer.shipping_address || customer.address || ""),
  };
}

async function loadInvoiceTemplateData(supabase: Awaited<ReturnType<typeof requirePermission>>["supabase"], account: Awaited<ReturnType<typeof requirePermission>>["account"]) {
  const admin = createAdminClient();
  const isClerk = account.role === "ORDER_CLERK";
  const canLoadCustomers = hasPermission(account, "orders.create");
  let sellers: PiTemplateSeller[] = [];
  let selectedSeller: PiTemplateSeller | undefined;

  if (isClerk) {
    const { data, error } = await admin.from("users").select("id,name,email").in("role", ["SALES", "SUPERVISOR"])
      .eq("status", "ACTIVE").order("name", { ascending: true }).order("id", { ascending: true });
    if (error) throw error;
    const userRows = data || [];
    if (!userRows.length) throw new Error("当前没有已启用的销售员或主管，无法生成PI导入模板");
    const { data: profiles, error: profileError } = await admin.from("profiles")
      .select("id,phone,email,business_phone,business_email").in("id", userRows.map((user) => user.id));
    if (profileError) throw profileError;
    const profileById = new Map((profiles || []).map((profile) => [profile.id, profile as Profile]));
    sellers = userRows.map((user) => toSeller(user, profileById.get(user.id)));
  } else if (["SALES", "SUPERVISOR"].includes(account.role)) {
    const { data: profile, error } = await supabase.from("profiles")
      .select("id,phone,email,business_phone,business_email").eq("id", account.id).maybeSingle();
    if (error) throw error;
    selectedSeller = toSeller({ id: account.id, name: account.name, email: account.email }, profile as Profile | undefined);
    sellers = [selectedSeller];
  }

  const customers: PiTemplateCustomer[] = [];
  if (canLoadCustomers && sellers.length) {
    const ownerIds = sellers.map((seller) => seller.id);
    for (let offset = 0; ; offset += 1000) {
      const queryClient = isClerk ? admin : supabase;
      const query = queryClient.from("customers").select("id,owner_id,company_name,contact_name,tax_number,phone,email,address,shipping_address,shipping_contact_entries")
        .in("owner_id", ownerIds).is("deleted_at", null).neq("status", "RELEASED")
        .order("owner_id", { ascending: true }).order("company_name", { ascending: true }).order("id", { ascending: true })
        .range(offset, offset + 999);
      const { data, error } = await query;
      if (error) throw error;
      customers.push(...(data || []).map((customer) => toTemplateCustomer(customer as Record<string, unknown>)));
      if ((data || []).length < 1000) break;
    }
  }
  return { sellers, selectedSeller, customers, allowSellerSelection: isClerk };
}

export async function GET(request: Request) {
  try {
    const { supabase, account } = await requirePermission("orders.import");
    const invoiceLayout = new URL(request.url).searchParams.get("format") === "invoice";
    const template = readFileSync(path.join(process.cwd(), "assets", "templates", invoiceLayout ? "PI_Import_Template.xlsx" : "PI_Whole_Order_Import_Template.xlsx"));
    const bytes = invoiceLayout
      ? buildPiImportTemplate(template, { ...await loadInvoiceTemplateData(supabase, account), now: new Date() })
      : template;
    if (bytes.byteLength > 2 * 1024 * 1024) throw new Error("当前PI模板包含的客户资料过多，超过2MB限制；请缩小可选客户范围后重试");
    return new NextResponse(new Uint8Array(bytes), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${invoiceLayout ? "PI-invoice-layout-template" : "PI-full-data-template"}.xlsx`,
      "Cache-Control": "private, no-store",
    } });
  } catch (error) {
    const message = sqlErrorMessage(error, "PI导入模板下载失败");
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
