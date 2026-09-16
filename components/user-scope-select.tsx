"use client";

import { useEffect, useRef, useState } from "react";

type UserOption = { id: string; name: string | null; email: string; role: string };

export function UserScopeSelect({
  value,
  onChange,
  className = "h-10 min-w-48 rounded-lg border border-slate-200 bg-white px-3 text-sm",
  allLabel = "全部归属人",
  filterLabel = "归属人",
  permission,
  initializeDefault = false,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  allLabel?: string;
  filterLabel?: string;
  permission: string;
  initializeDefault?: boolean;
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
    void fetch(`/api/users/options?permission=${encodeURIComponent(permission)}`, { cache: "no-store" })
      .then((response) => response.json().then((body) => ({ response, body })))
      .then(({ response, body }) => {
        if (!active || !response.ok) return;
        const elevated = Boolean(body.can_select_owner);
        setElevated(elevated);
        setLoaded(true);
        setUsers(Array.isArray(body.users) ? body.users : []);
        setDefaultValue(body.profile.id || "");
        if (initializeDefault && elevated && !valueRef.current) {
          // 主管和系统管理员也默认查看自己的数据；只有主动选择时才扩大范围。
          onChangeRef.current(body.profile.id);
        }
      })
      .catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [initializeDefault, permission]);

  useEffect(() => {
    if (initializeDefault && loaded && elevated && !value && defaultValue) onChangeRef.current(defaultValue);
  }, [defaultValue, elevated, initializeDefault, loaded, value]);

  // 普通销售员没有跨用户数据权限，不渲染归属人筛选控件，也避免
  // 页面初始化时短暂闪现一个不可用的“我的数据”下拉框。
  if (!loaded || !elevated) return null;
  return (
    <select aria-label="按归属人筛选" value={value || (!initializeDefault ? defaultValue : "")} onChange={(event) => onChange(event.target.value)} className={className}>
      <option value="all">{filterLabel}：{allLabel}</option>
      {users.map((user) => <option key={user.id} value={user.id}>{filterLabel}：{user.name?.trim() || user.email}{user.id === defaultValue ? "（我的数据）" : ""}</option>)}
    </select>
  );
}
