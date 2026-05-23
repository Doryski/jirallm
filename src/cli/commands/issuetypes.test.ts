import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    project: { key: 'PROJ' },
    apiToken: 'tok',
  })),
}));

const listIssueTypesMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    listIssueTypes = listIssueTypesMock;
  },
}));

import { runIssueTypes } from './issuetypes.js';

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  listIssueTypesMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runIssueTypes', () => {
  it('falls back to profile.project.key when --project not provided', async () => {
    listIssueTypesMock.mockResolvedValue([]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runIssueTypes({ org: 'acme' });
    expect(listIssueTypesMock).toHaveBeenCalledWith('PROJ');
  });

  it('uses explicit --project override', async () => {
    listIssueTypesMock.mockResolvedValue([]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runIssueTypes({ org: 'acme', project: 'OTHER' });
    expect(listIssueTypesMock).toHaveBeenCalledWith('OTHER');
  });

  it('marks subtask types with "(subtask)" suffix on TTY', async () => {
    listIssueTypesMock.mockResolvedValue([
      { id: '1', name: 'Task', subtask: false },
      { id: '2', name: 'Sub-task', subtask: true },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runIssueTypes({ org: 'acme' });
    const out = logs.join('\n');
    expect(out).toContain('Task');
    expect(out).toContain('Sub-task (subtask)');
  });

  it('emits raw array as JSON', async () => {
    const types = [{ id: '1', name: 'Task', subtask: false }];
    listIssueTypesMock.mockResolvedValue(types);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runIssueTypes({ org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual(types);
  });
});
