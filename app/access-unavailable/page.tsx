import Link from "next/link";
import { RefreshCw, ShieldAlert } from "lucide-react";

export default function AccessUnavailablePage() {
  return <main className="grid min-h-[calc(100vh-64px)] place-items-center p-6"><section className="w-full max-w-lg rounded-2xl border bg-white p-8 text-center shadow-sm"><ShieldAlert className="mx-auto text-amber-500" size={42}/><h2 className="mt-4 text-xl font-semibold">权限服务暂时不可用</h2><p className="mt-2 text-sm leading-6 text-slate-500">当前账号的授权信息暂时无法核验，并不代表您没有权限。请重新加载，系统会自动恢复。</p><Link href="/" prefetch={false} className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white"><RefreshCw size={16}/>重新加载</Link></section></main>;
}
