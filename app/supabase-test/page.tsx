import Link from "next/link";
import { CheckCircle2, Database, XCircle } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function checkConnection() {
  if (!isSupabaseConfigured()) return false;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  try {
    const response = await fetch(`${url}/auth/v1/health`, {
      headers: { apikey: key },
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export default async function SupabaseTestPage() {
  const connected = await checkConnection();

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/[.045] p-8 text-center shadow-2xl shadow-black/30">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-500/15 text-indigo-300">
          <Database size={28} aria-hidden="true" />
        </div>
        <p className="mt-5 text-xs font-medium uppercase tracking-[.22em] text-indigo-400">
          DTSmart AI 获客 CRM
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Supabase 连接检测</h1>
        <div
          className={`mt-7 flex items-center justify-center gap-2 rounded-2xl border px-4 py-4 font-medium ${
            connected
              ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
              : "border-amber-400/20 bg-amber-400/10 text-amber-300"
          }`}
          role="status"
        >
          {connected ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
          {connected ? "Supabase连接成功" : "Supabase未配置"}
        </div>
        {!connected && (
          <p className="mt-4 text-sm leading-6 text-slate-400">
            请在 .env.local 中填写项目地址和匿名访问密钥，然后重新启动服务。
          </p>
        )}
        <Link href="/" className="mt-7 inline-block text-sm text-indigo-300 hover:text-indigo-200">
          返回首页
        </Link>
      </section>
    </main>
  );
}
