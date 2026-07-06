import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loadOrgProfileMock, findOrgsByProjectKeyMock } = vi.hoisted(() => ({
  loadOrgProfileMock: vi.fn(),
  findOrgsByProjectKeyMock: vi.fn(() => ['acme']),
}));

vi.mock('../../lib/config.js', async () => {
  const actual = await vi.importActual<typeof import('../../lib/config.js')>('../../lib/config.js');
  return {
    ...actual,
    loadOrgProfile: loadOrgProfileMock,
    findOrgsByProjectKey: findOrgsByProjectKeyMock,
  };
});

const listIssueTypesMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    listIssueTypes = listIssueTypesMock;
  },
}));

import { runIssueTypes } from './issuetypes.js';

const makeProfile = (projects: Record<string, { key: string }>) => ({
  config: { baseUrl: 'https://x', userEmail: 'u@x' },
  org: { name: 'acme', baseUrl: 'https://x', userEmail: 'u@x', projects },
  apiToken: 'tok',
});

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  listIssueTypesMock.mockReset();
  loadOrgProfileMock.mockReset();
  loadOrgProfileMock.mockResolvedValue(makeProfile({ PROJ: { key: 'PROJ' } }));
  findOrgsByProjectKeyMock.mockClear();
  findOrgsByProjectKeyMock.mockReturnValue(['acme']);
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runIssueTypes', () => {
  it('project-scopes to the sole project when --project not provided', async () => {
    listIssueTypesMock.mockResolvedValue([]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runIssueTypes({ org: 'acme' });
    expect(listIssueTypesMock).toHaveBeenCalledWith('PROJ');
  });

  it('lists org-wide issue types when no project is resolvable', async () => {
    loadOrgProfileMock.mockResolvedValue(
      makeProfile({ PROJ: { key: 'PROJ' }, OTHER: { key: 'OTHER' } })
    );
    listIssueTypesMock.mockResolvedValue([]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runIssueTypes({ org: 'acme' });
    expect(listIssueTypesMock).toHaveBeenCalledWith(undefined);
  });

  it('infers org from -P when --org is omitted and project-scopes the listing', async () => {
    findOrgsByProjectKeyMock.mockReturnValue(['CargoNest']);
    loadOrgProfileMock.mockResolvedValue(makeProfile({ CN: { key: 'CN' } }));
    listIssueTypesMock.mockResolvedValue([]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runIssueTypes({ project: 'CN' });
    expect(findOrgsByProjectKeyMock).toHaveBeenCalledWith('CN');
    expect(loadOrgProfileMock).toHaveBeenCalledWith({ org: 'CargoNest' });
    expect(listIssueTypesMock).toHaveBeenCalledWith('CN');
  });

  it('uses explicit --project override', async () => {
    loadOrgProfileMock.mockResolvedValue(
      makeProfile({ PROJ: { key: 'PROJ' }, OTHER: { key: 'OTHER' } })
    );
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
