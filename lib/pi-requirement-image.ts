export const PI_REQUIREMENT_IMAGE_LIMIT = 5 * 1024 * 1024;
export const PI_REQUIREMENT_IMAGE_COUNT_LIMIT_PER_ORDER = 5;
export const PI_REQUIREMENT_IMAGE_COUNT_LIMIT_PER_LINE = 3;

export function isPiRequirementImage(bytes: Uint8Array, mimeType: string) {
  if (bytes.byteLength === 0 || bytes.byteLength > PI_REQUIREMENT_IMAGE_LIMIT) return false;
  if (mimeType === "image/jpeg") return bytes.length >= 3
    && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.length >= 8
    && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (mimeType === "image/webp") return bytes.length >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
  return false;
}
