const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** ZIP store mode avoids recompressing XLSX files and preserves UTF-8 names. */
export function buildWorkbookZip(files: Array<{ name: string; data: ArrayBuffer | Uint8Array }>) {
  if (!files.length) throw new Error("筛选结果没有可导出的订单");
  if (files.length > 65535) throw new Error("筛选结果超过ZIP格式的单包文件上限");
  const localParts: Buffer[] = [];
  const directoryParts: Buffer[] = [];
  const names = new Set<string>();
  let offset = 0;
  const now = new Date();
  const date = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  for (const file of files) {
    const safeName = file.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").trim();
    if (!safeName || safeName === "." || safeName === ".." || names.has(safeName.toLowerCase())) {
      throw new Error("导出文件名重复或无效，请核对订单编号");
    }
    names.add(safeName.toLowerCase());
    const name = Buffer.from(safeName, "utf8");
    const bytes = Buffer.from(file.data instanceof ArrayBuffer ? new Uint8Array(file.data) : file.data);
    if (name.length > 65535 || bytes.length > 0xffffffff || offset + 30 + name.length + bytes.length > 0xffffffff) {
      throw new Error("导出文件过大，超过ZIP格式限制");
    }
    const checksum = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directoryParts.push(central, name);
    offset += local.length + name.length + bytes.length;
  }
  const directorySize = directoryParts.reduce((sum, part) => sum + part.length, 0);
  if (offset + directorySize + 22 > 0xffffffff) throw new Error("筛选结果超过ZIP格式的4GB上限");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...directoryParts, end]);
}

/** Stream the finished archive so the platform's buffered-response size limit does not truncate it. */
export function streamZipBytes(bytes: Uint8Array) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) { controller.close(); return; }
      const end = Math.min(offset + 64 * 1024, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
}

/** Bound database fan-out when a filtered export spans many orders. */
export async function mapExportBatches<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error("导出并发数无效");
  const results: R[] = [];
  for (let start = 0; start < items.length; start += concurrency) {
    results.push(...await Promise.all(items.slice(start, start + concurrency).map(worker)));
  }
  return results;
}
