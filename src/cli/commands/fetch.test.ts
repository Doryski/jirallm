import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    org: { name: 'solo', export: undefined },
    project: { key: 'PROJ' },
    apiToken: 'tok',
  })),
  findOrgsByProjectKey: vi.fn((projectKey: string) => {
    if (projectKey === 'MULTI') return ['orgA', 'orgB'];
    if (projectKey === 'NONE') return [];
    return ['solo'];
  }),
}));

import { loadProfile } from '../../lib/config.js';
const loadProfileMock = vi.mocked(loadProfile);

const fetchIssueDetailsMock = vi.fn();
const fetchIssueSubtasksMock = vi.fn();
const fetchIssueRawMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    fetchIssueDetails = fetchIssueDetailsMock;
    fetchIssueSubtasks = fetchIssueSubtasksMock;
    fetchIssueRaw = fetchIssueRawMock;
  },
}));

import { runFetch } from './fetch.js';
import { resolveFieldSet } from '../../lib/exportFields.js';

const DEFAULT_FIELD_IDS = resolveFieldSet(undefined, {}).jiraFieldIds;

const FAKE_DATA = {
  key: 'PROJ-1',
  title: 'A task',
  status: 'In Progress',
  description: '# body\n\nstuff',
  assignee: 'Jane',
  issueType: 'Task',
  priority: 'High',
  sprint: 'S42',
  labels: ['a', 'b'],
  attachments: [],
  history: [],
};

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  fetchIssueDetailsMock.mockReset();
  fetchIssueDetailsMock.mockResolvedValue(FAKE_DATA);
  fetchIssueSubtasksMock.mockReset();
  fetchIssueSubtasksMock.mockResolvedValue([]);
  fetchIssueRawMock.mockReset();
  loadProfileMock.mockClear();
  loadProfileMock.mockResolvedValue({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    org: { name: 'solo', baseUrl: 'https://x', userEmail: 'u@x', projects: {}, export: undefined },
    project: { key: 'PROJ' },
    apiToken: 'tok',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runFetch', () => {
  it('resolves org from --org flag', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFetch({ issueKey: 'PROJ-1', org: 'acme', json: true });
    expect(loadProfileMock).toHaveBeenCalledWith({ org: 'acme', project: 'PROJ' });
  });

  it('resolves org from org/KEY syntax', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFetch({ issueKey: 'acme/PROJ-1', json: true });
    expect(loadProfileMock).toHaveBeenCalledWith({ org: 'acme', project: 'PROJ' });
  });

  it('auto-resolves single matching org from project prefix', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFetch({ issueKey: 'PROJ-1', json: true });
    expect(loadProfileMock).toHaveBeenCalledWith({ org: 'solo', project: 'PROJ' });
  });

  it('throws when no org matches the project', async () => {
    await expect(runFetch({ issueKey: 'NONE-1' })).rejects.toThrow(/not found in any/);
  });

  it('throws when project exists in multiple orgs', async () => {
    await expect(runFetch({ issueKey: 'MULTI-1' })).rejects.toThrow(/multiple orgs/);
  });

  it('emits full task data JSON when --json', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFetch({ issueKey: 'PROJ-1', org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual(FAKE_DATA);
  });

  it('prints summary lines + description on TTY', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFetch({ issueKey: 'PROJ-1', org: 'acme' });
    const out = logs.join('\n');
    expect(out).toContain('PROJ-1 — A task');
    expect(out).toContain('Status:   In Progress');
    expect(out).toContain('Assignee: Jane');
    expect(out).toContain('Sprint:   S42');
    expect(out).toContain('Labels:   a, b');
    expect(out).toContain('# body');
  });

  it('lean fetch (no flags) passes all include options off', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFetch({ issueKey: 'PROJ-1', org: 'acme' });
    expect(fetchIssueDetailsMock).toHaveBeenCalledWith('PROJ-1', {
      jiraFieldIds: DEFAULT_FIELD_IDS,
      customFieldDefs: {},
      includeComments: false,
      includeChangelog: false,
      fullChangelog: false,
      includeWorklog: false,
      includeLinks: false,
    });
    expect(fetchIssueSubtasksMock).not.toHaveBeenCalled();
  });

  it('--full turns every include option on and fetches subtasks', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFetch({ issueKey: 'PROJ-1', org: 'acme', full: true });
    expect(fetchIssueDetailsMock).toHaveBeenCalledWith('PROJ-1', {
      jiraFieldIds: DEFAULT_FIELD_IDS,
      customFieldDefs: {},
      includeComments: true,
      includeChangelog: true,
      fullChangelog: true,
      includeWorklog: true,
      includeLinks: true,
    });
    expect(fetchIssueSubtasksMock).toHaveBeenCalledWith('PROJ-1');
  });

  it('--full renders all pretty sections when data is present', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    fetchIssueDetailsMock.mockResolvedValue({
      ...FAKE_DATA,
      history: [
        { type: 'comment', author: 'Al', date: '2026-01-01', content: 'a comment' },
        { type: 'status_change', author: 'Bo', date: '2026-01-02', content: 'To Do → Done' },
        { type: 'field_change', author: 'Cy', date: '2026-01-03', field: 'priority', content: 'priority: Low → High' },
      ],
      worklogs: [{ author: 'Wo', started: '2026-01-04', timeSpent: '1h', comment: 'did work' }],
      issueLinks: [{ type: 'Blocks', key: 'PROJ-2', title: 'Other', status: 'Open' }],
      attachments: [{ id: '1', filename: 'a.png', url: 'https://x/a.png', size: 42 }],
    });
    fetchIssueSubtasksMock.mockResolvedValue([{ key: 'PROJ-3', title: 'Sub', status: 'To Do' }]);
    await runFetch({ issueKey: 'PROJ-1', org: 'acme', full: true });
    const out = logs.join('\n');
    expect(out).toContain('## Comments');
    expect(out).toContain('a comment');
    expect(out).toContain('## History');
    expect(out).toContain('To Do → Done');
    expect(out).toContain('priority: Low → High');
    expect(out).toContain('## Worklog');
    expect(out).toContain('did work');
    expect(out).toContain('## Subtasks');
    expect(out).toContain('PROJ-3');
    expect(out).toContain('## Links');
    expect(out).toContain('Blocks: PROJ-2');
    expect(out).toContain('## Attachments');
    expect(out).toContain('a.png');
  });

  it('renders only the sections whose flag is set', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    fetchIssueDetailsMock.mockResolvedValue({
      ...FAKE_DATA,
      history: [
        { type: 'comment', author: 'Al', date: '2026-01-01', content: 'a comment' },
        { type: 'status_change', author: 'Bo', date: '2026-01-02', content: 'To Do → Done' },
      ],
    });
    await runFetch({ issueKey: 'PROJ-1', org: 'acme', withComments: true });
    const out = logs.join('\n');
    expect(out).toContain('## Comments');
    expect(out).not.toContain('## History');
    expect(out).not.toContain('## Worklog');
    expect(out).not.toContain('## Subtasks');
    expect(out).not.toContain('## Links');
    expect(out).not.toContain('## Attachments');
  });

  it('--fields all widens the requested Jira field set', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFetch({ issueKey: 'PROJ-1', org: 'acme', json: true, fields: 'all' });
    const expected = resolveFieldSet({ preset: 'all' }, {}).jiraFieldIds;
    expect(fetchIssueDetailsMock).toHaveBeenCalledWith(
      'PROJ-1',
      expect.objectContaining({ jiraFieldIds: expected, customFieldDefs: {} })
    );
  });

  it('passes org custom field defs into the fetch', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const customFieldDefs = { team: { id: 'customfield_10050', type: 'select' as const } };
    loadProfileMock.mockResolvedValueOnce({
      config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
      org: {
        name: 'solo',
        baseUrl: 'https://x',
        userEmail: 'u@x',
        projects: {},
        export: { customFieldDefs },
      },
      project: { key: 'PROJ' },
      apiToken: 'tok',
    });
    await runFetch({ issueKey: 'PROJ-1', org: 'acme', json: true });
    const call = fetchIssueDetailsMock.mock.calls[0][1];
    expect(call.customFieldDefs).toEqual(customFieldDefs);
    expect(call.jiraFieldIds).toContain('customfield_10050');
  });

  it('--raw dumps the untransformed Jira field object as JSON', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const rawIssue = {
      key: 'PROJ-1',
      fields: { labels: ['x'], components: [{ name: 'API' }], customfield_10050: { value: 'A' } },
      names: { customfield_10050: 'Team' },
    };
    fetchIssueRawMock.mockResolvedValue(rawIssue);
    await runFetch({ issueKey: 'PROJ-1', org: 'acme', raw: true });
    expect(fetchIssueRawMock).toHaveBeenCalledWith('PROJ-1', ['names']);
    expect(fetchIssueDetailsMock).not.toHaveBeenCalled();
    expect(JSON.parse(writes.join(''))).toEqual(rawIssue);
  });

  it('--rendered expands renderedFields and dumps the raw object as JSON', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const rawIssue = {
      key: 'PROJ-1',
      fields: { description: { type: 'doc' } },
      renderedFields: { description: '<h1>body</h1>' },
    };
    fetchIssueRawMock.mockResolvedValue(rawIssue);
    await runFetch({ issueKey: 'PROJ-1', org: 'acme', rendered: true });
    expect(fetchIssueRawMock).toHaveBeenCalledWith('PROJ-1', ['names', 'renderedFields']);
    expect(fetchIssueDetailsMock).not.toHaveBeenCalled();
    expect(JSON.parse(writes.join(''))).toEqual(rawIssue);
  });

  it('--expand passes through extra expand params (deduped with names) on the raw object', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    fetchIssueRawMock.mockResolvedValue({ key: 'PROJ-1', fields: {} });
    await runFetch({ issueKey: 'PROJ-1', org: 'acme', expand: 'changelog, renderedFields , names' });
    expect(fetchIssueRawMock).toHaveBeenCalledWith('PROJ-1', ['names', 'changelog', 'renderedFields']);
    expect(fetchIssueDetailsMock).not.toHaveBeenCalled();
  });

  it('still prints full data JSON in json mode with flags', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    const rich = { ...FAKE_DATA, worklogs: [{ author: 'Wo', started: 's', timeSpent: '1h' }] };
    fetchIssueDetailsMock.mockResolvedValue(rich);
    await runFetch({ issueKey: 'PROJ-1', org: 'acme', json: true, full: true });
    expect(JSON.parse(writes.join(''))).toEqual({
      ...rich,
      subtasks: [],
    });
  });
});
