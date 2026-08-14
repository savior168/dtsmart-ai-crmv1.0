import { LoaderCircle } from "lucide-react";
export default function Loading(){return <div className="grid min-h-[60vh] place-items-center"><div className="text-center text-slate-500"><LoaderCircle className="mx-auto animate-spin text-blue-600"/><p className="mt-3 text-sm">正在加载…</p></div></div>}
