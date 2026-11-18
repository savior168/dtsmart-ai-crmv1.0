export const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  const safe = typeof value !== "number" && (/^\s*[=+\-@]/.test(text) || /^[\t\r]/.test(text))
    ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};
