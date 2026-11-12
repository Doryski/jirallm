import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { readFileSyncMock } = vi.hoisted(() => ({ readFileSyncMock: vi.fn() }));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: (...args: unknown[]) => readFileSyncMock(...args) };
});

import { readPipedStdin, readTokenFromStdin } from './stdin.js';

const originalIsTTY = process.stdin.isTTY;

function setStdinTTY(value: boolean | undefined) {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
}

beforeEach(() => {
  readFileSyncMock.mockReset().mockReturnValue('piped');
});

afterEach(() => {
  setStdinTTY(originalIsTTY);
});

describe('readPipedStdin', () => {
  it('throws a one-line hint instead of reading when stdin is a terminal (issue #28: EAGAIN)', () => {
    setStdinTTY(true);

    expect(() => readPipedStdin('pipe the token.')).toThrow('stdin is a terminal — pipe the token.');
    expect(readFileSyncMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a pipe (isTTY false)', false],
    ['a redirected file (isTTY undefined)', undefined],
  ])('reads fd 0 when stdin is %s', (_label, isTTY) => {
    setStdinTTY(isTTY);

    expect(readPipedStdin('hint')).toBe('piped');
    expect(readFileSyncMock).toHaveBeenCalledWith(0, 'utf-8');
  });

  it('returns empty input as-is so callers can report it in their own words', () => {
    setStdinTTY(false);
    readFileSyncMock.mockReturnValue('');

    expect(readPipedStdin('hint')).toBe('');
  });
});

describe('readTokenFromStdin', () => {
  const hint = { example: '`pbpaste | jirallm PROJ-1 --token-stdin`', fallback: 'use the stored token' };

  it('returns the trimmed piped token', () => {
    setStdinTTY(false);
    readFileSyncMock.mockReturnValue('  tok-123\n');

    expect(readTokenFromStdin(hint)).toBe('tok-123');
  });

  it('builds the terminal hint from the example and fallback', () => {
    setStdinTTY(true);

    expect(() => readTokenFromStdin(hint)).toThrow(
      'stdin is a terminal — pipe the token, e.g. `pbpaste | jirallm PROJ-1 --token-stdin`, or drop --token-stdin to use the stored token.'
    );
    expect(readFileSyncMock).not.toHaveBeenCalled();
  });

  it('rejects an empty pipe', () => {
    setStdinTTY(false);
    readFileSyncMock.mockReturnValue('\n');

    expect(() => readTokenFromStdin(hint)).toThrow(
      '--token-stdin was set but no token was received on stdin.'
    );
  });
});
