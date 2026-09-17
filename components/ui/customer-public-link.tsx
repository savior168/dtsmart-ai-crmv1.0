"use client";

import { GoogleMapsIcon } from "@/components/ui/google-maps-icon";

function urlTarget(value?: string | null) {
  const raw = String(value || "").trim();
  return raw ? (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`) : "";
}

function domainLabel(target: string) {
  try {
    return new URL(target).hostname.replace(/^www\./i, "") || target;
  } catch {
    return target.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  }
}

function WebsiteIcon({ size = 14 }: { size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="28" fill="#B9E6F5" stroke="#1A73E8" strokeWidth="5"/><path d="M4 32h56M32 4c9 7.8 14 17.2 14 28S41 52.2 32 60M32 4c-9 7.8-14 17.2-14 28S23 52.2 32 60" stroke="#1A73E8" strokeWidth="5" strokeLinecap="round"/><path d="M9 18c7.3 5.2 14.9 7.8 23 7.8S47.7 23.2 55 18M9 46c7.3-5.2 14.9-7.8 23-7.8S47.7 40.8 55 46" stroke="#1A73E8" strokeWidth="5" strokeLinecap="round"/></svg>;
}

/** Compact, readable link used by customer lists instead of exposing raw URLs. */
export function CustomerPublicLink({ value, kind, size = "compact", iconOnly = false }: { value?: string | null; kind: "website" | "map"; size?: "compact" | "normal"; iconOnly?: boolean }) {
  const target = urlTarget(value);
  if (!target) return null;
  const website = kind === "website";
  const label = website ? "官网" : "Google Maps";
  const normal = size === "normal";
  return (
    <a
      href={target}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      title={`打开${label}：${target}`}
      aria-label={`打开${label}`}
      className={iconOnly
        ? "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
        : normal
        ? "group inline-flex max-w-full items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
        : "group inline-flex max-w-44 items-center gap-1 rounded px-0.5 py-0.5 text-slate-600 transition hover:bg-blue-50 hover:text-blue-700"}
    >
      <span className={`inline-flex shrink-0 items-center justify-center ${iconOnly ? "h-4 w-4" : normal ? "h-4 w-4" : "h-3.5 w-3.5"}`}>
        {website ? <WebsiteIcon size={iconOnly || normal ? 16 : 14} /> : <GoogleMapsIcon size={iconOnly || normal ? 16 : 14} />}
      </span>
      {!iconOnly ? <span className={`min-w-0 truncate ${normal ? "text-sm font-medium text-slate-700 group-hover:text-blue-700" : "text-xs text-slate-500 group-hover:text-blue-600"}`}>{domainLabel(target)}</span> : null}
    </a>
  );
}
