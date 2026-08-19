import { ProfileSettingsForm } from "@/components/profile-settings-form";
import { requireUser } from "@/lib/auth/current-user";

export default async function ProfilePage() {
  const { supabase, user } = await requireUser();
  const [{ data: account }, { data: profile }] = await Promise.all([supabase
    .from("users")
    .select("name,email")
    .eq("id", user.id)
    .maybeSingle(), supabase.from("profiles").select("avatar_url").eq("id", user.id).maybeSingle()]);
  return (
    <main className="p-4 lg:p-6">
      <div className="mx-auto max-w-5xl">
        <h2 className="text-2xl font-bold">个人资料</h2>
        <p className="mt-1 text-sm text-slate-500">
          管理头像、用户名、登录邮箱和密码。
        </p>
        <div className="mt-5">
          <ProfileSettingsForm
            initialName={account?.name || user.email || ""}
            initialEmail={account?.email || user.email || ""}
            initialAvatar={profile?.avatar_url ? "/api/users/avatar" : ""}
          />
        </div>
      </div>
    </main>
  );
}
