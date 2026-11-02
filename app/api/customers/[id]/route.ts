import { NextRequest, NextResponse } from "next/server";
import { requirePermission, writeAudit } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { permanentlyDeleteCustomers } from "@/lib/customers/soft-delete";
import { customerIndexIdentityKeys, customerLookupIdentityKeys } from "@/lib/import-dedupe";
import { assertOfficialWebsiteUrl, officialWebsiteUrl, publicChannelForUrl } from "@/lib/public-url";
import { manualContactColumns, normalizeManualContacts } from "@/lib/contacts/manual-contact-list";
import { sqlErrorMessage } from "@/lib/sales-flow";
import { normalizeAddressPayload } from "@/lib/customers/address-list";
import { normalizeCustomerGrade } from "@/lib/customers/customer-grade";

// Only user-entered source data is editable here. AI conclusions, verified
// contacts, ownership and workflow state must be changed by their dedicated
// server-side flows so an operator cannot overwrite traceable analysis data.
const writable = [
  "company_name", "contact_name", "country", "phone", "whatsapp", "email",
  "website", "google_url", "address", "category", "notes",
  "facebook_url", "instagram_url", "linkedin_url", "tiktok_url", "other_public_urls",
  "wechat", "tax_number", "manual_grade", "tally_requirements", "forwarder_address", "other_address", "shipping_address", "shipping_addresses", "shipping_contact_entries", "forwarder_addresses", "forwarder_contact_entries",
];

async function assertNoDuplicateIdentity(customerId: string, payload: Record<string, unknown>, current: Record<string, unknown>) {
  const admin = createAdminClient();
  const candidate = { ...current, ...payload };
  const lookupKeys = customerLookupIdentityKeys(candidate);
  if (!lookupKeys.length) return;
  const existingKeys = customerLookupIdentityKeys(current);
  if (lookupKeys.length === existingKeys.length && lookupKeys.every((key) => existingKeys.includes(key))) return;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await admin.from("customers")
      .select("id,company_name,phone,phone_numbers,whatsapp,whatsapp_numbers,email,email_addresses,website,google_url")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (page.error) throw page.error;
    rows.push(...(page.data || []));
    if ((page.data || []).length < 1000) break;
  }
  const duplicate = rows.find((row) => row.id !== customerId && customerIndexIdentityKeys(row)
    .some((key) => lookupKeys.includes(key)));
  if (duplicate) throw new Error("电话、whatsapp或邮箱已与系统客户重复，不能保存；请先在客户公海或冲突客户中核对");
}

function validateExternalUrl(value: unknown, label: string, host?: RegExp) {
  const text = String(value || "").trim();
  if (!text) return;
  let parsed: URL;
  try { parsed = new URL(text); } catch { throw new Error(`${label}必须是完整的 http:// 或 https:// 链接`); }
  if (!/^https?:$/.test(parsed.protocol)) throw new Error(`${label}只支持 http:// 或 https:// 链接`);
  if (host && !host.test(parsed.hostname.toLowerCase())) throw new Error(`${label}与所选平台域名不匹配`);
}

function validateCustomerContactPayload(payload: Record<string, unknown>) {
  for (const kind of ["phone", "email", "wechat", "whatsapp"] as const) {
    if (kind in payload) payload[kind] = normalizeManualContacts(payload[kind], kind) || null;
  }
  validateExternalUrl(payload.website, "官网网址");
  assertOfficialWebsiteUrl(payload.website);
  validateExternalUrl(payload.google_url, "Google 地图网址", /(^|\.)google\.[a-z.]+$|(^|\.)googleusercontent\.com$|(^|\.)goo\.gl$/);
  validateExternalUrl(payload.facebook_url, "Facebook 链接", /(^|\.)facebook\.com$|(^|\.)fb\.com$/);
  validateExternalUrl(payload.instagram_url, "Instagram 链接", /(^|\.)instagram\.com$/);
  validateExternalUrl(payload.tiktok_url, "TikTok 链接", /(^|\.)tiktok\.com$/);
  validateExternalUrl(payload.linkedin_url, "LinkedIn 链接", /(^|\.)linkedin\.com$/);
  for (const url of Array.isArray(payload.other_public_urls) ? payload.other_public_urls : []) validateExternalUrl(url, "社媒链接");
}

