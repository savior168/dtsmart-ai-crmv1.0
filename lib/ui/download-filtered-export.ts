export async function downloadFilteredExport(url: string, filename: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "筛选结果导出失败");
  }
  const blob = await response.blob();
  const contentDisposition = response.headers.get("Content-Disposition") || "";
  const encodedName = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition)?.[1];
  let serverFilename = "";
  if (encodedName) {
    try { serverFilename = decodeURIComponent(encodedName.trim()); } catch { /* Keep the supplied safe fallback. */ }
  }
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = serverFilename || filename;
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}
