"use client";

import { Globe2 } from "lucide-react";
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

/** Compact, readable link used by customer lists instead of exposing raw URLs. */
export function CustomerPublicLink({ value, kind }: { value?: string | null; kind: "website" | "map" }) {
  const target = urlTarget(value);
  if (!target) return <span className="text-slate-400">—</span>;
  const website = kind === "website";
  const label = website ? "官网" : "Google Maps";
  return (
    <a
      href={target}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      title={`打开${label}：${target}`}
      className="group inline-flex max-w-44 items-center gap-1.5 rounded px-0.5 py-0.5 text-slate-600 transition hover:bg-blue-50 hover:text-blue-700"
    >
      <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center ${website ? "text-sky-600" : ""}`}>
        {website ? <Globe2 size={15} strokeWidth={2.25} /> : <GoogleMapsIcon size={16} />}
      </span>
      <span className="min-w-0 truncate text-xs text-slate-500 group-hover:text-blue-600">{domainLabel(target)}</span>
    </a>
  );
}
