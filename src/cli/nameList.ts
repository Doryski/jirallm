export function normalizeNameList(values: string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined;
  const names = values.map((value) => value.trim()).filter(Boolean);
  return [...new Set(names)];
}
