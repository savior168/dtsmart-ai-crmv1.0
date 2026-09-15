import { NextRequest, NextResponse } from "next/server";
import { authErrorStatus, requirePermission, writeAudit } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { AI_CLOUD_DISPATCH_POLICY } from "@/lib/ai/task-types";

const amountKeys = [
  "google_daily_limit_usd", "google_weekly_limit_usd", "google_monthly_limit_usd",
  "openai_daily_limit_usd", "openai_weekly_limit_usd", "openai_monthly_limit_usd",
] as const;
const booleanKeys = ["google_paid_enabled", "openai_paid_enabled"] as const;
const integerLimits = {
  google_max_paid_calls_per_customer: 2,
  openai_max_paid_calls_per_customer: 1,
} as const;

const settingsSelect = "updated_at,updated_by,google_paid_enabled,openai_paid_enabled,google_max_paid_calls_per_customer,openai_max_paid_calls_per_customer,google_daily_limit_usd,google_weekly_limit_usd,google_monthly_limit_usd,openai_daily_limit_usd,openai_weekly_limit_usd,openai_monthly_limit_usd";

function settingsContext(request: NextRequest) {
  const acquisition = request.nextUrl.searchParams.get("scope") === "acquisition";
  return {
    acquisition,
    permission: acquisition ? "ai.acquisition.settings.manage" : "ai.settings.manage",
  };
}

export async function GET(request: NextRequest) {
  try {
    const context = settingsContext(request);
    await requirePermission(context.permission);
    const admin = createAdminClient();
    const [settings, budgets] = await Promise.all([
      admin.from("cost_center_settings").select(settingsSelect).eq("id", true).single(),
      admin.rpc("api_cost_budget_status"),
    ]);
    if (settings.error) throw settings.error;
    if (budgets.error) throw budgets.error;
    return NextResponse.json({ settings: { ...settings.data, ai_default_dispatch_policy: AI_CLOUD_DISPATCH_POLICY }, budgets: budgets.data || {} });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI设置加载失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const context = settingsContext(request);
    const { supabase, user } = await requirePermission(context.permission);
    const body = await request.json() as Record<string, unknown>;
    const admin = createAdminClient();
    const current = await admin.from("cost_center_settings").select("*").eq("id", true).single();
    if (current.error) throw current.error;
    const updates: Record<string, number | boolean | null | string> = {
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };
    updates.ai_default_dispatch_policy = AI_CLOUD_DISPATCH_POLICY;
    for (const key of amountKeys) {
      if (!(key in body)) {
        updates[key] = current.data[key] == null ? null : Number(current.data[key]);
        continue;
      }
      const raw = body[key];
      if (raw === "" || raw == null) updates[key] = null;
      else {
        const value = Number(raw);
        if (!Number.isFinite(value) || value < 0) return NextResponse.json({ error: "费用上限必须为大于或等于0的金额；留空表示不限制" }, { status: 400 });
        updates[key] = Number(value.toFixed(6));
      }
    }
    for (const key of booleanKeys) {
      if (!(key in body)) updates[key] = Boolean(current.data[key]);
      else if (typeof body[key] !== "boolean") return NextResponse.json({ error: "付费渠道开关参数无效" }, { status: 400 });
      else updates[key] = body[key] as boolean;
    }
    for (const [key, maximum] of Object.entries(integerLimits)) {
      const value = Number(key in body ? body[key] : current.data[key]);
      if (!Number.isInteger(value) || value < 0 || value > maximum) return NextResponse.json({ error: `${key.startsWith("google") ? "Google Places" : "OpenAI"}单客户调用上限必须为0至${maximum}次` }, { status: 400 });
      updates[key] = value;
    }
    for (const prefix of ["google", "openai"] as const) {
      const daily = updates[`${prefix}_daily_limit_usd`];
      const weekly = updates[`${prefix}_weekly_limit_usd`];
      const monthly = updates[`${prefix}_monthly_limit_usd`];
      if (typeof daily === "number" && typeof weekly === "number" && daily > weekly) return NextResponse.json({ error: `${prefix === "google" ? "Google Places" : "OpenAI"}每日上限不能高于每周上限` }, { status: 400 });
      if (typeof daily === "number" && typeof monthly === "number" && daily > monthly) return NextResponse.json({ error: `${prefix === "google" ? "Google Places" : "OpenAI"}每日上限不能高于每月上限` }, { status: 400 });
      if (typeof weekly === "number" && typeof monthly === "number" && weekly > monthly) return NextResponse.json({ error: `${prefix === "google" ? "Google Places" : "OpenAI"}每周上限不能高于每月上限` }, { status: 400 });
    }
    const saved = await admin.from("cost_center_settings").update(updates).eq("id", true).select("*").single();
    if (saved.error) throw saved.error;
    await writeAudit(supabase, user.id, context.acquisition ? "AI_ACQUISITION_COST_SETTINGS_UPDATED" : "AI_SCREENING_COST_SETTINGS_UPDATED", "cost_center_settings", null, {
      paid_channels: Object.fromEntries(booleanKeys.map((key) => [key, updates[key]])),
      budgets: Object.fromEntries(amountKeys.map((key) => [key, updates[key]])),
      customer_caps: Object.fromEntries(Object.keys(integerLimits).map((key) => [key, updates[key]])),
      dispatch_policy: AI_CLOUD_DISPATCH_POLICY,
    });
    return NextResponse.json({ settings: saved.data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI设置保存失败";
    return NextResponse.json({ error: message }, { status: authErrorStatus(message) || 400 });
  }
}
