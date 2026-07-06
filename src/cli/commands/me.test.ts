import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loadOrgProfileMock } = vi.hoisted(() => ({
  loadOrgProfileMock: vi.fn(async () => ({
    org: {
      name: 'acme',
      projects: {
        alpha: { key: 'ALPHA', boardName: 'Alpha' },
        beta: { key: 'BETA', boardName: 'Beta' },
      },
    },
    config: { baseUrl: 'https://x.atlassian.net', userEmail: 'u@x' },
    apiToken: 'tok',
  })),
}));

vi.mock('../../lib/config.js', () => ({
  loadOrgProfile: loadOrgProfileMock,
}));

const getCurrentUserMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    getCurrentUser = getCurrentUserMock;
  },
}));

import { runMe } from './me.js';

const FAKE_USER = { accountId: 'acc-1', displayName: 'Jane', emailAddress: 'jane@x' };

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  getCurrentUserMock.mockReset();
  getCurrentUserMock.mockResolvedValue(FAKE_USER);
  loadOrgProfileMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runMe', () => {
  it('emits JSON when --json flag is set', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runMe({ org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual(FAKE_USER);
    expect(logs).toEqual([]);
  });

  it('auto-emits JSON when stdout is non-TTY', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    await runMe({ org: 'acme' });
    expect(JSON.parse(writes.join(''))).toEqual(FAKE_USER);
  });

  it('prints human-readable lines when interactive TTY', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runMe({ org: 'acme' });
    expect(writes).toEqual([]);
    expect(logs.join('\n')).toContain('Display name: Jane');
    expect(logs.join('\n')).toContain('Account ID:   acc-1');
    expect(logs.join('\n')).toContain('Email:        jane@x');
  });

  it('resolves without a project for a multi-project org (loadOrgProfile, no -P)', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runMe({ org: 'acme' });
    expect(loadOrgProfileMock).toHaveBeenCalledWith({ org: 'acme' });
    expect(logs.join('\n')).toContain('Account ID:   acc-1');
  });

  it('omits email line when missing', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    getCurrentUserMock.mockResolvedValue({ accountId: 'a', displayName: 'X' });
    await runMe({ org: 'acme' });
    expect(logs.join('\n')).not.toContain('Email:');
  });
});
