import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { findOrgsMock, readConfigMock, selectMock } = vi.hoisted(() => ({
  findOrgsMock: vi.fn(),
  readConfigMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock('../lib/config.js', () => ({
  findOrgsByProjectKey: findOrgsMock,
  readConfig: readConfigMock,
}));

vi.mock('@clack/prompts', () => ({
  select: selectMock,
  isCancel: (v: unknown) => typeof v === 'symbol',
  cancel: vi.fn(),
}));

import { resolveOrg, resolveOrgInteractive } from './resolveOrg.js';

const originalIsTTY = process.stdin.isTTY;

function setTTY(value: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
}

beforeEach(() => {
  findOrgsMock.mockReset();
  readConfigMock.mockReset();
  selectMock.mockReset();
  readConfigMock.mockReturnValue({ orgs: {} });
});

afterEach(() => {
  Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('resolveOrg (sync)', () => {
  it('prefers flagOrg then parsedOrg', () => {
    expect(resolveOrg('parsed', 'flag', 'PROJ')).toBe('flag');
    expect(resolveOrg('parsed', undefined, 'PROJ')).toBe('parsed');
  });

  it('auto-resolves a single match', () => {
    findOrgsMock.mockReturnValue(['acme']);
    expect(resolveOrg(undefined, undefined, 'PROJ')).toBe('acme');
  });

  it('throws on zero matches', () => {
    findOrgsMock.mockReturnValue([]);
    expect(() => resolveOrg(undefined, undefined, 'PROJ')).toThrow(/not found/);
  });

  it('throws on multiple matches', () => {
    findOrgsMock.mockReturnValue(['a', 'b']);
    expect(() => resolveOrg(undefined, undefined, 'PROJ')).toThrow(/multiple orgs/);
  });
});

describe('resolveOrgInteractive', () => {
  it('prefers flagOrg then parsedOrg without lookup', async () => {
    expect(await resolveOrgInteractive('parsed', 'flag', 'PROJ')).toBe('flag');
    expect(await resolveOrgInteractive('parsed', undefined, 'PROJ')).toBe('parsed');
    expect(findOrgsMock).not.toHaveBeenCalled();
  });

  it('auto-resolves a single match', async () => {
    findOrgsMock.mockReturnValue(['acme']);
    expect(await resolveOrgInteractive(undefined, undefined, 'PROJ')).toBe('acme');
  });

  it('throws on zero matches with init hint', async () => {
    findOrgsMock.mockReturnValue([]);
    await expect(resolveOrgInteractive(undefined, undefined, 'PROJ')).rejects.toThrow(
      /jirallm init/
    );
  });

  it('prompts to select when multiple matches and TTY', async () => {
    setTTY(true);
    findOrgsMock.mockReturnValue(['a', 'b']);
    selectMock.mockResolvedValue('b');
    expect(await resolveOrgInteractive(undefined, undefined, 'PROJ')).toBe('b');
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it('throws when multiple matches and non-TTY', async () => {
    setTTY(false);
    findOrgsMock.mockReturnValue(['a', 'b']);
    await expect(resolveOrgInteractive(undefined, undefined, 'PROJ')).rejects.toThrow(
      /multiple orgs/
    );
    expect(selectMock).not.toHaveBeenCalled();
  });
});
