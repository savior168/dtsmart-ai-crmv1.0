import { createClient } from "@supabase/supabase-js";

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ADMIN_NAME",
  "ADMIN_EMAIL",
  "ADMIN_PASSWORD",
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`缺少环境变量: ${missing.join(", ")}`);
  process.exit(1);
}
if (process.env.ADMIN_PASSWORD.length < 8) {
  console.error("ADMIN_PASSWORD 至少需要8位");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let authUser;
let created = false;
for (let page = 1; page <= 20 && !authUser; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw new Error(`读取Auth用户失败: ${error.message}`);
  authUser = data.users.find((user) => user.email?.toLowerCase() === email);
  if (data.users.length < 1000) break;
}

if (authUser) {
  const { data, error } = await admin.auth.admin.updateUserById(authUser.id, {
    password: process.env.ADMIN_PASSWORD,
    email_confirm: true,
    user_metadata: { ...authUser.user_metadata, name: process.env.ADMIN_NAME },
  });
  if (error) throw new Error(`更新Auth管理员失败: ${error.message}`);
  authUser = data.user;
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: process.env.ADMIN_PASSWORD,
    email_confirm: true,
    user_metadata: { name: process.env.ADMIN_NAME },
  });
  if (error) throw new Error(`创建Auth管理员失败: ${error.message}`);
  authUser = data.user;
  created = true;
}

const { error: profileError } = await admin.from("users").upsert({
  id: authUser.id,
  name: process.env.ADMIN_NAME,
  email,
  role: "ADMIN",
  status: "ACTIVE",
});
if (profileError) {
  if (created) await admin.auth.admin.deleteUser(authUser.id);
  throw new Error(`管理员档案写入失败${created ? "，新Auth用户已回滚" : ""}: ${profileError.message}`);
}

const verifier = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const { data: login, error: loginError } = await verifier.auth.signInWithPassword({
  email,
  password: process.env.ADMIN_PASSWORD,
});
if (loginError || !login.user) throw new Error(`ADMIN登录验证失败: ${loginError?.message || "未返回用户"}`);
const { data: profile, error: verifyError } = await verifier
  .from("users")
  .select("id,role,status")
  .eq("id", login.user.id)
  .single();
if (verifyError || profile?.role !== "ADMIN" || profile?.status !== "ACTIVE") {
  throw new Error(`ADMIN权限验证失败: ${verifyError?.message || "public.users角色或状态不正确"}`);
}
await verifier.auth.signOut();
console.log(`ADMIN已创建或更新并通过登录验证: ${email}`);
