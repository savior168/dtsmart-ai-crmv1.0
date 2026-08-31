"use client";

import { useEffect, useRef, useState } from "react";

type UserOption = { id: string; name: string | null; email: string; role: string };

export function UserScopeSelect({
  value,
  onChange,
  className = "h-10 min-w-48 rounded-lg border border-slate-200 bg-white px-3 text-sm",
  allLabel = "全部归属人",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  allLabel?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [elevated, setElevated] = useState(false);
  const [defaultValue, setDefaultValue] = useState("");
  const [users, setUsers] = useState<UserOption[]>([]);
  const onChangeRef = useRef(onChange);
  const valueRef = useRef(value);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { valueRef.current = value; }, [value]);

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
        setDefaultValue(body.profile.role === "SUPERVISOR" ? body.profile.id : elevated ? "all" : "");
        if (elevated && !valueRef.current) {
          // 主管默认仅查看自己的数据；管理员默认查看全部。两者都可
          // 通过下拉框主动切换为指定归属人或全部归属人。
          onChangeRef.current(body.profile.role === "SUPERVISOR" ? body.profile.id : "all");
        }
      })
      .catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (loaded && elevated && !value && defaultValue) onChangeRef.current(defaultValue);
  }, [defaultValue, elevated, loaded, value]);

  if (!loaded) return <span className={`${className} inline-flex items-center text-slate-400`}>正在加载…</span>;
  return (
    <select aria-label="按归属人筛选" value={value} disabled={!elevated} onChange={(event) => onChange(event.target.value)} className={className}>
      <option value={elevated ? "all" : ""}>{elevated ? allLabel : "我的数据"}</option>
      {users.map((user) => <option key={user.id} value={user.id}>{user.name || user.email} · {user.email}</option>)}
    </select>
  );
}
