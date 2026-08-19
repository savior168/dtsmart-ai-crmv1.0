import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[\p{L}\p{N}_-]{1,15}$/u;

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string) {
  const compact = value.trim().replace(/[\s()-]/g, "").replace(/^00/, "+");
  return compact;
}

export function isEmail(value: string) {
  return EMAIL_PATTERN.test(normalizeEmail(value));
}

export function isPhone(value: string) {
  return /^\+[1-9]\d{7,14}$/.test(normalizePhone(value));
}

export function isUsername(value: string) {
  return USERNAME_PATTERN.test(value.trim());
}

export function classifyIdentifier(value: string) {
  if (isEmail(value)) return { type: "email" as const, value: normalizeEmail(value) };
  if (isPhone(value)) return { type: "phone" as const, value: normalizePhone(value) };
  return { type: "username" as const, value: value.trim().toLowerCase() };
}

export async function listAuthUsers() {
  const admin = createAdminClient();
  const users: User[] = [];

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
  }

  return users;
}

export async function findUserByUsername(username: string) {
  const normalized = username.trim().toLowerCase();
  const users = await listAuthUsers();
  return users.find((user) => {
    const storedUsername = String(user.user_metadata?.username || "").trim().toLowerCase();
    const legacyName = String(user.user_metadata?.name || "").trim().toLowerCase();
    return storedUsername === normalized || legacyName === normalized;
  }) || null;
}

export function authUserMatchesContact(user: User, email: string, phone: string) {
  return Boolean(
    (email && user.email?.toLowerCase() === email) ||
      (phone && normalizePhone(user.phone || "") === phone) ||
      (email && String(user.user_metadata?.email || "").toLowerCase() === email) ||
      (phone && normalizePhone(String(user.user_metadata?.phone || "")) === phone),
  );
}
