export function numberedPiChangeNote(input: string): string {
  return input.split(/\r?\n/).map((line) => line.trim().replace(/^\d+[.、．)）]\s*/, ""))
    .filter(Boolean).map((line, index) => `${index + 1}. ${line}`).join("\n");
}
