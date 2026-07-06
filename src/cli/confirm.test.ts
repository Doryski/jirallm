import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { confirmMock, textMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  textMock: vi.fn(),
}));

vi.mock('@clack/prompts', () => ({
  confirm: confirmMock,
  text: textMock,
  isCancel: (v: unknown) => typeof v === 'symbol',
}));

import { confirmOrAbort, typedNameConfirm } from './confirm.js';

const originalIsTTY = process.stdin.isTTY;

function setTTY(value: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
}

beforeEach(() => {
  confirmMock.mockReset();
  textMock.mockReset();
});

afterEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('confirmOrAbort', () => {
  it('bypasses to true with --yes', async () => {
    expect(await confirmOrAbort('sure?', { yes: true })).toBe(true);
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('throws in non-TTY without --yes', async () => {
    setTTY(false);
    await expect(confirmOrAbort('sure?')).rejects.toThrow(/--yes/);
  });

  it('returns the prompt answer in TTY', async () => {
    setTTY(true);
    confirmMock.mockResolvedValue(true);
    expect(await confirmOrAbort('sure?')).toBe(true);
    confirmMock.mockResolvedValue(false);
    expect(await confirmOrAbort('sure?')).toBe(false);
  });

  it('returns false on cancel', async () => {
    setTTY(true);
    confirmMock.mockResolvedValue(Symbol('cancel'));
    expect(await confirmOrAbort('sure?')).toBe(false);
  });
});

describe('typedNameConfirm', () => {
  it('bypasses to true with --yes', async () => {
    expect(await typedNameConfirm('acme', { yes: true })).toBe(true);
    expect(textMock).not.toHaveBeenCalled();
  });

  it('throws in non-TTY without --yes', async () => {
    setTTY(false);
    await expect(typedNameConfirm('acme')).rejects.toThrow(/--yes/);
  });

  it('returns true only when typed name matches', async () => {
    setTTY(true);
    textMock.mockResolvedValue('acme');
    expect(await typedNameConfirm('acme')).toBe(true);
    textMock.mockResolvedValue('nope');
    expect(await typedNameConfirm('acme')).toBe(false);
  });

  it('returns false on cancel', async () => {
    setTTY(true);
    textMock.mockResolvedValue(Symbol('cancel'));
    expect(await typedNameConfirm('acme')).toBe(false);
  });
});
