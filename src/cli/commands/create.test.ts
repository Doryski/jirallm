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
const editIssueMock = vi.fn();
const uploadAttachmentMock = vi.fn();
const getIssueDescriptionAdfMock = vi.fn();
const updateIssueDescriptionAdfMock = vi.fn();
const getCreateFieldsMock = vi.fn();
const detectSprintFieldIdMock = vi.fn();
const listBoardsMock = vi.fn();
const listSprintsMock = vi.fn();
const findBoardByNameMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    createIssue = createIssueMock;
    editIssue = editIssueMock;
    uploadAttachment = uploadAttachmentMock;
    getIssueDescriptionAdf = getIssueDescriptionAdfMock;
    updateIssueDescriptionAdf = updateIssueDescriptionAdfMock;
    getCreateFields = getCreateFieldsMock;
    detectSprintFieldId = detectSprintFieldIdMock;
    listBoards = listBoardsMock;
    listSprints = listSprintsMock;
    findBoardByName = findBoardByNameMock;
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
  editIssueMock.mockReset();
  uploadAttachmentMock.mockReset();
  uploadAttachmentMock.mockImplementation(async (_key: string, file: string) => [
    { id: `id-${file}`, filename: file.split('/').pop(), size: 1 },
  ]);
  getIssueDescriptionAdfMock.mockReset();
  updateIssueDescriptionAdfMock.mockReset();
  getCreateFieldsMock.mockReset();
  getCreateFieldsMock.mockResolvedValue([
    { fieldId: 'customfield_10050', name: 'Severity', required: false },
    { fieldId: 'customfield_10020', name: 'Sprint', required: false },
  ]);
  detectSprintFieldIdMock.mockReset();
  detectSprintFieldIdMock.mockResolvedValue('customfield_10020');
  listBoardsMock.mockReset();
  listBoardsMock.mockResolvedValue({
    values: [{ id: 1, name: 'Scrum', type: 'scrum' }],
    startAt: 0,
    maxResults: 50,
    isLast: true,
  });
  listSprintsMock.mockReset();
  listSprintsMock.mockResolvedValue({
    values: [{ id: 77, name: 'Sprint 77', state: 'active', self: '' }],
    startAt: 0,
    maxResults: 50,
    isLast: true,
  });
  findBoardByNameMock.mockReset();
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

  it('forwards noWiki to createIssue when --no-wiki is set', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Task', summary: 's', description: 'h2. Heading', noWiki: true });
    expect(createIssueMock.mock.calls[0][0].noWiki).toBe(true);
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

  it('passes repeatable --components through as a trimmed array', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Bug', summary: 's', components: ['Web', ' API '] });
    expect(createIssueMock.mock.calls[0][0].components).toEqual(['Web', 'API']);
  });

  it('keeps a component name containing a comma intact (no splitting)', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Bug', summary: 's', components: ['Foo, Bar & Baz'] });
    expect(createIssueMock.mock.calls[0][0].components).toEqual(['Foo, Bar & Baz']);
  });

  it('resolves --field via configured custom field defs', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Bug', summary: 's', field: ['severity=High'] });
    expect(createIssueMock.mock.calls[0][0].customFields).toEqual({
      customfield_10050: { value: 'High' },
    });
  });

  it('writes --sprint <id> to the detected sprint field', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Story', summary: 's', sprint: '42' });
    expect(createIssueMock.mock.calls[0][0].customFields).toEqual({ customfield_10020: 42 });
    expect(listBoardsMock).not.toHaveBeenCalled();
  });

  it('resolves --sprint active via the single scrum board', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Story', summary: 's', sprint: 'active' });
    expect(createIssueMock.mock.calls[0][0].customFields).toEqual({ customfield_10020: 77 });
    expect(listSprintsMock).toHaveBeenCalledWith(1, { state: 'active' });
  });

  it('merges --sprint alongside --field values', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({
      org: 'acme',
      type: 'Story',
      summary: 's',
      field: ['severity=High'],
      sprint: '42',
    });
    expect(createIssueMock.mock.calls[0][0].customFields).toEqual({
      customfield_10050: { value: 'High' },
      customfield_10020: 42,
    });
  });

  it('surfaces shaped customFields/components in --dry-run output', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({
      org: 'acme',
      type: 'Bug',
      summary: 's',
      components: ['Web'],
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

  it('uploads --attach-images after creating the issue and rewrites the description ADF', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    getIssueDescriptionAdfMock.mockResolvedValue({
      version: 1,
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '⟦jirallm-media-0⟧' }] },
        {
          type: 'mediaGroup',
          content: [{ type: 'media', attrs: { type: 'file', id: 'uuid-1', collection: '' } }],
        },
      ],
    });

    await runCreate({
      org: 'acme',
      type: 'Bug',
      summary: 's',
      description: 'repro steps',
      attachImages: ['/tmp/repro.png:"Stack trace"'],
    });

    expect(uploadAttachmentMock).toHaveBeenCalledWith('PROJ-99', '/tmp/repro.png');
    expect(editIssueMock.mock.calls[0][1].descriptionMarkdown).toContain('⟦jirallm-media-0⟧');
    const [issueKey, adf] = updateIssueDescriptionAdfMock.mock.calls[0];
    expect(issueKey).toBe('PROJ-99');
    expect(adf.content[0].type).toBe('mediaSingle');
    expect(adf.content[1].content[0].marks).toEqual([{ type: 'em' }]);
  });

  it('leaves the create flow untouched when no files are attached', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Task', summary: 's', description: 'plain' });
    expect(uploadAttachmentMock).not.toHaveBeenCalled();
    expect(editIssueMock).not.toHaveBeenCalled();
    expect(updateIssueDescriptionAdfMock).not.toHaveBeenCalled();
  });

  it('aborts before createIssue when a --field is not on the create screen', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    getCreateFieldsMock.mockResolvedValue([
      { fieldId: 'customfield_99999', name: 'Something Else', required: false },
    ]);
    await expect(
      runCreate({ org: 'acme', type: 'Bug', summary: 's', field: ['severity=High'] })
    ).rejects.toThrow(/not on the .*create screen/i);
    expect(getCreateFieldsMock).toHaveBeenCalledWith('PROJ', 'Bug');
    expect(createIssueMock).not.toHaveBeenCalled();
  });

  it('names the offending friendly field and points at edit in the error', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    getCreateFieldsMock.mockResolvedValue([]);
    await expect(
      runCreate({ org: 'acme', type: 'Bug', summary: 's', field: ['severity=High'] })
    ).rejects.toThrow(/severity[\s\S]*jirallm edit/i);
    expect(createIssueMock).not.toHaveBeenCalled();
  });

  it('creates normally when every --field is on the create screen', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Bug', summary: 's', field: ['severity=High'] });
    expect(getCreateFieldsMock).toHaveBeenCalledWith('PROJ', 'Bug');
    expect(createIssueMock.mock.calls[0][0].customFields).toEqual({
      customfield_10050: { value: 'High' },
    });
  });

  it('skips create-screen validation entirely when no --field is passed', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Task', summary: 's' });
    expect(getCreateFieldsMock).not.toHaveBeenCalled();
    expect(createIssueMock).toHaveBeenCalled();
  });

  it('does not validate the create screen on --dry-run (stays offline)', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({
      org: 'acme',
      type: 'Bug',
      summary: 's',
      field: ['severity=High'],
      dryRun: true,
      json: true,
    });
    expect(getCreateFieldsMock).not.toHaveBeenCalled();
    expect(createIssueMock).not.toHaveBeenCalled();
  });

  it('warns and proceeds when the create screen cannot be fetched', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    getCreateFieldsMock.mockRejectedValue(new Error('403 Forbidden'));
    await runCreate({ org: 'acme', type: 'Bug', summary: 's', field: ['severity=High'] });
    expect(createIssueMock.mock.calls[0][0].customFields).toEqual({
      customfield_10050: { value: 'High' },
    });
    expect(warn).toHaveBeenCalled();
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
