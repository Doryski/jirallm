import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    project: { key: 'PROJ' },
    apiToken: 'tok',
  })),
}));

const listBoardsMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    listBoards = listBoardsMock;
  },
}));

import { runBoards } from './boards.js';

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  listBoardsMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runBoards', () => {
  it('falls back to profile.project.key when --project not provided', async () => {
    listBoardsMock.mockResolvedValue({ values: [], startAt: 0, maxResults: 50, isLast: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runBoards({ org: 'acme' });
    expect(listBoardsMock.mock.calls[0][0].projectKey).toBe('PROJ');
  });

  it('forwards explicit filters', async () => {
    listBoardsMock.mockResolvedValue({ values: [], startAt: 0, maxResults: 50, isLast: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runBoards({
      org: 'acme',
      project: 'OTHER',
      type: 'scrum',
      name: 'My',
      limit: '5',
      startAt: '10',
    });
    expect(listBoardsMock).toHaveBeenCalledWith({
      projectKey: 'OTHER',
      type: 'scrum',
      name: 'My',
      limit: 5,
      startAt: 10,
    });
  });

  it('emits page JSON when --json', async () => {
    const page = {
      values: [{ id: 7, name: 'B', type: 'kanban' }],
      startAt: 0,
      maxResults: 50,
      isLast: true,
    };
    listBoardsMock.mockResolvedValue(page);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runBoards({ org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual(page);
  });

  it('prints "[id] name (type)" lines on TTY', async () => {
    listBoardsMock.mockResolvedValue({
      values: [{ id: 7, name: 'Sprint Board', type: 'scrum' }],
      startAt: 0,
      maxResults: 50,
      isLast: true,
    });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runBoards({ org: 'acme' });
    expect(logs.join('\n')).toContain('[7] Sprint Board (scrum)');
  });
});
