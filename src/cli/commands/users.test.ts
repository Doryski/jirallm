import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadOrgProfileMock = vi.fn(async () => ({
  org: { name: 'acme', projects: {} },
  config: { baseUrl: 'https://x', userEmail: 'u@x' },
  apiToken: 'tok',
}));
const loadProfileMock = vi.fn(async () => ({
  org: { name: 'acme', projects: {} },
  project: { key: 'PROJ' },
  config: { baseUrl: 'https://x', userEmail: 'u@x' },
  apiToken: 'tok',
}));
vi.mock('../../lib/config.js', () => ({
  loadOrgProfile: (...args: unknown[]) => loadOrgProfileMock(...(args as [])),
  loadProfile: (...args: unknown[]) => loadProfileMock(...(args as [])),
}));

vi.mock('../resolveOrg.js', () => ({
  resolveOrg: (parsedOrg?: string, flagOrg?: string) => flagOrg ?? parsedOrg ?? 'acme',
}));

const searchUsersMock = vi.fn();
const searchAssignableUsersMock = vi.fn();
const getCurrentUserMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    searchUsers = searchUsersMock;
    searchAssignableUsers = searchAssignableUsersMock;
    getCurrentUser = getCurrentUserMock;
  },
}));

import { runUsers } from './users.js';

const JANE = {
  accountId: '5b10a2844c20165700ede21g',
  displayName: 'Jane Doe',
  emailAddress: 'jane@example.com',
  active: true,
};

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  searchUsersMock.mockReset();
  searchAssignableUsersMock.mockReset();
  getCurrentUserMock.mockReset();
  loadOrgProfileMock.mockClear();
  loadProfileMock.mockClear();
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runUsers', () => {
  it('emits the raw user array as JSON', async () => {
    searchUsersMock.mockResolvedValue([JANE]);
    await runUsers({ query: 'jane@example.com', org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual([JANE]);
    expect(logs).toEqual([]);
  });

  it('auto-emits JSON when stdout is non-TTY', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    searchUsersMock.mockResolvedValue([JANE]);
    await runUsers({ query: 'jane@example.com', org: 'acme' });
    expect(JSON.parse(writes.join(''))).toEqual([JANE]);
  });

  it('searches org-wide via loadOrgProfile when no project or issue is given', async () => {
    searchUsersMock.mockResolvedValue([JANE]);
    await runUsers({ query: 'Jane', org: 'acme' });
    expect(loadOrgProfileMock).toHaveBeenCalledWith({ org: 'acme' });
    expect(loadProfileMock).not.toHaveBeenCalled();
    expect(searchUsersMock).toHaveBeenCalledWith('Jane', undefined);
  });

  it('prints accountId, display name and email on TTY', async () => {
    searchUsersMock.mockResolvedValue([JANE]);
    await runUsers({ query: 'Jane', org: 'acme' });
    const out = logs.join('\n');
    expect(out).toContain('1 user(s) matching "Jane"');
    expect(out).toContain(JANE.accountId);
    expect(out).toContain('Jane Doe');
    expect(out).toContain('<jane@example.com>');
    expect(out).not.toContain('[inactive]');
  });

  it('marks inactive users and omits a missing email', async () => {
    searchUsersMock.mockResolvedValue([{ accountId: 'a1', displayName: 'Ghost', active: false }]);
    await runUsers({ query: 'Ghost', org: 'acme' });
    const out = logs.join('\n');
    expect(out).toContain('[inactive]');
    expect(out).not.toContain('<');
  });

  it('reports no match instead of throwing', async () => {
    searchUsersMock.mockResolvedValue([]);
    await runUsers({ query: 'nobody@example.com', org: 'acme' });
    expect(logs.join('\n')).toContain('No user found matching "nobody@example.com".');
  });

  it('returns the current user for the "me" shorthand', async () => {
    getCurrentUserMock.mockResolvedValue(JANE);
    await runUsers({ query: 'me', org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual([JANE]);
    expect(searchUsersMock).not.toHaveBeenCalled();
  });

  it('restricts to project-assignable users with -P', async () => {
    searchAssignableUsersMock.mockResolvedValue([JANE]);
    await runUsers({ query: 'Jane', org: 'acme', project: 'PROJ' });
    expect(loadProfileMock).toHaveBeenCalledWith({ org: 'acme', project: 'PROJ' });
    expect(searchAssignableUsersMock).toHaveBeenCalledWith({
      query: 'Jane',
      issueKey: undefined,
      project: 'PROJ',
      maxResults: undefined,
    });
  });

  it('restricts to issue-assignable users with --issue', async () => {
    searchAssignableUsersMock.mockResolvedValue([JANE]);
    await runUsers({ query: 'Jane', issue: 'PROJ-123' });
    expect(searchAssignableUsersMock).toHaveBeenCalledWith({
      query: 'Jane',
      issueKey: 'PROJ-123',
      project: undefined,
      maxResults: undefined,
    });
  });

  it('passes a parsed --limit through to the search', async () => {
    searchUsersMock.mockResolvedValue([JANE]);
    await runUsers({ query: 'Jane', org: 'acme', limit: '10' });
    expect(searchUsersMock).toHaveBeenCalledWith('Jane', 10);
  });

  it('rejects a non-numeric --limit', async () => {
    await expect(runUsers({ query: 'Jane', org: 'acme', limit: 'abc' })).rejects.toThrow(
      '--limit must be a positive integer'
    );
  });
});
