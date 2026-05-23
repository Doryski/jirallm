export type JsonOutputFlag = { json?: boolean };

export function shouldOutputJson(flags: JsonOutputFlag): boolean {
  return Boolean(flags.json) || !process.stdout.isTTY;
}

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}
