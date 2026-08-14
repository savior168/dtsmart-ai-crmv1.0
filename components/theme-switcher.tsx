"use client";

import { Check, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const themes = {
  晴空蓝: ["sky", "#2563eb"],
  薄荷青: ["mint", "#059669"],
  薰衣草紫: ["lavender", "#7c3aed"],
  樱花粉: ["sakura", "#db2777"],
  柔和米白: ["cream", "#b45309"],
} as const;

type ThemeName = keyof typeof themes;

export function ThemeSwitcher() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeName>("晴空蓝");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem("dtsmart-theme") as ThemeName | null;
    const next = saved && saved in themes ? saved : "晴空蓝";
    setTheme(next);
    document.documentElement.dataset.crmTheme = themes[next][0];
  }, []);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function change(name: ThemeName) {
    setTheme(name);
    localStorage.setItem("dtsmart-theme", name);
    document.documentElement.dataset.crmTheme = themes[name][0];
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="切换主题" title="切换主题" onClick={() => setOpen((value) => !value)} className="grid h-10 w-10 place-items-center rounded-full text-slate-700 transition hover:bg-slate-100">
        <Sun size={22} strokeWidth={1.8} />
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          {Object.entries(themes).map(([name, colors]) => (
            <button type="button" key={name} onClick={() => change(name as ThemeName)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-slate-50 ${theme === name ? "font-semibold text-blue-700" : "text-slate-600"}`}>
              <span className="h-3 w-3 rounded-full" style={{ background: colors[1] }} /><span className="flex-1">{name}</span>{theme === name ? <Check size={15} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
