import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loadOrgProfileMock, findOrgsByProjectKeyMock } = vi.hoisted(() => ({
  loadOrgProfileMock: vi.fn(),
  findOrgsByProjectKeyMock: vi.fn(),
}));

vi.mock('../../lib/config.js', async () => {
  const actual = await vi.importActual<typeof import('../../lib/config.js')>('../../lib/config.js');
  return {
    ...actual,
    loadOrgProfile: loadOrgProfileMock,
    findOrgsByProjectKey: findOrgsByProjectKeyMock,
  };
});

const listFieldsMock = vi.fn();
const getCreateFieldsMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    listFields = listFieldsMock;
    getCreateFields = getCreateFieldsMock;
  },
}));

import { runFields } from './fields.js';

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
  listFieldsMock.mockReset();
  getCreateFieldsMock.mockReset();
  loadOrgProfileMock.mockReset();
  findOrgsByProjectKeyMock.mockReset();
  loadOrgProfileMock.mockResolvedValue(makeProfile({ PROJ: { key: 'PROJ' } }));
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runFields (default)', () => {
  it('lists only custom fields with their ids', async () => {
    listFieldsMock.mockResolvedValue([
      { id: 'summary', name: 'Summary', custom: false },
      { id: 'customfield_10050', name: 'Severity', custom: true },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFields({ org: 'acme' });
    const out = logs.join('\n');
    expect(out).toContain('Severity [customfield_10050]');
    expect(out).not.toContain('Summary');
  });

  it('lists fields org-wide regardless of resolvable project (listFields is global)', async () => {
    loadOrgProfileMock.mockResolvedValue(
      makeProfile({ PROJ: { key: 'PROJ' }, OTHER: { key: 'OTHER' } })
    );
    listFieldsMock.mockResolvedValue([]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFields({ org: 'acme' });
    expect(listFieldsMock).toHaveBeenCalled();
  });

  it('emits custom fields as JSON', async () => {
    listFieldsMock.mockResolvedValue([
      { id: 'customfield_10050', name: 'Severity', custom: true },
      { id: 'summary', name: 'Summary', custom: false },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFields({ org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual([
      { id: 'customfield_10050', name: 'Severity', custom: true },
    ]);
  });

  it('auto-switches to JSON on a non-TTY stdout even without --json', async () => {
    listFieldsMock.mockResolvedValue([
      { id: 'customfield_10050', name: 'Severity', custom: true },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    await runFields({ org: 'acme' });
    expect(JSON.parse(writes.join(''))).toEqual([
      { id: 'customfield_10050', name: 'Severity', custom: true },
    ]);
    expect(logs.join('\n')).toBe('');
  });
});

describe('runFields (--type)', () => {
  it('scopes createmeta to the sole project when --project not provided', async () => {
    getCreateFieldsMock.mockResolvedValue([
      {
        fieldId: 'customfield_10050',
        name: 'Severity',
        required: true,
        schemaType: 'option',
        allowedValues: ['High', 'Low'],
      },
      { fieldId: 'summary', name: 'Summary', required: true },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFields({ org: 'acme', type: 'Bug' });
    expect(getCreateFieldsMock).toHaveBeenCalledWith('PROJ', 'Bug');
    const out = logs.join('\n');
    expect(out).toContain('Severity [customfield_10050] (required)');
    expect(out).toContain('options: High, Low');
    expect(out).not.toContain('Summary');
  });

  it('uses explicit --project override for createmeta', async () => {
    loadOrgProfileMock.mockResolvedValue(
      makeProfile({ PROJ: { key: 'PROJ' }, OTHER: { key: 'OTHER' } })
    );
    getCreateFieldsMock.mockResolvedValue([]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFields({ org: 'acme', type: 'Bug', project: 'OTHER' });
    expect(getCreateFieldsMock).toHaveBeenCalledWith('OTHER', 'Bug');
  });

  it('resolves org from -P project key when -o is absent', async () => {
    findOrgsByProjectKeyMock.mockReturnValue(['CargoNest']);
    loadOrgProfileMock.mockResolvedValue(makeProfile({ CN: { key: 'CN' } }));
    getCreateFieldsMock.mockResolvedValue([]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFields({ type: 'Bug', project: 'CN' });
    expect(findOrgsByProjectKeyMock).toHaveBeenCalledWith('CN');
    expect(loadOrgProfileMock).toHaveBeenCalledWith({ org: 'CargoNest' });
  });

  it('errors clearly when the -P project key maps to no org', async () => {
    findOrgsByProjectKeyMock.mockReturnValue([]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await expect(runFields({ project: 'ZZ' })).rejects.toThrow(/not found in any configured org/);
    expect(loadOrgProfileMock).not.toHaveBeenCalled();
  });

  it('errors clearly when the -P project key is ambiguous across orgs', async () => {
    findOrgsByProjectKeyMock.mockReturnValue(['CargoNest', 'Acme']);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await expect(runFields({ project: 'CN' })).rejects.toThrow(/multiple orgs/);
    expect(loadOrgProfileMock).not.toHaveBeenCalled();
  });

  it('throws when --type is used but no project can be resolved', async () => {
    loadOrgProfileMock.mockResolvedValue(
      makeProfile({ PROJ: { key: 'PROJ' }, OTHER: { key: 'OTHER' } })
    );
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await expect(runFields({ org: 'acme', type: 'Bug' })).rejects.toThrow(/Cannot resolve a project/);
    expect(getCreateFieldsMock).not.toHaveBeenCalled();
  });
});
