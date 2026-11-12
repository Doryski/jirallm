import { readFileSync } from 'fs';

export function readPipedStdin(hint: string): string {
  if (process.stdin.isTTY) {
    throw new Error(`stdin is a terminal — ${hint}`);
  }
  return readFileSync(0, 'utf-8');
}
