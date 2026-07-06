import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoadProfile, mockFindOrgsByProjectKey } = vi.hoisted(() => ({
  mockLoadProfile: vi.fn(async (opts?: { org?: string; project?: string }) => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: opts?.project ?? 'PROJ' },
    project: { key: opts?.project ?? 'PROJ' },
    apiToken: 'tok',
  })),
  mockFindOrgsByProjectKey: vi.fn(() => ['acme']),
}));

vi.mock('../../lib/config.js', () => ({
  loadProfile: mockLoadProfile,
  findOrgsByProjectKey: mockFindOrgsByProjectKey,
  readConfig: vi.fn(() => ({ orgs: {} })),
}));

const listComponentsMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    listComponents = listComponentsMock;
  },
}));

import { runComponents } from './components.js';

let logs: string[];
let errors: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;
const originalExitCode = process.exitCode;

beforeEach(() => {
  logs = [];
  errors = [];
  writes = [];
  process.exitCode = originalExitCode;
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  listComponentsMock.mockReset();
  mockLoadProfile.mockClear();
  mockFindOrgsByProjectKey.mockClear();
  mockFindOrgsByProjectKey.mockReturnValue(['acme']);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runComponents', () => {
  it('single-project auto-select: uses profile.project.key when --project not provided', async () => {
    listComponentsMock.mockResolvedValue([]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runComponents({ org: 'acme' });
    expect(mockLoadProfile).toHaveBeenCalledWith({ org: 'acme', project: undefined });
    expect(listComponentsMock).toHaveBeenCalledWith('PROJ');
  });

  it('uses explicit --project override', async () => {
    listComponentsMock.mockResolvedValue([]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runComponents({ org: 'acme', project: 'OTHER' });
    expect(listComponentsMock).toHaveBeenCalledWith('OTHER');
  });

  it('infers org from -P when --org is omitted', async () => {
    mockFindOrgsByProjectKey.mockReturnValue(['inferred-org']);
    listComponentsMock.mockResolvedValue([]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runComponents({ project: 'PROJ' });
    expect(mockFindOrgsByProjectKey).toHaveBeenCalledWith('PROJ');
    expect(mockLoadProfile).toHaveBeenCalledWith({ org: 'inferred-org', project: 'PROJ' });
    expect(listComponentsMock).toHaveBeenCalledWith('PROJ');
  });

  it('prints names with descriptions on TTY', async () => {
    listComponentsMock.mockResolvedValue([
      { id: '1', name: 'Web', description: 'Frontend' },
      { id: '2', name: 'API' },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runComponents({ org: 'acme' });
    const out = logs.join('\n');
    expect(out).toContain('Web — Frontend');
    expect(out).toContain('API');
  });

  it('emits raw array as JSON', async () => {
    const components = [{ id: '1', name: 'Web' }];
    listComponentsMock.mockResolvedValue(components);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runComponents({ org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual(components);
  });

  it('emits a JSON error object and sets exit code when --json and the org cannot be resolved', async () => {
    mockFindOrgsByProjectKey.mockReturnValue([]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runComponents({ project: 'NOPE', json: true });
    expect(JSON.parse(writes.join(''))).toEqual({
      error: expect.stringContaining('NOPE'),
    });
    expect(process.exitCode).toBe(1);
    expect(listComponentsMock).not.toHaveBeenCalled();
  });
});
