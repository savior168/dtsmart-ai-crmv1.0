"use client";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CustomerForm } from "@/components/customer-form";

export default function NewCustomerPage(){const router=useRouter();return <main className="p-4 lg:p-6"><div className="mx-auto max-w-6xl"><div className="mb-5 flex items-center gap-3"><button title="返回客户列表" onClick={()=>router.push("/customers")} className="grid h-9 w-9 place-items-center rounded-lg border bg-white hover:bg-slate-50"><ArrowLeft size={18}/></button><div><h2 className="text-2xl font-bold">新增客户</h2><p className="mt-1 text-sm text-slate-500">创建客户并执行格式与冲突校验</p></div></div><CustomerForm onCancel={()=>router.push("/customers")} onDone={(customer)=>router.push(customer?`/customers/${customer.id}`:"/customers")}/></div></main>}
