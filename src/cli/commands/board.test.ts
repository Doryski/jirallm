import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    project: { key: 'PROJ' },
    apiToken: 'tok',
  })),
}));

const getBoardColumnNamesMock = vi.fn();
const getBoardColumnStatusIdsMock = vi.fn();
const searchByJqlMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    getBoardColumnNames = getBoardColumnNamesMock;
    getBoardColumnStatusIds = getBoardColumnStatusIdsMock;
    searchByJql = searchByJqlMock;
  },
}));

import { runBoardIssues } from './board.js';

let logs: string[];
let errors: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  errors = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  getBoardColumnNamesMock.mockReset();
  getBoardColumnStatusIdsMock.mockReset();
  searchByJqlMock.mockReset();
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runBoardIssues', () => {
  it('prints available column names when --column omitted', async () => {
    getBoardColumnNamesMock.mockResolvedValue(['To Do', 'In Progress', 'Done']);
    await runBoardIssues({ org: 'acme', board: 'Sprint Board' });
    expect(getBoardColumnStatusIdsMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('To Do');
    expect(logs.join('\n')).toContain('In Progress');
    expect(logs.join('\n')).toContain('Done');
  });

  it('emits column names as JSON when --column omitted and --json', async () => {
    getBoardColumnNamesMock.mockResolvedValue(['To Do', 'Done']);
    await runBoardIssues({ org: 'acme', board: 'B', json: true });
    expect(JSON.parse(writes.join(''))).toEqual({ board: 'B', columns: ['To Do', 'Done'] });
  });

  it('emits column names JSON on non-TTY even without --json', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    getBoardColumnNamesMock.mockResolvedValue(['Backlog']);
    await runBoardIssues({ org: 'acme', board: 'B' });
    expect(JSON.parse(writes.join(''))).toEqual({ board: 'B', columns: ['Backlog'] });
  });

  it('resolves issues for a column and prints rows', async () => {
    getBoardColumnStatusIdsMock.mockResolvedValue(['10001']);
    searchByJqlMock.mockResolvedValue([
      { key: 'PROJ-1', fields: { summary: 'Fix bug', status: { name: 'In Progress' }, assignee: { displayName: 'Ann' }, issuetype: { name: 'Bug' } } },
    ]);
    await runBoardIssues({ org: 'acme', board: 'B', column: 'In Progress' });
    expect(getBoardColumnStatusIdsMock).toHaveBeenCalledWith('B', 'In Progress');
    expect(searchByJqlMock.mock.calls[0][0]).toContain('project = PROJ');
    expect(searchByJqlMock.mock.calls[0][0]).toContain('status in ("10001")');
    expect(logs.join('\n')).toContain('PROJ-1  Fix bug [Ann]');
  });

  it('emits issues object JSON when --json (byte-compatible)', async () => {
    getBoardColumnStatusIdsMock.mockResolvedValue(['10001']);
    searchByJqlMock.mockResolvedValue([
      { key: 'PROJ-1', fields: { summary: 'S', status: { name: 'Todo' } } },
    ]);
    await runBoardIssues({ org: 'acme', board: 'B', column: 'Todo', json: true });
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.board).toBe('B');
    expect(parsed.column).toBe('Todo');
    expect(parsed.issues[0].key).toBe('PROJ-1');
  });

  it('emits [] JSON when a column has no mapped statuses', async () => {
    getBoardColumnStatusIdsMock.mockResolvedValue([]);
    await runBoardIssues({ org: 'acme', board: 'B', column: 'Empty', json: true });
    expect(writes.join('')).toBe('[]\n');
    expect(JSON.parse(writes.join(''))).toEqual([]);
  });

  it('warns on stderr when column has no mapped statuses on TTY', async () => {
    getBoardColumnStatusIdsMock.mockResolvedValue([]);
    await runBoardIssues({ org: 'acme', board: 'B', column: 'Empty' });
    expect(errors.join('\n')).toContain('has no mapped statuses');
  });

  it('adds currentUser() clause for --assignee me', async () => {
    getBoardColumnStatusIdsMock.mockResolvedValue(['1']);
    searchByJqlMock.mockResolvedValue([]);
    await runBoardIssues({ org: 'acme', board: 'B', column: 'C', assignee: 'me' });
    expect(searchByJqlMock.mock.calls[0][0]).toContain('assignee = currentUser()');
  });

  it('forwards project to loadProfile for single-project auto-select', async () => {
    const { loadProfile } = await import('../../lib/config.js');
    getBoardColumnNamesMock.mockResolvedValue([]);
    await runBoardIssues({ org: 'acme', board: 'B' });
    expect(loadProfile).toHaveBeenCalledWith({ org: 'acme', project: undefined });
  });
});
