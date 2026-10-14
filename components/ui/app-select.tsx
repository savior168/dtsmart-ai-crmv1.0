"use client";

import { ChevronDown, Search } from "lucide-react";
import { Children, isValidElement, useCallback, useEffect, useId, useMemo, useRef, useState, type OptionHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";

type SelectOption = { value: string; label: string; disabled: boolean };
type OptionElement = OptionHTMLAttributes<HTMLOptionElement> & { children?: ReactNode };

function optionText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(optionText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return optionText(node.props.children);
  return "";
}

function collectOptions(children: ReactNode): SelectOption[] {
  return Children.toArray(children).flatMap((node) => {
    if (!isValidElement<OptionElement>(node)) return [];
    if (node.type !== "option") return collectOptions(node.props.children);
    const label = optionText(node.props.children);
    return [{ value: String(node.props.value ?? label), label, disabled: Boolean(node.props.disabled) }];
  });
}

/** A value-compatible replacement for native single selects. It keeps a
 * visually hidden select for form submission and required-field validation. */
export function AppSelect({
  value,
  onChange,
  children,
  className = "",
  disabled = false,
  required = false,
  name,
  id,
  title,
  forceSearch = false,
  "aria-label": ariaLabel,
}: {
  value: string | number;
  onChange: (event: { target: { value: string } }) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  title?: string;
  forceSearch?: boolean;
  "aria-label"?: string;
}) {
  const options = useMemo(() => collectOptions(children), [children]);
  const selectedValue = String(value ?? "");
  const selected = options.find((option) => option.value === selectedValue);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const optionButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 240, maxHeight: 320 });
  const searchable = forceSearch || options.length > 6;
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query ? options.filter((option) => option.label.toLocaleLowerCase().includes(query)) : options;
  }, [options, search]);

  const place = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(Math.max(rect.width, searchable ? 280 : 200), window.innerWidth - 24);
    const maxHeight = Math.min(320, window.innerHeight - 24);
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    const openAbove = below < Math.min(maxHeight, 220) && above > below;
    const height = Math.min(maxHeight, Math.max(120, openAbove ? above : below));
    setPosition({
      top: openAbove ? Math.max(8, rect.top - height - 4) : rect.bottom + 4,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      width,
      maxHeight: height,
    });
  }, [searchable]);

  function show() {
    if (disabled) return;
    setSearch("");
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === selectedValue && !option.disabled)));
    place();
    setOpen(true);
  }

  function choose(next: SelectOption) {
    if (next.disabled) return;
    setInvalid(false);
    onChange({ target: { value: next.value } });
    setOpen(false);
    trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    if (searchable) searchInput.current?.focus();
    else (optionButtons.current.find((item)=>item?.getAttribute("aria-selected")==="true")||optionButtons.current[0])?.focus();
    return () => {
      document.removeEventListener("mousedown", outside);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place, searchable]);

  function move(direction: number) {
    if (!filtered.length) return;
    let next = activeIndex;
    for (let count = 0; count < filtered.length; count += 1) {
      next = (next + direction + filtered.length) % filtered.length;
      if (!filtered[next].disabled) break;
    }
    setActiveIndex(next);
    optionButtons.current[next]?.focus();
  }

  const popup = open ? <div
    ref={menu}
    className="fixed z-[200] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl"
    style={{ top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
    onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      else if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
      else if (event.key === "Home") { event.preventDefault(); setActiveIndex(0); optionButtons.current[0]?.focus(); }
      else if (event.key === "End") { event.preventDefault(); const last = filtered.length - 1; setActiveIndex(last); optionButtons.current[last]?.focus(); }
      else if (event.key === "Enter" && filtered[activeIndex]) { event.preventDefault(); choose(filtered[activeIndex]); }
    }}
  >
    {searchable ? <label className="relative mb-1 block shrink-0">
      <Search size={15} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-400"/>
      <input ref={searchInput} value={search} onChange={(event) => { setSearch(event.target.value); setActiveIndex(0); }} placeholder="搜索选项" aria-label={`搜索${ariaLabel || "选项"}`} className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-sm outline-none focus:border-blue-500"/>
    </label> : null}
    <div id={listId} role="listbox" aria-label={ariaLabel || "选择选项"} className="min-h-0 overflow-y-auto">
      {filtered.map((option, index) => <button
        key={`${option.value}:${index}`}
        ref={(element) => { optionButtons.current[index] = element; }}
        type="button"
        role="option"
        aria-selected={option.value === selectedValue}
        disabled={option.disabled}
        onMouseEnter={() => setActiveIndex(index)}
        onClick={() => choose(option)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm leading-5 disabled:cursor-not-allowed disabled:opacity-40 ${option.value === selectedValue ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}
      ><span className="min-w-0 break-words">{option.label}</span>{option.value === selectedValue ? <span aria-hidden="true" className="shrink-0 text-blue-600">✓</span> : null}</button>)}
      {!filtered.length ? <p className="px-3 py-5 text-center text-sm text-slate-400">没有匹配的选项</p> : null}
    </div>
  </div> : null;

  return <span className={`relative inline-flex min-w-0 align-middle ${className.includes("w-full") ? "w-full" : ""}`}>
    <select
      aria-hidden="true"
      tabIndex={-1}
      id={id}
      name={name}
      required={required}
      disabled={disabled}
      value={selectedValue}
      onChange={() => undefined}
      onInvalid={(event) => { event.preventDefault(); setInvalid(true); trigger.current?.focus(); }}
      className="pointer-events-none absolute h-px w-px opacity-0"
    >{children}</select>
    <button
      ref={trigger}
      type="button"
      role="combobox"
      aria-label={ariaLabel}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-controls={open ? listId : undefined}
      aria-invalid={invalid || undefined}
      disabled={disabled}
      title={title}
      onClick={() => open ? setOpen(false) : show()}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === " " || event.key === "Enter") {
          event.preventDefault();
          if (!open) show();
          else if (event.key === "ArrowDown") move(1);
          else if (event.key === "ArrowUp") move(-1);
        } else if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      }}
      className={`inline-flex min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 text-left text-sm text-slate-700 outline-none transition hover:border-blue-300 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 ${invalid ? "border-rose-400" : ""} ${className}`}
    ><span className="min-w-0 truncate">{selected?.label || options[0]?.label || "请选择"}</span><ChevronDown size={15} className={`shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`}/></button>
    {typeof document !== "undefined" ? createPortal(popup, document.body) : null}
  </span>;
}
