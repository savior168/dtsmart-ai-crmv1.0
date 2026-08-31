"use client";

import { useEffect, useState } from "react";

type UserOption = { id: string; name: string | null; email: string; role: string };

export function UserScopeSelect({
  value,
  onChange,
  className = "h-10 min-w-48 rounded-lg border border-slate-200 bg-white px-3 text-sm",
  allLabel = "全部销售员",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  allLabel?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [elevated, setElevated] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);

  useEffect(() => {
    let active = true;
    void fetch("/api/users/options", { cache: "no-store" })
      .then((response) => response.json().then((body) => ({ response, body })))
      .then(({ response, body }) => {
        if (!active || !response.ok) return;
        const elevated = body.profile?.role === "ADMIN" || body.profile?.role === "SUPERVISOR";
        setElevated(elevated);
        setLoaded(true);
        setUsers(Array.isArray(body.users) ? body.users : []);
      })
      .catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  if (!loaded) return <span className={`${className} inline-flex items-center text-slate-400`}>正在加载…</span>;
  return (
    <select aria-label="按销售员筛选" value={value} disabled={!elevated} onChange={(event) => onChange(event.target.value)} className={className}>
      <option value="">{elevated ? allLabel : "我的数据"}</option>
      {users.map((user) => <option key={user.id} value={user.id}>{user.name || user.email} · {user.email}</option>)}
    </select>
  );
}
