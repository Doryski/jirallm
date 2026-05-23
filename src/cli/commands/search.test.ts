import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    project: { key: 'PROJ' },
    apiToken: 'tok',
  })),
}));

const searchIssuesMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    searchIssues = searchIssuesMock;
  },
}));

import { runSearch } from './search.js';

const SAMPLE_ISSUES = [
  {
    key: 'PROJ-1',
    fields: {
      summary: 'one',
      status: { name: 'Open' },
      assignee: { displayName: 'Jane' },
      issuetype: { name: 'Task' },
    },
  },
  {
    key: 'PROJ-2',
    fields: { summary: 'two', status: { name: 'Done' } },
  },
];

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  searchIssuesMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runSearch', () => {
  it('forwards JQL, parsed fields and limit to searchIssues', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runSearch({
      jql: 'project = PROJ',
      org: 'acme',
      limit: '25',
      cursor: 'tok-1',
      fields: 'summary, status , assignee',
      json: true,
    });
    expect(searchIssuesMock).toHaveBeenCalledWith('project = PROJ', {
      fields: ['summary', 'status', 'assignee'],
      limit: 25,
      nextPageToken: 'tok-1',
    });
  });

  it('defaults limit to 50 when not provided', async () => {
    searchIssuesMock.mockResolvedValue({ issues: [], isLast: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runSearch({ jql: 'x' });
    expect(searchIssuesMock.mock.calls[0][1].limit).toBe(50);
  });

  it('emits JSON page with cursor + isLast when --json', async () => {
    searchIssuesMock.mockResolvedValue({
      issues: SAMPLE_ISSUES,
      isLast: false,
      nextPageToken: 'next-token',
    });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runSearch({ jql: 'x', json: true });
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.issues).toHaveLength(2);
    expect(parsed.issues[0]).toEqual({
      key: 'PROJ-1',
      summary: 'one',
      status: 'Open',
      assignee: 'Jane',
      issueType: 'Task',
    });
    expect(parsed.nextPageToken).toBe('next-token');
    expect(parsed.isLast).toBe(false);
  });

  it('prints "No matching issues." when empty + TTY', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    searchIssuesMock.mockResolvedValue({ issues: [], isLast: true });
    await runSearch({ jql: 'x' });
    expect(logs.join('\n')).toContain('No matching issues.');
  });

  it('prints cursor hint when more results available + TTY', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    searchIssuesMock.mockResolvedValue({
      issues: SAMPLE_ISSUES,
      isLast: false,
      nextPageToken: 'tok-99',
    });
    await runSearch({ jql: 'x' });
    expect(logs.join('\n')).toMatch(/More results.*--cursor tok-99/);
  });
});
