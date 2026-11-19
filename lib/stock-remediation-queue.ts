export async function fetchAllStockRemediationRows<T>(path: string): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= 2000; page++) {
    const response = await fetch(`${path}?page=${page}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "补录清单加载失败");
    rows.push(...(body.data || []));
    if (page * 50 >= Number(body.count || 0)) return rows;
  }
  throw new Error("补录清单超过分页上限，请联系管理员");
}
