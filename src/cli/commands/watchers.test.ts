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
const searchAssignableUsersMock = vi.fn();
const searchUsersMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    listWatchers = listWatchersMock;
    addWatcher = addWatcherMock;
    removeWatcher = removeWatcherMock;
    getCurrentUser = getCurrentUserMock;
    searchAssignableUsers = searchAssignableUsersMock;
    searchUsers = searchUsersMock;
  },
}));

const ACCOUNT_ID = '5b10ac8d82e05b22cc7d4ef5';
const OTHER_ID = '5b10ac8d82e05b22cc7d4aaa';

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
  searchAssignableUsersMock.mockReset();
  searchUsersMock.mockReset();
  listWatchersMock.mockResolvedValue([]);
  searchAssignableUsersMock.mockResolvedValue([]);
  searchUsersMock.mockResolvedValue([]);
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

  it('adds a watcher by raw accountId and then re-lists', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runWatchers({ issueKey: 'PROJ-1', add: ACCOUNT_ID });
    expect(addWatcherMock).toHaveBeenCalledWith('PROJ-1', ACCOUNT_ID);
    expect(searchAssignableUsersMock).not.toHaveBeenCalled();
    expect(listWatchersMock).toHaveBeenCalledTimes(1);
  });

  it('resolves --add me to current user accountId', async () => {
    getCurrentUserMock.mockResolvedValue({ accountId: 'me-id', displayName: 'Me' });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runWatchers({ issueKey: 'PROJ-1', add: 'me' });
    expect(addWatcherMock).toHaveBeenCalledWith('PROJ-1', 'me-id');
  });

  it('resolves --add by display name via assignable search', async () => {
    searchAssignableUsersMock.mockResolvedValue([
      { accountId: ACCOUNT_ID, displayName: 'Alice Smith', emailAddress: 'alice@x' },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runWatchers({ issueKey: 'PROJ-1', add: 'Alice Smith' });
    expect(searchAssignableUsersMock).toHaveBeenCalledWith({
      query: 'Alice Smith',
      issueKey: 'PROJ-1',
      project: 'PROJ',
    });
    expect(addWatcherMock).toHaveBeenCalledWith('PROJ-1', ACCOUNT_ID);
  });

  it('resolves --rm by email to the matching accountId', async () => {
    searchAssignableUsersMock.mockResolvedValue([
      { accountId: OTHER_ID, displayName: 'Bob', emailAddress: 'bob@x' },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runWatchers({ issueKey: 'PROJ-1', rm: 'bob@x' });
    expect(removeWatcherMock).toHaveBeenCalledWith('PROJ-1', OTHER_ID);
  });

  it('throws on ambiguous name and does not mutate', async () => {
    searchAssignableUsersMock.mockResolvedValue([
      { accountId: ACCOUNT_ID, displayName: 'Chris A' },
      { accountId: OTHER_ID, displayName: 'Chris B' },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await expect(runWatchers({ issueKey: 'PROJ-1', add: 'Chris' })).rejects.toThrow(/Multiple users/);
    expect(addWatcherMock).not.toHaveBeenCalled();
  });

  it('guards no-op when --add and --rm resolve to the same user', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await expect(
      runWatchers({ issueKey: 'PROJ-1', add: ACCOUNT_ID, rm: ACCOUNT_ID })
    ).rejects.toThrow(/same user/);
    expect(addWatcherMock).not.toHaveBeenCalled();
    expect(removeWatcherMock).not.toHaveBeenCalled();
  });

  it('removes a watcher when --rm provided by accountId', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runWatchers({ issueKey: 'PROJ-1', rm: ACCOUNT_ID });
    expect(removeWatcherMock).toHaveBeenCalledWith('PROJ-1', ACCOUNT_ID);
  });

  it('does NOT mutate on --dry-run, resolves me, and includes org in payload', async () => {
    getCurrentUserMock.mockResolvedValue({ accountId: 'me-id', displayName: 'Me' });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runWatchers({ issueKey: 'PROJ-1', add: 'me', dryRun: true, json: true });
    expect(addWatcherMock).not.toHaveBeenCalled();
    expect(listWatchersMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(writes.join(''));
    expect(parsed).toEqual({
      dryRun: true,
      org: 'solo',
      issueKey: 'PROJ-1',
      add: { accountId: 'me-id', displayName: 'Me' },
      rm: undefined,
    });
  });

  it('shows the resolved display name in the dry-run text output', async () => {
    searchAssignableUsersMock.mockResolvedValue([
      { accountId: ACCOUNT_ID, displayName: 'Alice Smith', emailAddress: 'alice@x' },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runWatchers({ issueKey: 'PROJ-1', add: 'Alice Smith', dryRun: true });
    expect(addWatcherMock).not.toHaveBeenCalled();
    const out = logs.join('\n');
    expect(out).toContain('Alice Smith');
    expect(out).toContain(ACCOUNT_ID);
  });

  it('prints "no watchers" on TTY when empty', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runWatchers({ issueKey: 'PROJ-1' });
    expect(logs.join('\n')).toContain('PROJ-1 has no watchers.');
  });
});
