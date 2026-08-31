"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, Clipboard, LoaderCircle, LockKeyhole, RefreshCw, Search, ShieldCheck, UserCheck, UserRoundCog, UserX, X } from "lucide-react";
import { ROLE_LABELS, STATUS_LABELS, type AccountStatus, type UserRole } from "@/lib/auth/permissions";

type UserRow = { id:string; name:string; email:string; role:UserRole; status:AccountStatus; created_at:string; reviewed_at:string|null; review_reason:string|null; last_login_at:string|null; must_change_password:boolean; locked_until:string|null };
type UserAction = "APPROVE"|"REJECT"|"ACTIVATE"|"DISABLE"|"UNLOCK"|"UPDATE_ROLE"|"FORCE_LOGOUT"|"RESET_PASSWORD";
type ApiResult = { error?:string; message?:string; temporary_password?:string; expires_at?:string };

const fieldClass = "h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100";
const statusTone: Record<AccountStatus,string> = { PENDING:"bg-amber-50 text-amber-700", ACTIVE:"bg-emerald-50 text-emerald-700", REJECTED:"bg-rose-50 text-rose-700", DISABLED:"bg-slate-100 text-slate-600", LOCKED:"bg-orange-50 text-orange-700" };

async function api(url:string, init?:RequestInit) {
  const response = await fetch(url, { cache:"no-store", ...init, headers:{ "Content-Type":"application/json", ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "操作失败");
  return body;
}

function formatDate(value:string|null) { return value ? new Date(value).toLocaleString("zh-CN", { hour12:false }) : "—"; }

export function UserManagementPanel() {
  const [rows,setRows] = useState<UserRow[]>([]);
  const [count,setCount] = useState(0);
  const [page,setPage] = useState(1);
  const [search,setSearch] = useState("");
  const [status,setStatus] = useState("");
  const [role,setRole] = useState("");
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState("");
  const [dialog,setDialog] = useState<{ user:UserRow; action:UserAction }|null>(null);
  const [toast,setToast] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page:String(page), pageSize:"20" });
      if(search) params.set("search",search); if(status) params.set("status",status); if(role) params.set("role",role);
      const body = await api(`/api/admin/users?${params}`); setRows(body.data || []); setCount(Number(body.count || 0));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "加载失败"); }
    finally { setLoading(false); }
  },[page,role,search,status]);
  useEffect(() => { const pending = new URL(window.location.href).searchParams.get("status"); if(pending) setStatus(pending); },[]);
  useEffect(() => { void load(); },[load]);
  const tabs = [{v:"",l:"全部"},{v:"PENDING",l:"待审核"},{v:"ACTIVE",l:"已启用"},{v:"DISABLED",l:"已停用"},{v:"LOCKED",l:"已锁定"},{v:"REJECTED",l:"已拒绝"}];
  return <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-col gap-4 border-b border-slate-100 p-5 xl:flex-row xl:items-center xl:justify-between"><div><h3 className="text-lg font-semibold">用户管理</h3><p className="mt-1 text-sm text-slate-500">注册申请只有审核通过后才能登录；账号不物理删除，历史操作始终可追溯。</p></div><div className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700">共 {count} 个账号</div></div>
    <div className="border-b border-slate-100 px-5"><div className="flex gap-6 overflow-x-auto">{tabs.map(item=><button key={item.v} type="button" onClick={()=>{setStatus(item.v);setPage(1);}} className={`h-12 shrink-0 border-b-2 text-sm font-medium ${status===item.v?"border-blue-600 text-blue-700":"border-transparent text-slate-500 hover:text-slate-800"}`}>{item.l}</button>)}</div></div>
    <form onSubmit={(event)=>{event.preventDefault();setPage(1);void load();}} className="grid gap-3 border-b border-slate-100 p-4 md:grid-cols-[minmax(240px,1fr)_180px_auto]">
      <label className="relative"><Search size={17} className="absolute left-3 top-3 text-slate-400"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索用户名或邮箱" className={`${fieldClass} w-full pl-9`}/></label>
      <select value={role} onChange={e=>{setRole(e.target.value);setPage(1);}} className={fieldClass}><option value="">全部角色</option><option value="ADMIN">系统管理员</option><option value="SUPERVISOR">主管</option><option value="SALES">销售员</option></select>
      <div className="flex gap-2"><button className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700">查询</button><button type="button" onClick={()=>{setSearch("");setRole("");setStatus("");setPage(1);}} className="h-10 rounded-lg border border-slate-200 px-4 text-sm hover:bg-slate-50">重置</button></div>
    </form>
    {error?<div className="m-5 flex items-center justify-between rounded-xl bg-rose-50 p-4 text-sm text-rose-700"><span>{error}</span><button onClick={()=>void load()} className="inline-flex items-center gap-1 font-medium"><RefreshCw size={15}/>重新加载</button></div>:null}
    <div className="overflow-x-auto"><table className="w-full min-w-[1120px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3 font-medium">用户</th><th className="px-4 py-3 font-medium">状态</th><th className="px-4 py-3 font-medium">角色</th><th className="px-4 py-3 font-medium">注册时间</th><th className="px-4 py-3 font-medium">最近登录</th><th className="px-4 py-3 font-medium">审核信息</th><th className="px-5 py-3 text-right font-medium">操作</th></tr></thead><tbody className="divide-y divide-slate-100">
      {loading?<tr><td colSpan={7} className="py-16 text-center text-slate-400"><LoaderCircle className="mx-auto mb-2 animate-spin"/>正在加载用户…</td></tr>:rows.map(user=><tr key={user.id} className="hover:bg-slate-50/70"><td className="px-5 py-4"><b className="block text-slate-900">{user.name || "未命名用户"}</b><span className="mt-1 block text-xs text-slate-500">{user.email}</span></td><td className="px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusTone[user.status]}`}>{STATUS_LABELS[user.status]}</span>{user.must_change_password?<span className="ml-2 rounded-full bg-violet-50 px-2 py-1 text-xs text-violet-700">待改密码</span>:null}</td><td className="px-4 py-4">{ROLE_LABELS[user.role]}</td><td className="px-4 py-4 text-slate-600">{formatDate(user.created_at)}</td><td className="px-4 py-4 text-slate-600">{formatDate(user.last_login_at)}</td><td className="max-w-56 px-4 py-4 text-slate-600"><span className="line-clamp-2">{user.review_reason || (user.reviewed_at?`处理于 ${formatDate(user.reviewed_at)}`:"尚未审核")}</span></td><td className="px-5 py-4"><UserActions user={user} open={action=>setDialog({user,action})}/></td></tr>)}
      {!loading&&!rows.length?<tr><td colSpan={7} className="py-16 text-center text-slate-400">当前条件下暂无用户</td></tr>:null}
    </tbody></table></div>
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 text-sm text-slate-500"><span>第 {page} / {Math.max(1,Math.ceil(count/20))} 页</span><div className="flex gap-2"><button type="button" disabled={page<=1} onClick={()=>setPage(v=>v-1)} className="grid h-9 w-9 place-items-center rounded-lg border disabled:opacity-40"><ChevronLeft size={17}/></button><button type="button" disabled={page*20>=count} onClick={()=>setPage(v=>v+1)} className="grid h-9 w-9 place-items-center rounded-lg border disabled:opacity-40"><ChevronRight size={17}/></button></div></div>
    {dialog?<UserActionDialog {...dialog} close={()=>setDialog(null)} saved={message=>{setDialog(null);setToast(message);void load();}}/>:null}
    {toast?<div role="status" className="fixed bottom-6 right-6 z-[90] flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-xl"><CheckCircle2 size={17} className="text-emerald-400"/>{toast}<button onClick={()=>setToast("")}><X size={15}/></button></div>:null}
  </section>;
}

function UserActions({user,open}:{user:UserRow;open:(action:UserAction)=>void}) {
  return <div className="flex justify-end gap-2 whitespace-nowrap">{user.status==="PENDING"?<><button onClick={()=>open("APPROVE")} className="text-blue-600 hover:text-blue-800">通过</button><button onClick={()=>open("REJECT")} className="text-rose-600 hover:text-rose-800">拒绝</button></>:null}{user.status==="ACTIVE"?<><button onClick={()=>open("UPDATE_ROLE")} className="text-blue-600">修改角色</button><button onClick={()=>open("RESET_PASSWORD")} className="text-blue-600">重置密码</button><button onClick={()=>open("DISABLE")} className="text-rose-600">停用</button></>:null}{user.status==="DISABLED"||user.status==="REJECTED"?<button onClick={()=>open("ACTIVATE")} className="text-blue-600">启用</button>:null}{user.status==="LOCKED"?<button onClick={()=>open("UNLOCK")} className="text-blue-600">解锁</button>:null}{user.status==="ACTIVE"?<button onClick={()=>open("FORCE_LOGOUT")} className="text-slate-600">强制退出</button>:null}</div>;
}

function UserActionDialog({user,action,close,saved}:{user:UserRow;action:UserAction;close:()=>void;saved:(message:string)=>void}) {
  const [reason,setReason]=useState(""); const [role,setRole]=useState<UserRole>(user.role); const [busy,setBusy]=useState(false); const [error,setError]=useState(""); const [temporary,setTemporary]=useState<{password:string;expires:string}|null>(null); const [copied,setCopied]=useState(false);
  const labels:Record<UserAction,string>={APPROVE:"通过注册申请",REJECT:"拒绝注册申请",ACTIVATE:"启用账号",DISABLE:"停用账号",UNLOCK:"解锁账号",UPDATE_ROLE:"修改用户角色",FORCE_LOGOUT:"强制退出所有会话",RESET_PASSWORD:"重置登录密码"};
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError("");try{const body={id:user.id,action,reason,role};const result:ApiResult=await api("/api/admin/users",{method:action==="RESET_PASSWORD"?"POST":"PATCH",body:JSON.stringify(body)});if(result.temporary_password){setTemporary({password:result.temporary_password,expires:String(result.expires_at||"")});return;}saved(result.message||"操作已完成");}catch(caught){setError(caught instanceof Error?caught.message:"操作失败");}finally{setBusy(false);}}
  if(temporary)return <Modal title="临时密码已生成" close={()=>saved("临时密码已生成")}><div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">临时密码只显示一次，请通过安全方式交给用户。用户登录后必须立即修改。</div><div className="mt-4 flex items-center gap-2 rounded-xl border bg-slate-50 p-3"><code className="min-w-0 flex-1 select-all break-all text-base font-semibold">{temporary.password}</code><button onClick={async()=>{await navigator.clipboard.writeText(temporary.password);setCopied(true);}} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white">{copied?<Check size={15}/>:<Clipboard size={15}/>}复制</button></div><p className="mt-3 text-xs text-slate-500">有效期至：{formatDate(temporary.expires)}</p></Modal>;
  const requiresReason=["REJECT","DISABLE","RESET_PASSWORD"].includes(action);
  return <Modal title={labels[action]} close={close}><form onSubmit={submit}><div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700"><b>{user.name}</b><span className="ml-2 text-slate-400">{user.email}</span></div>{action==="UPDATE_ROLE"?<label className="mt-4 block text-sm font-medium">新角色<select value={role} onChange={e=>setRole(e.target.value as UserRole)} className={`${fieldClass} mt-2 w-full`}><option value="ADMIN">系统管理员</option><option value="SUPERVISOR">主管</option><option value="SALES">销售员</option></select></label>:null}<label className="mt-4 block text-sm font-medium">{requiresReason?"操作原因（必填）":"操作备注（选填）"}<textarea required={requiresReason} value={reason} onChange={e=>setReason(e.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-slate-200 p-3 text-sm outline-none focus:border-blue-500" placeholder="说明本次操作原因"/></label>{error?<p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>:null}<div className="mt-5 flex justify-end gap-2"><button type="button" onClick={close} className="rounded-lg border px-4 py-2 text-sm">取消</button><button disabled={busy} className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${["REJECT","DISABLE"].includes(action)?"bg-rose-600":"bg-blue-600"}`}>{busy?"处理中…":"确认"}</button></div></form></Modal>;
}

function Modal({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}) { return <div className="fixed inset-0 z-[85] grid place-items-center bg-slate-950/35 p-4" onMouseDown={e=>e.target===e.currentTarget&&close()}><section role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl"><div className="flex items-center justify-between"><h3 className="text-lg font-semibold">{title}</h3><button onClick={close} aria-label="关闭" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={19}/></button></div><div className="mt-5">{children}</div></section></div>; }

const permissionLabels:Record<string,string>={"dashboard.view":"查看工作台","customers.view":"查看客户","customers.manage":"管理客户","imports.manage":"数据导入","ai.manage":"AI筛选","followups.manage":"跟进管理","reports.view":"查看报表","usage.view_all":"查看全部用量费用"};
export function RolePermissionPanel(){const [data,setData]=useState<Array<{role_code:UserRole;permission_code:string;enabled:boolean}>>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState("");const load=useCallback(async()=>{setLoading(true);try{const body=await api("/api/admin/roles");setData(body.data||[]);}catch(e){setError(e instanceof Error?e.message:"加载失败");}finally{setLoading(false);}},[]);useEffect(()=>{void load();},[load]);async function toggle(role:UserRole,permission:string,enabled:boolean){try{await api("/api/admin/roles",{method:"PATCH",body:JSON.stringify({role,permission,enabled})});setData(rows=>rows.map(row=>row.role_code===role&&row.permission_code===permission?{...row,enabled}:row));}catch(e){setError(e instanceof Error?e.message:"保存失败");}}const permissions=Object.keys(permissionLabels);return <section className="rounded-xl border bg-white shadow-sm"><div className="border-b p-5"><h3 className="text-lg font-semibold">固定角色权限</h3><p className="mt-1 text-sm text-slate-500">系统管理、安全设置和审计日志始终仅限系统管理员，不能下放。这里仅调整业务功能入口。</p></div>{error?<p className="m-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>:null}<div className="overflow-x-auto p-5"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b text-left text-slate-500"><th className="py-3 font-medium">功能权限</th>{(["ADMIN","SUPERVISOR","SALES"] as UserRole[]).map(role=><th key={role} className="py-3 text-center font-medium">{ROLE_LABELS[role]}</th>)}</tr></thead><tbody className="divide-y">{loading?<tr><td colSpan={4} className="py-12 text-center text-slate-400">正在加载…</td></tr>:permissions.map(permission=><tr key={permission}><td className="py-4 font-medium">{permissionLabels[permission]}</td>{(["ADMIN","SUPERVISOR","SALES"] as UserRole[]).map(role=>{const checked=role==="ADMIN"||Boolean(data.find(row=>row.role_code===role&&row.permission_code===permission)?.enabled);return <td key={role} className="py-4 text-center"><button type="button" disabled={role==="ADMIN"} aria-label={`${ROLE_LABELS[role]} ${permissionLabels[permission]}`} onClick={()=>void toggle(role,permission,!checked)} className={`mx-auto grid h-7 w-7 place-items-center rounded-lg border transition ${checked?"border-blue-600 bg-blue-600 text-white":"border-slate-300 bg-white"} disabled:cursor-not-allowed disabled:opacity-60`}>{checked?<Check size={16}/>:null}</button></td>;})}</tr>)}</tbody></table></div><div className="grid gap-3 border-t bg-slate-50 p-5 md:grid-cols-3"><RoleCard icon={<ShieldCheck/>} title="系统管理员" text="全部销售数据；账号审核、权限、日志和安全设置。"/><RoleCard icon={<UserRoundCog/>} title="主管" text="查看并管理全部销售业务数据，不可进入系统管理。"/><RoleCard icon={<UserCheck/>} title="销售员" text="仅查看和维护本人负责的业务数据。"/></div></section>}
function RoleCard({icon,title,text}:{icon:React.ReactNode;title:string;text:string}){return <article className="rounded-xl border bg-white p-4"><div className="flex items-center gap-2 font-semibold text-slate-900"><span className="text-blue-600">{icon}</span>{title}</div><p className="mt-2 text-sm leading-6 text-slate-500">{text}</p></article>}

type AuditUser = { id:string; name:string|null; email:string; role?:UserRole; status?:AccountStatus };
type AuditRow = { id:string; user_id:string|null; action:string; target_type:string; target_id:string|null; content?:Record<string,unknown>|null; result?:string|null; created_at:string; user?:AuditUser|null; target_user?:AuditUser|null };

const auditActionLabels:Record<string,string>={
  ADMIN_USER_APPROVE:"通过注册申请",ADMIN_USER_REJECT:"拒绝注册申请",ADMIN_USER_ACTIVATE:"启用账号",ADMIN_USER_DISABLE:"停用账号",ADMIN_USER_UNLOCK:"解锁账号",ADMIN_USER_UPDATE_ROLE:"修改账号角色",ADMIN_USER_FORCE_LOGOUT:"强制退出账号",ADMIN_USER_PASSWORD_RESET:"重置账号密码",ADMIN_ROLE_PERMISSION_UPDATE:"修改角色权限",ADMIN_SECURITY_SETTINGS_UPDATE:"修改安全设置",
};

function auditUserName(user?:AuditUser|null,fallback?:unknown){return user?.name||user?.email||String(fallback||"未知账号");}
function auditValue(value:unknown){return value===null||value===undefined||value===""?"—":String(value);}
function auditRole(value:unknown){const key=String(value||"") as UserRole;return ROLE_LABELS[key]||auditValue(value);}
function auditStatus(value:unknown){const key=String(value||"") as AccountStatus;return STATUS_LABELS[key]||auditValue(value);}
function auditSummary(row:AuditRow){
  const actor=auditUserName(row.user,row.user_id);
  const action=auditActionLabels[row.action]||row.action;
  const content=row.content||{};
  if(row.target_type==="user")return `${actor} 对账号 ${auditUserName(row.target_user,content.target_name||content.target_email||row.target_id)} 执行了“${action}”`;
  if(row.action==="ADMIN_ROLE_PERMISSION_UPDATE")return `${actor} 修改了“${auditRole(content.role)}”的功能权限`;
  if(row.action==="ADMIN_SECURITY_SETTINGS_UPDATE")return `${actor} 修改了系统安全设置`;
  return `${actor} 执行了“${action}”`;
}
function auditDetailLines(row:AuditRow){
  const content=row.content||{};const lines:string[]=[];
  if(content.reason)lines.push(`操作原因：${content.reason}`);
  if(content.previous_role||content.next_role)lines.push(`角色变化：${auditRole(content.previous_role)} → ${auditRole(content.next_role)}`);
  if(content.previous_status||content.next_status)lines.push(`状态变化：${auditStatus(content.previous_status)} → ${auditStatus(content.next_status)}`);
  if(content.permission)lines.push(`权限：${content.permission}；结果：${content.enabled?"启用":"停用"}`);
  if(content.expires_at)lines.push(`临时密码有效期至：${formatDate(String(content.expires_at))}`);
  if(row.result)lines.push(`执行结果：${row.result}`);
  return lines.length?lines:["执行成功"];
}

export function AuditLogPanel(){
  const [rows,setRows]=useState<AuditRow[]>([]);const [count,setCount]=useState(0);const [page,setPage]=useState(1);const [action,setAction]=useState("");const [loading,setLoading]=useState(true);const [error,setError]=useState("");
  const load=useCallback(async()=>{setLoading(true);setError("");try{const params=new URLSearchParams({page:String(page),pageSize:"20"});if(action)params.set("action",action);const body=await api(`/api/admin/audit?${params}`);setRows(body.data||[]);setCount(body.count||0);}catch(e){setError(e instanceof Error?e.message:"加载失败");}finally{setLoading(false);}},[action,page]);
  useEffect(()=>{void load();},[load]);
  return <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
    <div className="flex flex-col gap-3 border-b p-5 md:flex-row md:items-end md:justify-between"><div><h3 className="text-lg font-semibold">操作日志</h3><p className="mt-1 text-sm text-slate-500">明确记录谁在什么时间、对哪个账号或系统配置、执行了什么操作及执行结果。</p></div><form onSubmit={e=>{e.preventDefault();setPage(1);void load();}} className="flex gap-2"><input value={action} onChange={e=>setAction(e.target.value)} placeholder="搜索操作类型" className={fieldClass}/><button className="rounded-lg bg-blue-600 px-4 text-sm text-white">查询</button></form></div>
    {error?<p className="m-5 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>:null}
    <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr><th className="px-5 py-3 font-medium">时间</th><th className="px-4 py-3 font-medium">操作人</th><th className="px-4 py-3 font-medium">操作记录</th><th className="px-4 py-3 font-medium">目标账号 / 对象</th><th className="px-5 py-3 font-medium">原因与结果</th></tr></thead><tbody className="divide-y">
      {loading?<tr><td colSpan={5} className="py-16 text-center text-slate-400">正在加载…</td></tr>:rows.map(row=><tr key={row.id} className="align-top hover:bg-slate-50/60"><td className="whitespace-nowrap px-5 py-4 text-slate-600">{formatDate(row.created_at)}</td><td className="px-4 py-4"><b>{auditUserName(row.user,row.user_id)}</b><small className="block text-slate-400">{row.user?.email||row.user_id||"—"}</small></td><td className="max-w-md px-4 py-4"><b className="leading-6 text-slate-900">{auditSummary(row)}</b><span className="mt-1 block text-xs text-blue-700">{auditActionLabels[row.action]||row.action}</span></td><td className="px-4 py-4 text-slate-700">{row.target_type==="user"?<><b className="block">{auditUserName(row.target_user,row.content?.target_name||row.content?.target_email||row.target_id)}</b><small className="block text-slate-400">{row.target_user?.email||String(row.content?.target_email||row.target_id||"—")}</small></>:<><b className="block">{row.target_type||"系统"}</b><small className="block text-slate-400">{row.target_id||"全局配置"}</small></>}</td><td className="max-w-sm px-5 py-4 text-slate-600">{auditDetailLines(row).map((line,index)=><p key={`${row.id}-${index}`} className="leading-6">{line}</p>)}</td></tr>)}
      {!loading&&!rows.length?<tr><td colSpan={5} className="py-16 text-center text-slate-400">暂无日志</td></tr>:null}
    </tbody></table></div>
    <div className="flex items-center justify-between border-t p-4 text-sm text-slate-500"><span>共 {count} 条</span><div className="flex gap-2"><button disabled={page<=1} onClick={()=>setPage(v=>v-1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">上一页</button><button disabled={page*20>=count} onClick={()=>setPage(v=>v+1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">下一页</button></div></div>
  </section>;
}

export function SecuritySettingsPanel(){const [form,setForm]=useState({max_failed_login_attempts:5,lock_minutes:15,temporary_password_hours:24});const [loading,setLoading]=useState(true);const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [error,setError]=useState("");useEffect(()=>{api("/api/admin/security").then(body=>setForm(body)).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[]);async function save(e:FormEvent){e.preventDefault();setBusy(true);setError("");setMessage("");try{await api("/api/admin/security",{method:"PATCH",body:JSON.stringify(form)});setMessage("安全设置已保存并立即生效");}catch(caught){setError(caught instanceof Error?caught.message:"保存失败");}finally{setBusy(false);}}return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]"><form onSubmit={save} className="rounded-xl border bg-white p-5 shadow-sm"><h3 className="flex items-center gap-2 text-lg font-semibold"><LockKeyhole className="text-blue-600"/>登录与密码安全</h3><p className="mt-1 text-sm text-slate-500">仅保留必要策略，防止暴力尝试并确保临时密码及时更换。</p>{loading?<p className="py-12 text-center text-slate-400">正在加载…</p>:<div className="mt-6 grid gap-5 md:grid-cols-3"><NumberField label="连续失败锁定阈值" suffix="次" value={form.max_failed_login_attempts} min={3} max={10} change={value=>setForm({...form,max_failed_login_attempts:value})}/><NumberField label="临时锁定时长" suffix="分钟" value={form.lock_minutes} min={5} max={1440} change={value=>setForm({...form,lock_minutes:value})}/><NumberField label="临时密码有效期" suffix="小时" value={form.temporary_password_hours} min={1} max={168} change={value=>setForm({...form,temporary_password_hours:value})}/></div>}{error||message?<p className={`mt-5 rounded-lg p-3 text-sm ${error?"bg-rose-50 text-rose-700":"bg-emerald-50 text-emerald-700"}`}>{error||message}</p>:null}<button disabled={busy||loading} className="mt-6 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy?"保存中…":"保存安全设置"}</button></form><aside className="rounded-xl border bg-white p-5 shadow-sm"><h3 className="font-semibold">固定安全规则</h3><ul className="mt-4 space-y-3 text-sm leading-6 text-slate-600"><li className="flex gap-2"><CheckCircle2 size={18} className="mt-1 shrink-0 text-emerald-500"/>新注册账号必须由系统管理员审核。</li><li className="flex gap-2"><CheckCircle2 size={18} className="mt-1 shrink-0 text-emerald-500"/>临时密码登录后必须修改，管理员不可查看旧密码。</li><li className="flex gap-2"><CheckCircle2 size={18} className="mt-1 shrink-0 text-emerald-500"/>强制退出、停用、改角色均写入审计日志。</li><li className="flex gap-2"><UserX size={18} className="mt-1 shrink-0 text-blue-500"/>账号不物理删除，保证业务归属与历史可追溯。</li></ul></aside></div>}
function NumberField({label,suffix,value,min,max,change}:{label:string;suffix:string;value:number;min:number;max:number;change:(value:number)=>void}){return <label className="text-sm font-medium">{label}<span className="relative mt-2 block"><input type="number" required min={min} max={max} value={value} onChange={e=>change(Number(e.target.value))} className={`${fieldClass} w-full pr-16`}/><span className="absolute right-3 top-2.5 text-slate-400">{suffix}</span></span></label>}
