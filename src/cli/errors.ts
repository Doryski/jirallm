type FormatErrorOptions = {
  json: boolean;
  debug: boolean;
};

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function formatError(err: unknown, { json, debug }: FormatErrorOptions): string {
  if (json) return JSON.stringify({ error: errorMessage(err) });
  if (debug && err instanceof Error && err.stack) return err.stack;
  return errorMessage(err);
}

export function reportError(err: unknown): void {
  console.error(
    formatError(err, {
      json: process.argv.includes('--json'),
      debug: Boolean(process.env.DEBUG),
    })
  );
}

export function exitOnError(err: unknown): never {
  reportError(err);
  process.exit(1);
}
