import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process', () => ({
  exec: vi.fn(),
  spawn: vi.fn(),
}));

import { exec, spawn } from 'child_process';
import { runCommand, runInteractive } from './runCommand.js';

const mockedExec = vi.mocked(exec) as unknown as ReturnType<typeof vi.fn>;
const mockedSpawn = vi.mocked(spawn) as unknown as ReturnType<typeof vi.fn>;

type ExecCallback = (
  error: (Error & { stderr?: string }) | null,
  result: { stdout: string; stderr: string }
) => void;

function execResolves(stdout: string, stderr = '') {
  mockedExec.mockImplementation((_cmd: string, cb: ExecCallback) => {
    cb(null, { stdout, stderr });
  });
}

function execRejects(error: Error) {
  mockedExec.mockImplementation((_cmd: string, cb: ExecCallback) => {
    cb(error, { stdout: '', stderr: '' });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('runCommand', () => {
  it('resolves the trimmed stdout on success', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    execResolves('  hello world  \n');
    await expect(runCommand('ls', 'Listing')).resolves.toBe('hello world');
    expect(info).toHaveBeenCalledWith('\nListing...');
  });

  it('logs stderr to console.error when present and not silent', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    execResolves('ok', 'a warning');
    await runCommand('ls', 'Listing');
    expect(error).toHaveBeenCalledWith('a warning');
  });

  it('stays silent when the silent option is set', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    execResolves('quiet', 'warn');
    await expect(runCommand('ls', 'Listing', { silent: true })).resolves.toBe('quiet');
    expect(info).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('throws by default when the command fails', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('boom');
    execRejects(failure);
    await expect(runCommand('bad', 'Doing')).rejects.toBe(failure);
    expect(error).toHaveBeenCalledWith('Doing failed:', 'boom');
  });

  it('returns an empty string when shouldThrow is false', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    execRejects(new Error('nope'));
    await expect(runCommand('bad', 'Doing', { shouldThrow: false })).resolves.toBe('');
  });

  it('stringifies non-Error failures for the log message', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedExec.mockImplementation((_cmd: string, cb: ExecCallback) => {
      cb('plain failure' as unknown as Error, { stdout: '', stderr: '' });
    });
    await expect(runCommand('bad', 'Doing', { shouldThrow: false })).resolves.toBe('');
    expect(error).toHaveBeenCalledWith('Doing failed:', 'plain failure');
  });
});

describe('runInteractive', () => {
  it('resolves with the exit code', async () => {
    const child = new EventEmitter();
    mockedSpawn.mockReturnValue(child);
    const promise = runInteractive('echo hi');
    child.emit('exit', 3);
    await expect(promise).resolves.toBe(3);
    expect(mockedSpawn).toHaveBeenCalledWith('echo hi', { shell: true, stdio: 'inherit' });
  });

  it('resolves with 1 when the exit code is null', async () => {
    const child = new EventEmitter();
    mockedSpawn.mockReturnValue(child);
    const promise = runInteractive('crash');
    child.emit('exit', null);
    await expect(promise).resolves.toBe(1);
  });

  it('resolves with 1 when spawn errors', async () => {
    const child = new EventEmitter();
    mockedSpawn.mockReturnValue(child);
    const promise = runInteractive('missing');
    child.emit('error', new Error('ENOENT'));
    await expect(promise).resolves.toBe(1);
  });
});
