import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    org: {
      name: 'solo',
      baseUrl: 'https://x',
      userEmail: 'u@x',
      projects: {},
      export: { customFieldDefs: { reproductionRate: { id: 'customfield_10051', type: 'select' } } },
    },
    apiToken: 'tok',
  })),
  findOrgsByProjectKey: vi.fn(() => ['solo']),
}));

const editIssueMock = vi.fn();
const getCurrentUserMock = vi.fn();
const searchAssignableUsersMock = vi.fn();
const searchUsersMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    editIssue = editIssueMock;
    getCurrentUser = getCurrentUserMock;
    searchAssignableUsers = searchAssignableUsersMock;
    searchUsers = searchUsersMock;
  },
}));

import { runEdit } from './edit.js';

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;
let tmp: string;

beforeEach(async () => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  editIssueMock.mockReset();
  editIssueMock.mockResolvedValue(undefined);
  getCurrentUserMock.mockReset();
  searchAssignableUsersMock.mockReset();
  searchAssignableUsersMock.mockResolvedValue([]);
  searchUsersMock.mockReset();
  searchUsersMock.mockResolvedValue([]);
  tmp = await mkdtemp(join(tmpdir(), 'jirallm-edit-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
  await rm(tmp, { recursive: true, force: true });
});

describe('runEdit', () => {
  it('maps --unassign to assigneeAccountId: null', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', unassign: true });
    expect(editIssueMock).toHaveBeenCalledWith('PROJ-1', expect.objectContaining({
      assigneeAccountId: null,
    }));
  });

  it('passes raw accountId through when --assignee looks like an accountId', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', assignee: '5b10ac8d82e05b22cc7d4ef5' });
    expect(editIssueMock.mock.calls[0][1].assigneeAccountId).toBe('5b10ac8d82e05b22cc7d4ef5');
    expect(searchAssignableUsersMock).not.toHaveBeenCalled();
    expect(searchUsersMock).not.toHaveBeenCalled();
  });

  it('--assignee none unassigns (same as --unassign)', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', assignee: 'none' });
    expect(editIssueMock.mock.calls[0][1].assigneeAccountId).toBeNull();

    editIssueMock.mockClear();
    await runEdit({ issueKey: 'PROJ-1', unassign: true });
    expect(editIssueMock.mock.calls[0][1].assigneeAccountId).toBeNull();
  });

  it("--assignee '-' unassigns", async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', assignee: '-' });
    expect(editIssueMock.mock.calls[0][1].assigneeAccountId).toBeNull();
  });

  it('--assignee me resolves via getCurrentUser', async () => {
    getCurrentUserMock.mockResolvedValue({ accountId: 'me-123', displayName: 'Me' });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', assignee: 'me' });
    expect(getCurrentUserMock).toHaveBeenCalled();
    expect(editIssueMock.mock.calls[0][1].assigneeAccountId).toBe('me-123');
  });

  it('--assignee email resolves to a single exact match', async () => {
    searchAssignableUsersMock.mockResolvedValue([
      { accountId: 'u-1', displayName: 'Jane Doe', emailAddress: 'jane@x.com' },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', assignee: 'jane@x.com' });
    expect(searchAssignableUsersMock).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'jane@x.com', issueKey: 'PROJ-1' })
    );
    expect(editIssueMock.mock.calls[0][1].assigneeAccountId).toBe('u-1');
  });

  it('parses comma-separated labels', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', labels: ' a , b , c ' });
    expect(editIssueMock.mock.calls[0][1].labels).toEqual(['a', 'b', 'c']);
  });

  it('reads description from file when --description-file', async () => {
    const path = join(tmp, 'd.md');
    await writeFile(path, 'content');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', descriptionFile: path });
    expect(editIssueMock.mock.calls[0][1].descriptionMarkdown).toBe('content');
  });

  it('does NOT call editIssue on --dry-run; emits JSON when requested', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', summary: 'new', dryRun: true, json: true });
    expect(editIssueMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.dryRun).toBe(true);
    expect(parsed.issueKey).toBe('PROJ-1');
    expect(parsed.fields.summary).toBe('new');
  });

  it('dry-run --assignee me echoes the resolved display name', async () => {
    getCurrentUserMock.mockResolvedValue({ accountId: 'me-123', displayName: 'Me User' });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', assignee: 'me', dryRun: true });
    expect(editIssueMock).not.toHaveBeenCalled();
    const output = logs.join('\n');
    expect(output).toContain('"assigneeAccountId": "me-123"');
    expect(output).toContain('"assigneeDisplayName": "Me User"');
  });

  it('dry-run --assignee email echoes the resolved display name (JSON)', async () => {
    searchAssignableUsersMock.mockResolvedValue([
      { accountId: 'u-1', displayName: 'Jane Doe', emailAddress: 'jane@x.com' },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', assignee: 'jane@x.com', dryRun: true, json: true });
    expect(editIssueMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.fields.assigneeAccountId).toBe('u-1');
    expect(parsed.fields.assigneeDisplayName).toBe('Jane Doe');
  });

  it('dry-run --assignee name echoes the resolved display name', async () => {
    searchAssignableUsersMock.mockResolvedValue([
      { accountId: 'u-9', displayName: 'John Smith' },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', assignee: 'John Smith', dryRun: true });
    expect(editIssueMock).not.toHaveBeenCalled();
    const output = logs.join('\n');
    expect(output).toContain('"assigneeAccountId": "u-9"');
    expect(output).toContain('"assigneeDisplayName": "John Smith"');
  });

  it('emits {issueKey, updated:true} when --json after success', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', summary: 'x', json: true });
    expect(JSON.parse(writes.join(''))).toEqual({ issueKey: 'PROJ-1', updated: true });
  });

  it('passes --parent and --due through to editIssue', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', parent: 'PROJ-9', due: '2026-08-01' });
    expect(editIssueMock.mock.calls[0][1].parentKey).toBe('PROJ-9');
    expect(editIssueMock.mock.calls[0][1].dueDate).toBe('2026-08-01');
  });

  it('echoes --parent and --due on --dry-run without calling editIssue', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', parent: 'PROJ-9', due: '2026-08-01', dryRun: true, json: true });
    expect(editIssueMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.fields.parentKey).toBe('PROJ-9');
    expect(parsed.fields.dueDate).toBe('2026-08-01');
  });

  it('parses --components and resolves --field via custom field defs', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({
      issueKey: 'PROJ-1',
      components: 'Web,API',
      field: ['reproductionRate=Always'],
    });
    expect(editIssueMock.mock.calls[0][1].components).toEqual(['Web', 'API']);
    expect(editIssueMock.mock.calls[0][1].customFields).toEqual({
      customfield_10051: { value: 'Always' },
    });
  });
});
