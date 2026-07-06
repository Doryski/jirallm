import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    apiToken: 'tok',
  })),
  findOrgsByProjectKey: vi.fn(() => ['solo']),
  readConfig: vi.fn(() => ({ orgs: { solo: { base_url: 'https://x' } } })),
}));

const assignIssueMock = vi.fn();
const getCurrentUserMock = vi.fn();
const searchAssignableUsersMock = vi.fn();
const searchUsersMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    assignIssue = assignIssueMock;
    getCurrentUser = getCurrentUserMock;
    searchAssignableUsers = searchAssignableUsersMock;
    searchUsers = searchUsersMock;
  },
}));

import { runAssign } from './assign.js';

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  assignIssueMock.mockReset();
  getCurrentUserMock.mockReset();
  searchAssignableUsersMock.mockReset();
  searchUsersMock.mockReset();
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runAssign', () => {
  it('resolves "me" to current user accountId', async () => {
    getCurrentUserMock.mockResolvedValue({ accountId: 'acc-me', displayName: 'Me' });
    await runAssign({ issueKey: 'PROJ-1', assignee: 'me' });
    expect(assignIssueMock).toHaveBeenCalledWith('PROJ-1', 'acc-me');
  });

  it('resolves "none" to null (unassign)', async () => {
    await runAssign({ issueKey: 'PROJ-1', assignee: 'none' });
    expect(assignIssueMock).toHaveBeenCalledWith('PROJ-1', null);
    expect(getCurrentUserMock).not.toHaveBeenCalled();
  });

  it('treats "-" as unassign sugar', async () => {
    await runAssign({ issueKey: 'PROJ-1', assignee: '-' });
    expect(assignIssueMock).toHaveBeenCalledWith('PROJ-1', null);
  });

  it('passes through a literal accountId', async () => {
    await runAssign({ issueKey: 'PROJ-1', assignee: '5ac1234567890abcdefghijk' });
    expect(assignIssueMock).toHaveBeenCalledWith('PROJ-1', '5ac1234567890abcdefghijk');
    expect(searchAssignableUsersMock).not.toHaveBeenCalled();
  });

  it('resolves an email to its accountId via assignable search', async () => {
    searchAssignableUsersMock.mockResolvedValue([
      { accountId: 'acc-e', displayName: 'Erin Doe', emailAddress: 'erin@x.io' },
    ]);
    await runAssign({ issueKey: 'PROJ-1', assignee: 'erin@x.io' });
    expect(searchAssignableUsersMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'erin@x.io', project: 'PROJ' })
    );
    expect(assignIssueMock).toHaveBeenCalledWith('PROJ-1', 'acc-e');
  });

  it('resolves a display name to its accountId', async () => {
    searchAssignableUsersMock.mockResolvedValue([
      { accountId: 'acc-n', displayName: 'Nadia Khan' },
    ]);
    await runAssign({ issueKey: 'PROJ-1', assignee: 'Nadia Khan' });
    expect(assignIssueMock).toHaveBeenCalledWith('PROJ-1', 'acc-n');
  });

  it('lists candidates and throws on an ambiguous display name', async () => {
    searchAssignableUsersMock.mockResolvedValue([
      { accountId: 'acc-1', displayName: 'John Smith', emailAddress: 'john1@x.io' },
      { accountId: 'acc-2', displayName: 'John Smithson', emailAddress: 'john2@x.io' },
    ]);
    await expect(runAssign({ issueKey: 'PROJ-1', assignee: 'John' })).rejects.toThrow(/acc-1[\s\S]*acc-2/);
    expect(assignIssueMock).not.toHaveBeenCalled();
  });

  it('shows the resolved displayName in success output', async () => {
    searchAssignableUsersMock.mockResolvedValue([
      { accountId: 'acc-n', displayName: 'Nadia Khan' },
    ]);
    await runAssign({ issueKey: 'PROJ-1', assignee: 'Nadia Khan' });
    expect(logs.join('\n')).toContain('Nadia Khan');
  });

  it('shows the resolved displayName in dry-run output', async () => {
    searchAssignableUsersMock.mockResolvedValue([
      { accountId: 'acc-n', displayName: 'Nadia Khan' },
    ]);
    await runAssign({ issueKey: 'PROJ-1', assignee: 'Nadia Khan', dryRun: true });
    expect(assignIssueMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Nadia Khan');
  });

  it('does NOT call assignIssue on --dry-run', async () => {
    await runAssign({ issueKey: 'PROJ-1', assignee: '5ac1234567890abcdefghijk', dryRun: true, json: true });
    expect(assignIssueMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(writes.join(''));
    expect(parsed).toEqual({
      dryRun: true,
      results: [{ issueKey: 'PROJ-1', accountId: '5ac1234567890abcdefghijk' }],
    });
  });

  it('emits per-key results JSON on success', async () => {
    await runAssign({ issueKey: 'PROJ-1', assignee: '5ac1234567890abcdefghijk', json: true });
    expect(JSON.parse(writes.join(''))).toEqual({
      results: [{ issueKey: 'PROJ-1', accountId: '5ac1234567890abcdefghijk' }],
    });
  });

  it('assigns every key when given comma-separated bulk keys', async () => {
    searchAssignableUsersMock.mockResolvedValue([
      { accountId: 'acc-n', displayName: 'Nadia Khan' },
    ]);
    await runAssign({ issueKey: 'PROJ-1,PROJ-2,PROJ-3', assignee: 'Nadia Khan' });
    expect(assignIssueMock).toHaveBeenCalledTimes(3);
    expect(assignIssueMock).toHaveBeenNthCalledWith(1, 'PROJ-1', 'acc-n');
    expect(assignIssueMock).toHaveBeenNthCalledWith(2, 'PROJ-2', 'acc-n');
    expect(assignIssueMock).toHaveBeenNthCalledWith(3, 'PROJ-3', 'acc-n');
  });

  it('emits one result per key for bulk JSON output', async () => {
    await runAssign({ issueKey: 'PROJ-1,PROJ-2', assignee: '5ac1234567890abcdefghijk', json: true });
    expect(JSON.parse(writes.join(''))).toEqual({
      results: [
        { issueKey: 'PROJ-1', accountId: '5ac1234567890abcdefghijk' },
        { issueKey: 'PROJ-2', accountId: '5ac1234567890abcdefghijk' },
      ],
    });
  });
});
