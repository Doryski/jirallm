import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    project: { key: 'PROJ' },
    apiToken: 'tok',
  })),
  findOrgsByProjectKey: vi.fn((projectKey: string) => {
    if (projectKey === 'MULTI') return ['orgA', 'orgB'];
    if (projectKey === 'NONE') return [];
    return ['solo'];
  }),
}));

import { loadProfile } from '../../lib/config.js';
const loadProfileMock = vi.mocked(loadProfile);

const fetchIssueDetailsMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    fetchIssueDetails = fetchIssueDetailsMock;
  },
}));

import { runFetch } from './fetch.js';

const FAKE_DATA = {
  key: 'PROJ-1',
  title: 'A task',
  status: 'In Progress',
  description: '# body\n\nstuff',
  assignee: 'Jane',
  issueType: 'Task',
  priority: 'High',
  sprint: 'S42',
  labels: ['a', 'b'],
  attachments: [],
  history: [],
};

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  fetchIssueDetailsMock.mockReset();
  fetchIssueDetailsMock.mockResolvedValue(FAKE_DATA);
  loadProfileMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runFetch', () => {
  it('resolves org from --org flag', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFetch({ issueKey: 'PROJ-1', org: 'acme', json: true });
    expect(loadProfileMock).toHaveBeenCalledWith({ org: 'acme', project: 'PROJ' });
  });

  it('resolves org from org/KEY syntax', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFetch({ issueKey: 'acme/PROJ-1', json: true });
    expect(loadProfileMock).toHaveBeenCalledWith({ org: 'acme', project: 'PROJ' });
  });

  it('auto-resolves single matching org from project prefix', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFetch({ issueKey: 'PROJ-1', json: true });
    expect(loadProfileMock).toHaveBeenCalledWith({ org: 'solo', project: 'PROJ' });
  });

  it('throws when no org matches the project', async () => {
    await expect(runFetch({ issueKey: 'NONE-1' })).rejects.toThrow(/not found in any/);
  });

  it('throws when project exists in multiple orgs', async () => {
    await expect(runFetch({ issueKey: 'MULTI-1' })).rejects.toThrow(/multiple orgs/);
  });

  it('emits full task data JSON when --json', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFetch({ issueKey: 'PROJ-1', org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual(FAKE_DATA);
  });

  it('prints summary lines + description on TTY', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFetch({ issueKey: 'PROJ-1', org: 'acme' });
    const out = logs.join('\n');
    expect(out).toContain('PROJ-1 — A task');
    expect(out).toContain('Status:   In Progress');
    expect(out).toContain('Assignee: Jane');
    expect(out).toContain('Sprint:   S42');
    expect(out).toContain('Labels:   a, b');
    expect(out).toContain('# body');
  });
});
