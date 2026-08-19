import { countryInfo } from "@/lib/countries";

export function CountryLabel({
  value,
  className = "",
}: {
  value?: unknown;
  className?: string;
}) {
  const info = countryInfo(String(value || ""));

  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap ${className}`}>
      {info.code ? (
        <span
          role="img"
          aria-label={`${info.name}国旗`}
          className="inline-block h-[15px] w-5 shrink-0 rounded-[2px] bg-slate-100 bg-cover bg-center shadow-[0_0_0_1px_rgba(15,23,42,.08)]"
          style={{
            backgroundImage: `url(https://flagcdn.com/w40/${info.code.toLowerCase()}.png)`,
          }}
        />
      ) : (
        <span aria-hidden="true" className="grid h-[15px] w-5 place-items-center text-xs">
          🌐
        </span>
      )}
      <span>{info.name}</span>
    </span>
  );
}
