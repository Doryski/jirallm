import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadOrgProfileMock = vi.fn();
vi.mock('../../lib/config.js', async () => {
  const actual = await vi.importActual<typeof import('../../lib/config.js')>('../../lib/config.js');
  return {
    ...actual,
    loadOrgProfile: (...args: unknown[]) => loadOrgProfileMock(...args),
  };
});

const resolveAccountIdMock = vi.fn();
vi.mock('../resolveUser.js', () => ({
  resolveAccountId: (...args: unknown[]) => resolveAccountIdMock(...args),
}));

const createIssueMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    createIssue = createIssueMock;
  },
}));

const singleProjectProfile = () => ({
  config: { baseUrl: 'https://x', userEmail: 'u@x' },
  org: {
    name: 'acme',
    baseUrl: 'https://x',
    userEmail: 'u@x',
    projects: { PROJ: { key: 'PROJ' } },
    export: { customFieldDefs: { severity: { id: 'customfield_10050', type: 'select' } } },
  },
  apiToken: 'tok',
});

import { runCreate } from './create.js';

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;
let tmp: string;

beforeEach(async () => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  createIssueMock.mockReset();
  createIssueMock.mockResolvedValue({ id: '100', key: 'PROJ-99', self: 'https://x' });
  loadOrgProfileMock.mockReset();
  loadOrgProfileMock.mockImplementation(async () => singleProjectProfile());
  resolveAccountIdMock.mockReset();
  resolveAccountIdMock.mockImplementation(async (_client: unknown, input: string) => ({
    accountId: input,
  }));
  tmp = await mkdtemp(join(tmpdir(), 'jirallm-create-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
  await rm(tmp, { recursive: true, force: true });
});

describe('runCreate', () => {
  it('parses comma-separated labels and forwards all fields', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({
      org: 'acme',
      projectKey: 'PROJ',
      type: 'Bug',
      summary: 'Crash',
      description: '**hi**',
      assignee: 'acc-1',
      labels: 'a, b , c',
      priority: 'High',
      parent: 'PROJ-1',
    });
    expect(createIssueMock).toHaveBeenCalledWith({
      projectKey: 'PROJ',
      issueType: 'Bug',
      summary: 'Crash',
      descriptionMarkdown: '**hi**',
      assigneeAccountId: 'acc-1',
      labels: ['a', 'b', 'c'],
      priority: 'High',
      parentKey: 'PROJ-1',
    });
    expect(logs.join('\n')).toContain('✓ Created PROJ-99');
  });

  it('reads description from --description-file', async () => {
    const path = join(tmp, 'desc.md');
    await writeFile(path, '**from file**');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Task', summary: 's', descriptionFile: path });
    expect(createIssueMock.mock.calls[0][0].descriptionMarkdown).toBe('**from file**');
  });

  it('falls back to profile project key when --project not provided', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Task', summary: 's' });
    expect(createIssueMock.mock.calls[0][0].projectKey).toBe('PROJ');
  });

  it('does NOT call createIssue on --dry-run; emits JSON when requested', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Task', summary: 's', dryRun: true, json: true });
    expect(createIssueMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.dryRun).toBe(true);
    expect(parsed.input.summary).toBe('s');
  });

  it('emits creation result JSON when --json (no dry run)', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Task', summary: 's', json: true });
    expect(JSON.parse(writes.join(''))).toEqual({
      id: '100',
      key: 'PROJ-99',
      self: 'https://x',
    });
  });

  it('passes undefined description when neither flag provided', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Task', summary: 's' });
    expect(createIssueMock.mock.calls[0][0].descriptionMarkdown).toBeUndefined();
  });

  it('parses --components into a string array', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Bug', summary: 's', components: 'Web, API' });
    expect(createIssueMock.mock.calls[0][0].components).toEqual(['Web', 'API']);
  });

  it('resolves --field via configured custom field defs', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Bug', summary: 's', field: ['severity=High'] });
    expect(createIssueMock.mock.calls[0][0].customFields).toEqual({
      customfield_10050: { value: 'High' },
    });
  });

  it('surfaces shaped customFields/components in --dry-run output', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({
      org: 'acme',
      type: 'Bug',
      summary: 's',
      components: 'Web',
      field: ['severity=High'],
      dryRun: true,
      json: true,
    });
    expect(createIssueMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.input.components).toEqual(['Web']);
    expect(parsed.input.customFields).toEqual({ customfield_10050: { value: 'High' } });
  });

  it('resolves --assignee me via resolveAccountId', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    resolveAccountIdMock.mockResolvedValue({ accountId: 'me-account-123', displayName: 'Me' });
    await runCreate({ org: 'acme', type: 'Task', summary: 's', assignee: 'me' });
    expect(resolveAccountIdMock).toHaveBeenCalledWith(expect.anything(), 'me', { project: 'PROJ' });
    expect(createIssueMock.mock.calls[0][0].assigneeAccountId).toBe('me-account-123');
  });

  it('resolves --assignee by email/name via resolveAccountId', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    resolveAccountIdMock.mockResolvedValue({ accountId: 'acc-from-email', displayName: 'Ann' });
    await runCreate({ org: 'acme', type: 'Task', summary: 's', assignee: 'ann@x.com' });
    expect(resolveAccountIdMock).toHaveBeenCalledWith(expect.anything(), 'ann@x.com', {
      project: 'PROJ',
    });
    expect(createIssueMock.mock.calls[0][0].assigneeAccountId).toBe('acc-from-email');
  });

  it('echoes resolved assignee displayName in --dry-run JSON output', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    resolveAccountIdMock.mockResolvedValue({ accountId: 'me-account-123', displayName: 'Me' });
    await runCreate({ org: 'acme', type: 'Task', summary: 's', assignee: 'me', dryRun: true, json: true });
    expect(createIssueMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.input.assigneeAccountId).toBe('me-account-123');
    expect(parsed.input.assigneeDisplayName).toBe('Me');
  });

  it('echoes resolved assignee displayName in human --dry-run output', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    resolveAccountIdMock.mockResolvedValue({ accountId: 'acc-from-email', displayName: 'Ann' });
    await runCreate({ org: 'acme', type: 'Task', summary: 's', assignee: 'ann@x.com', dryRun: true });
    expect(createIssueMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('"assigneeDisplayName": "Ann"');
  });

  it('leaves assignee undefined and skips resolution when --assignee omitted', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Task', summary: 's' });
    expect(resolveAccountIdMock).not.toHaveBeenCalled();
    expect(createIssueMock.mock.calls[0][0].assigneeAccountId).toBeUndefined();
  });

  it('auto-picks the sole project when --project is omitted (single-project create)', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Task', summary: 's' });
    expect(createIssueMock.mock.calls[0][0].projectKey).toBe('PROJ');
  });

  it('throws when no project can be resolved (multiple projects, no --project)', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    loadOrgProfileMock.mockImplementation(async () => ({
      ...singleProjectProfile(),
      org: {
        ...singleProjectProfile().org,
        projects: { PROJ: { key: 'PROJ' }, OTHER: { key: 'OTHER' } },
      },
    }));
    await expect(runCreate({ org: 'acme', type: 'Task', summary: 's' })).rejects.toThrow(
      /No project specified/
    );
    expect(createIssueMock).not.toHaveBeenCalled();
  });

  it('parses --field before failing on a missing project', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    loadOrgProfileMock.mockImplementation(async () => ({
      ...singleProjectProfile(),
      org: { ...singleProjectProfile().org, projects: {} },
    }));
    await expect(
      runCreate({ org: 'acme', type: 'Task', summary: 's', field: ['bad-token'] })
    ).rejects.toThrow(/Invalid --field/);
    expect(createIssueMock).not.toHaveBeenCalled();
  });
});
