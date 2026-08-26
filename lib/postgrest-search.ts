/** Quote a contains pattern for use inside a PostgREST `or` expression. */
export function postgrestContains(value: string) {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"%${escaped}%"`;
}
