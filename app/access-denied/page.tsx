import Link from "next/link";
import { ShieldX } from "lucide-react";

export default function AccessDeniedPage() {
  return <main className="grid min-h-[calc(100vh-64px)] place-items-center p-6"><section className="w-full max-w-lg rounded-2xl border bg-white p-8 text-center shadow-sm"><ShieldX className="mx-auto text-rose-500" size={42}/><h2 className="mt-4 text-xl font-semibold">当前账号没有访问权限</h2><p className="mt-2 text-sm leading-6 text-slate-500">该页面或功能尚未授权。如业务确实需要，请联系系统管理员在“用户与权限”中配置。</p><Link href="/" className="mt-6 inline-flex rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white">返回工作台</Link></section></main>;
}