export async function GET(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, account } = await requirePermission("customers.view");
    const { id } = await context.params;
    const admin = createAdminClient();
    const { data, error } = await admin.from("customers").select("*").eq("id", id).is("deleted_at", null).single();
    if (error) throw error;
    const publicUnclaimed = !data.owner_id && data.acquisition_scope === "PUBLIC_POOL" && data.pool_status === "AVAILABLE" && data.status === "UNCLAIMED";
    const directReport = account.role === "SUPERVISOR" && account.supervisor_can_view_subordinates && data.owner_id
      ? await admin.from("users").select("id").eq("id", data.owner_id).eq("manager_id", account.id).eq("status", "ACTIVE").maybeSingle()
      : { data: null };
    const mayRead = account.role === "ADMIN" || (account.role === "ORDER_CLERK" && Boolean(data.owner_id)) || data.owner_id === user.id || Boolean(directReport.data) || (account.role !== "ORDER_CLERK" && publicUnclaimed);
    if (!mayRead) return NextResponse.json({ error: "无权查看其他销售员的客户资料" }, { status: 403 });
    const historicalChannel = publicChannelForUrl(data.website);
    return NextResponse.json({
      ...data,
      company_scale_evidence: account.role === "ADMIN" ? data.company_scale_evidence : null,
      website: officialWebsiteUrl(data.website),
      facebook_url: data.facebook_url || (historicalChannel === "facebook" ? data.website : null),
      instagram_url: data.instagram_url || (historicalChannel === "instagram" ? data.website : null),
      linkedin_url: data.linkedin_url || (historicalChannel === "linkedin" ? data.website : null),
      tiktok_url: data.tiktok_url || (historicalChannel === "tiktok" ? data.website : null),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "查询失败" }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user, account } = await requirePermission("customers.edit");
    const { id } = await context.params;
    const body = await request.json();
    normalizeAddressPayload(body);
    const payload = Object.fromEntries(writable.filter((key) => key in body).map((key) =>
      [key, key === "company_name" ? String(body[key] ?? "").trim() : body[key] === "" ? null : body[key]]));
    if (payload.manual_grade != null) {
      const grade = normalizeCustomerGrade(payload.manual_grade);
      if (String(payload.manual_grade).trim() && !grade) throw new Error("客户等级只能选择 S、KA、MA、A、B、C、D");
      payload.manual_grade = grade;
    }
    validateCustomerContactPayload(payload);
    const { data: customer, error: customerError } = await supabase.from("customers").select("id,owner_id,company_name,country,phone,phone_numbers,whatsapp,whatsapp_numbers,email,email_addresses,website,google_url").eq("id", id).single();
    if (customerError) throw customerError;
    const canEdit = account.role === "ADMIN" || customer.owner_id === user.id;
    if (!canEdit) return NextResponse.json({ error: "只能编辑归属自己的客户原始资料；跨用户数据仅供查看" }, { status: 403 });
    if (!Object.keys(payload).length) return NextResponse.json({ error: "没有可保存的原始资料" }, { status: 400 });
    if (!(payload.country ?? customer.country)?.toString().trim()) return NextResponse.json({ error: "国家/地区不能为空" }, { status: 400 });
    await assertNoDuplicateIdentity(id, payload, customer);
    for (const key of ["phone", "whatsapp", "email"] as const) {
      if (key in payload && String(payload[key] ?? "") === String(customer[key] ?? "")) delete payload[key];
    }
    for (const [key, column] of Object.entries({ phone: "phone_numbers", email: "email_addresses", whatsapp: "whatsapp_numbers", wechat: "wechat_numbers" })) {
      if (key in body) payload[column] = manualContactColumns({ [key]: body[key] })[column as keyof ReturnType<typeof manualContactColumns>];
    }
    const { data, error } = await supabase.from("customers").update(payload).eq("id", id).select(["id", "status", ...writable].join(",")).single();
    if (error) throw error;
    await writeAudit(supabase, user.id, "CUSTOMER_UPDATE", "customer", id, { fields: Object.keys(payload) });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: sqlErrorMessage(error, "更新失败") }, { status: 400 });
  }
}

export async function DELETE(_: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, user, account } = await requirePermission("customers.delete");
    const { id } = await context.params;
    const result = await permanentlyDeleteCustomers({ supabase, userId: user.id, ids: [id], allowAll: account.role === "ADMIN" });
    if (!result.successIds.length) {
      return NextResponse.json({ error: result.failures[0]?.error || "删除未生效，请刷新后重试" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "删除失败" }, { status: 400 });
  }
}

