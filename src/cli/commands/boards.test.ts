import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadProfileMock = vi.fn();
const findOrgsByProjectKeyMock = vi.fn();
vi.mock('../../lib/config.js', () => ({
  loadProfile: (...args: unknown[]) => loadProfileMock(...args),
  findOrgsByProjectKey: (...args: unknown[]) => findOrgsByProjectKeyMock(...args),
}));

const defaultProfile = {
  config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
  project: { key: 'PROJ' },
  apiToken: 'tok',
};

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

const originalExitCode = process.exitCode;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  listBoardsMock.mockReset();
  loadProfileMock.mockReset();
  findOrgsByProjectKeyMock.mockReset();
  findOrgsByProjectKeyMock.mockReturnValue([]);
  loadProfileMock.mockResolvedValue(defaultProfile);
  process.exitCode = originalExitCode;
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
  process.exitCode = originalExitCode;
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

  it('auto-selects the sole project when --project is omitted', async () => {
    loadProfileMock.mockResolvedValue({
      config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'SOLO' },
      project: { key: 'SOLO' },
      apiToken: 'tok',
    });
    listBoardsMock.mockResolvedValue({ values: [], startAt: 0, maxResults: 50, isLast: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runBoards({ org: 'acme' });
    expect(loadProfileMock).toHaveBeenCalledWith({ org: 'acme', project: undefined });
    expect(listBoardsMock.mock.calls[0][0].projectKey).toBe('SOLO');
  });

  it('emits a JSON error and sets exit code when profile resolution fails with --json', async () => {
    loadProfileMock.mockRejectedValue(new Error('Multiple projects configured; pass --project'));
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runBoards({ org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual({
      error: 'Multiple projects configured; pass --project',
    });
    expect(listBoardsMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('emits a JSON error when the boards request fails with --json', async () => {
    listBoardsMock.mockRejectedValue(new Error('boom'));
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runBoards({ org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual({ error: 'boom' });
    expect(process.exitCode).toBe(1);
  });

  it('rethrows errors when --json is not set (human mode on TTY)', async () => {
    loadProfileMock.mockRejectedValue(new Error('no project'));
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await expect(runBoards({ org: 'acme' })).rejects.toThrow('no project');
  });

  it('infers the org from --project when --org is omitted', async () => {
    findOrgsByProjectKeyMock.mockReturnValue(['acme']);
    loadProfileMock.mockResolvedValue({
      config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'CN' },
      project: { key: 'CN' },
      apiToken: 'tok',
    });
    listBoardsMock.mockResolvedValue({ values: [], startAt: 0, maxResults: 50, isLast: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runBoards({ project: 'CN' });
    expect(findOrgsByProjectKeyMock).toHaveBeenCalledWith('CN');
    expect(loadProfileMock).toHaveBeenCalledWith({ org: 'acme', project: 'CN' });
    expect(listBoardsMock.mock.calls[0][0].projectKey).toBe('CN');
  });

  it('errors asking for --org when neither --org nor a resolvable --project is present', async () => {
    findOrgsByProjectKeyMock.mockReturnValue([]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await expect(runBoards({})).rejects.toThrow('Pass --org.');
    expect(loadProfileMock).not.toHaveBeenCalled();
  });

  it('emits a JSON error asking for --org when org cannot be resolved with --json', async () => {
    findOrgsByProjectKeyMock.mockReturnValue([]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runBoards({ json: true });
    expect(JSON.parse(writes.join('')).error).toContain('Pass --org.');
    expect(listBoardsMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
