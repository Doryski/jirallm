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

const listVersionsMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    listVersions = listVersionsMock;
  },
}));

import { runVersions, versionStatus } from './versions.js';

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;
const originalExitCode = process.exitCode;

beforeEach(() => {
  logs = [];
  writes = [];
  process.exitCode = originalExitCode;
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  listVersionsMock.mockReset();
  mockLoadProfile.mockClear();
  mockFindOrgsByProjectKey.mockClear();
  mockFindOrgsByProjectKey.mockReturnValue(['acme']);
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('versionStatus', () => {
  it('returns archived first, even when released', () => {
    expect(versionStatus({ id: '1', name: 'a', archived: true, released: true })).toBe('archived');
  });

  it('returns released when released and not archived', () => {
    expect(versionStatus({ id: '1', name: 'a', released: true })).toBe('released');
  });

  it('returns unreleased by default', () => {
    expect(versionStatus({ id: '1', name: 'a' })).toBe('unreleased');
  });
});

describe('runVersions', () => {
  it('uses profile project key and explicit override', async () => {
    listVersionsMock.mockResolvedValue([]);
    await runVersions({ org: 'acme' });
    expect(listVersionsMock).toHaveBeenCalledWith('PROJ');
    await runVersions({ org: 'acme', project: 'OTHER' });
    expect(listVersionsMock).toHaveBeenCalledWith('OTHER');
  });

  it('prints statuses with date suffixes', async () => {
    listVersionsMock.mockResolvedValue([
      { id: '1', name: '1.0', released: true, releaseDate: '2026-01-01' },
      { id: '2', name: '2.0', releaseDate: '2026-06-01' },
      { id: '3', name: '0.9', archived: true, releaseDate: '2025-01-01' },
      { id: '4', name: '3.0' },
    ]);
    await runVersions({ org: 'acme' });
    expect(logs).toEqual([
      '4 version(s):',
      '  1.0 [released] — released 2026-01-01',
      '  2.0 [unreleased] — due 2026-06-01',
      '  0.9 [archived]',
      '  3.0 [unreleased]',
    ]);
  });

  it('prints a message for an empty list', async () => {
    listVersionsMock.mockResolvedValue([]);
    await runVersions({ org: 'acme' });
    expect(logs).toEqual(['No versions found.']);
  });

  it('emits raw array as JSON', async () => {
    const versions = [{ id: '1', name: '1.0', released: true }];
    listVersionsMock.mockResolvedValue(versions);
    await runVersions({ org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual(versions);
  });

  it('emits a JSON error object and sets exit code on failure', async () => {
    mockFindOrgsByProjectKey.mockReturnValue([]);
    await runVersions({ project: 'NOPE', json: true });
    expect(JSON.parse(writes.join(''))).toEqual({ error: expect.stringContaining('NOPE') });
    expect(process.exitCode).toBe(1);
    expect(listVersionsMock).not.toHaveBeenCalled();
  });
});
