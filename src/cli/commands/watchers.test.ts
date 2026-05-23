import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    apiToken: 'tok',
  })),
  findOrgsByProjectKey: vi.fn(() => ['solo']),
}));

const listWatchersMock = vi.fn();
const addWatcherMock = vi.fn();
const removeWatcherMock = vi.fn();
const getCurrentUserMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    listWatchers = listWatchersMock;
    addWatcher = addWatcherMock;
    removeWatcher = removeWatcherMock;
    getCurrentUser = getCurrentUserMock;
  },
}));

import { runWatchers } from './watchers.js';

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  listWatchersMock.mockReset();
  addWatcherMock.mockReset();
  removeWatcherMock.mockReset();
  getCurrentUserMock.mockReset();
  listWatchersMock.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runWatchers', () => {
  it('lists watchers when no mutations requested', async () => {
    listWatchersMock.mockResolvedValue([
      { accountId: 'a1', displayName: 'Alice' },
      { accountId: 'a2', displayName: 'Bob' },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runWatchers({ issueKey: 'PROJ-1', json: true });
    expect(addWatcherMock).not.toHaveBeenCalled();
    expect(removeWatcherMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.issueKey).toBe('PROJ-1');
    expect(parsed.watchers).toHaveLength(2);
  });

  it('adds a watcher and then re-lists', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runWatchers({ issueKey: 'PROJ-1', add: 'acc-1' });
    expect(addWatcherMock).toHaveBeenCalledWith('PROJ-1', 'acc-1');
    expect(listWatchersMock).toHaveBeenCalledTimes(1);
  });

  it('resolves --add me to current user accountId', async () => {
    getCurrentUserMock.mockResolvedValue({ accountId: 'me-id', displayName: 'Me' });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runWatchers({ issueKey: 'PROJ-1', add: 'me' });
    expect(addWatcherMock).toHaveBeenCalledWith('PROJ-1', 'me-id');
  });

  it('removes a watcher when --rm provided', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runWatchers({ issueKey: 'PROJ-1', rm: 'acc-x' });
    expect(removeWatcherMock).toHaveBeenCalledWith('PROJ-1', 'acc-x');
  });

  it('does NOT mutate on --dry-run but does NOT list either', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runWatchers({ issueKey: 'PROJ-1', add: 'acc-1', dryRun: true, json: true });
    expect(addWatcherMock).not.toHaveBeenCalled();
    expect(listWatchersMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(writes.join(''));
    expect(parsed).toEqual({
      dryRun: true,
      issueKey: 'PROJ-1',
      add: 'acc-1',
      rm: undefined,
    });
  });

  it('prints "no watchers" on TTY when empty', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runWatchers({ issueKey: 'PROJ-1' });
    expect(logs.join('\n')).toContain('PROJ-1 has no watchers.');
  });
});
