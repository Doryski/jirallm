import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const cliPath = join(here, 'index.ts');
const tsxBin = join(here, '..', '..', 'node_modules', '.bin', 'tsx');

let linkDir = '';
let linkPath = '';

beforeAll(() => {
  linkDir = mkdtempSync(join(tmpdir(), 'jirallm-entry-'));
  linkPath = join(linkDir, 'jirallm-link.ts');
  symlinkSync(cliPath, linkPath);
});

afterAll(() => {
  if (linkDir) rmSync(linkDir, { recursive: true, force: true });
});

describe('CLI entry via symlink (regression: isRunAsEntry must resolve symlinks)', () => {
  it('runs and prints the version when invoked through a symlink', async () => {
    const { stdout } = await execFileAsync(tsxBin, [linkPath, '--version']);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  }, 30000);

  it('runs and prints help when invoked through a symlink', async () => {
    const { stdout } = await execFileAsync(tsxBin, [linkPath, '--help']);
    expect(stdout).toContain('Usage: jirallm');
  }, 30000);
});

describe('CLI entry error output (issue #28: user errors surfaced as stack traces)', () => {
  it('prints an error thrown from an unwrapped action as one clean line and exits 1', async () => {
    const env = { ...process.env, DEBUG: '' };
    const result = await execFileAsync(tsxBin, [cliPath, 'orgs', 'rm'], { env }).catch(
      (err: { code: number; stderr: string }) => err
    );

    expect(result).toMatchObject({ code: 1 });
    expect(result.stderr.trim()).toBe('Organization name is required (positional or --org).');
  }, 30000);

  it('includes the stack when DEBUG is set', async () => {
    const env = { ...process.env, DEBUG: '1' };
    const result = await execFileAsync(tsxBin, [cliPath, 'orgs', 'rm'], { env }).catch(
      (err: { code: number; stderr: string }) => err
    );

    expect(result).toMatchObject({ code: 1 });
    expect(result.stderr).toMatch(/\n\s+at /);
  }, 30000);
});
