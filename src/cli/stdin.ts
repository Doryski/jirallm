import { readFileSync } from 'fs';

export function readPipedStdin(hint: string): string {
  if (process.stdin.isTTY) {
    throw new Error(`stdin is a terminal — ${hint}`);
  }
  return readFileSync(0, 'utf-8');
}

export type TokenStdinHint = {
  example: string;
  fallback: string;
};

export function readTokenFromStdin({ example, fallback }: TokenStdinHint): string {
  const raw = readPipedStdin(
    `pipe the token, e.g. ${example}, or drop --token-stdin to ${fallback}.`
  ).trim();
  if (!raw) throw new Error('--token-stdin was set but no token was received on stdin.');
  return raw;
}
