"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CustomerForm } from "@/components/customer-form";

export default function NewCustomerPage() {
  const router = useRouter();
  const [publicPool, setPublicPool] = useState(false);
  useEffect(() => setPublicPool(new URLSearchParams(window.location.search).get("destination") === "public"), []);
  const back = publicPool ? "/customers/pool" : "/customers";
  return <main className="p-4 lg:p-6"><div className="mx-auto max-w-6xl"><div className="mb-5 flex items-center gap-3"><button title="返回客户列表" onClick={() => router.push(back)} className="grid h-9 w-9 place-items-center rounded-lg border bg-white hover:bg-slate-50"><ArrowLeft size={18}/></button><div><h2 className="text-2xl font-bold">{publicPool ? "新增公海客户" : "新增我的客户"}</h2><p className="mt-1 text-sm text-slate-500">{publicPool ? "仅系统管理员可新增；保存后无归属人并进入待认领客户" : "保存后默认归属当前用户；系统会执行全库去重与归属校验"}</p></div></div><CustomerForm destination={publicPool ? "PUBLIC_POOL" : "PRIVATE"} onCancel={() => router.push(back)} onDone={(customer) => router.push(publicPool ? "/customers/pool" : customer ? `/customers/${customer.id}` : "/customers")}/></div></main>;
}
