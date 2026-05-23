import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    apiToken: 'tok',
  })),
  findOrgsByProjectKey: vi.fn(() => ['solo']),
}));

const assignIssueMock = vi.fn();
const getCurrentUserMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    assignIssue = assignIssueMock;
    getCurrentUser = getCurrentUserMock;
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
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runAssign', () => {
  it('resolves "me" to current user accountId', async () => {
    getCurrentUserMock.mockResolvedValue({ accountId: 'acc-me', displayName: 'Me' });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAssign({ issueKey: 'PROJ-1', assignee: 'me' });
    expect(assignIssueMock).toHaveBeenCalledWith('PROJ-1', 'acc-me');
  });

  it('resolves "none" to null (unassign)', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAssign({ issueKey: 'PROJ-1', assignee: 'none' });
    expect(assignIssueMock).toHaveBeenCalledWith('PROJ-1', null);
    expect(getCurrentUserMock).not.toHaveBeenCalled();
  });

  it('treats "-" as unassign sugar', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAssign({ issueKey: 'PROJ-1', assignee: '-' });
    expect(assignIssueMock).toHaveBeenCalledWith('PROJ-1', null);
  });

  it('passes through a literal accountId', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAssign({ issueKey: 'PROJ-1', assignee: 'acc-42' });
    expect(assignIssueMock).toHaveBeenCalledWith('PROJ-1', 'acc-42');
  });

  it('does NOT call assignIssue on --dry-run', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAssign({ issueKey: 'PROJ-1', assignee: 'acc-1', dryRun: true, json: true });
    expect(assignIssueMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(writes.join(''));
    expect(parsed).toEqual({ dryRun: true, issueKey: 'PROJ-1', accountId: 'acc-1' });
  });

  it('emits {issueKey, accountId} JSON on success', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAssign({ issueKey: 'PROJ-1', assignee: 'acc-1', json: true });
    expect(JSON.parse(writes.join(''))).toEqual({ issueKey: 'PROJ-1', accountId: 'acc-1' });
  });
});
