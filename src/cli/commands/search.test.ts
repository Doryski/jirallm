import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loadOrgProfileMock } = vi.hoisted(() => ({
  loadOrgProfileMock: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x' },
    org: { name: 'acme' },
    apiToken: 'tok',
  })),
}));
vi.mock('../../lib/config.js', () => ({
  loadOrgProfile: loadOrgProfileMock,
}));

const searchIssuesMock = vi.fn();
const detectSprintFieldIdMock = vi.fn(async () => 'customfield_10020');
const detectStoryPointsFieldIdMock = vi.fn(async () => 'customfield_10030');
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    searchIssues = searchIssuesMock;
    detectSprintFieldId = detectSprintFieldIdMock;
    detectStoryPointsFieldId = detectStoryPointsFieldIdMock;
  },
}));

import { runSearch } from './search.js';
import {
  parseFieldsFlag,
  resolveFieldSet,
  SEARCH_ALWAYS_FETCH,
  SEARCH_DEFAULT_KEYS,
} from '../../lib/exportFields.js';

const resolveSearchFields = (raw?: string) =>
  resolveFieldSet(raw ? parseFieldsFlag(raw) : undefined, {}, {
    alwaysFetch: SEARCH_ALWAYS_FETCH,
    defaultKeys: SEARCH_DEFAULT_KEYS,
    passThroughUnknown: true,
  });

const SAMPLE_ISSUES = [
  {
    key: 'PROJ-1',
    fields: {
      summary: 'one',
      status: { name: 'Open' },
      assignee: { displayName: 'Jane' },
      issuetype: { name: 'Task' },
      priority: { name: 'High' },
      labels: ['a', 'b'],
      duedate: '2026-08-01',
      environment: 'staging',
      customfield_10050: { value: 'Platform' },
    },
  },
  {
    key: 'PROJ-2',
    fields: { summary: 'two', status: { name: 'Done' } },
  },
];

const runJsonSearch = async (opts: Parameters<typeof runSearch>[0]) => {
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  writes.length = 0;
  await runSearch(opts);
  return JSON.parse(writes.join(''));
};

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  searchIssuesMock.mockReset();
  detectSprintFieldIdMock.mockClear();
  detectStoryPointsFieldIdMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runSearch', () => {
  it('forwards JQL, parsed fields and limit to searchIssues', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runSearch({
      jql: 'project = PROJ',
      org: 'acme',
      limit: '25',
      cursor: 'tok-1',
      fields: 'summary, status , assignee',
      json: true,
    });
    expect(searchIssuesMock).toHaveBeenCalledWith('project = PROJ', {
      fields: ['summary', 'status', 'assignee'],
      limit: 25,
      nextPageToken: 'tok-1',
    });
  });

  it('defaults limit to 50 when not provided', async () => {
    searchIssuesMock.mockResolvedValue({ issues: [], isLast: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runSearch({ jql: 'x' });
    expect(searchIssuesMock.mock.calls[0][1].limit).toBe(50);
  });

  it('emits JSON page with cursor + isLast when --json', async () => {
    searchIssuesMock.mockResolvedValue({
      issues: SAMPLE_ISSUES,
      isLast: false,
      nextPageToken: 'next-token',
    });
    const parsed = await runJsonSearch({ jql: 'x', json: true });
    expect(parsed.issues).toHaveLength(2);
    expect(parsed.issues[0]).toEqual({
      key: 'PROJ-1',
      summary: 'one',
      status: 'Open',
      assignee: 'Jane',
      issueType: 'Task',
    });
    expect(parsed.issues[1]).toEqual({ key: 'PROJ-2', summary: 'two', status: 'Done' });
    expect(parsed.nextPageToken).toBe('next-token');
    expect(parsed.isLast).toBe(false);
  });

  it('requests exactly the resolved default field IDs, without ADF-heavy fields', async () => {
    searchIssuesMock.mockResolvedValue({ issues: [], isLast: true });
    await runJsonSearch({ jql: 'x', json: true });
    const requested = searchIssuesMock.mock.calls[0][1].fields;
    expect(requested).toEqual(resolveSearchFields().jiraFieldIds);
    expect(requested).not.toContain('description');
    expect(requested).not.toContain('attachment');
  });

  it('includes extra selected fields in the JSON rows (issue #20)', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    const parsed = await runJsonSearch({
      jql: 'x',
      json: true,
      fields: 'priority,labels,duedate',
    });
    expect(searchIssuesMock.mock.calls[0][1].fields).toEqual(
      resolveSearchFields('priority,labels,duedate').jiraFieldIds
    );
    expect(parsed.issues[0]).toMatchObject({
      key: 'PROJ-1',
      summary: 'one',
      priority: 'High',
      labels: ['a', 'b'],
      dueDate: '2026-08-01',
    });
  });

  it('requests unmapped custom field IDs on the wire and passes their raw value through', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    const parsed = await runJsonSearch({ jql: 'x', json: true, fields: 'customfield_10050' });
    expect(searchIssuesMock.mock.calls[0][1].fields).toEqual(
      resolveSearchFields('customfield_10050').jiraFieldIds
    );
    expect(searchIssuesMock.mock.calls[0][1].fields).toContain('customfield_10050');
    expect(parsed.issues[0].customfield_10050).toEqual({ value: 'Platform' });
  });

  it('requests unmapped built-in Jira field names and passes their raw value through', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    const parsed = await runJsonSearch({ jql: 'x', json: true, fields: 'environment' });
    expect(searchIssuesMock.mock.calls[0][1].fields).toContain('environment');
    expect(parsed.issues[0].environment).toBe('staging');
  });

  it('omits a passed-through key when the issue has no raw value for it', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    const parsed = await runJsonSearch({ jql: 'x', json: true, fields: 'environment' });
    expect(parsed.issues[1]).toEqual({ key: 'PROJ-2', summary: 'two' });
    expect('environment' in parsed.issues[1]).toBe(false);
  });

  it('normalises raw Jira field IDs to friendly keys', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    const parsed = await runJsonSearch({ jql: 'x', json: true, fields: 'issuetype,duedate' });
    expect(searchIssuesMock.mock.calls[0][1].fields).toContain('issuetype');
    expect(parsed.issues[0].issueType).toBe('Task');
    expect(parsed.issues[0].dueDate).toBe('2026-08-01');
  });

  it('treats "all" as a preset rather than a literal field id', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    const parsed = await runJsonSearch({ jql: 'x', json: true, fields: 'all' });
    const requested = searchIssuesMock.mock.calls[0][1].fields;
    expect(requested).not.toContain('all');
    expect(requested).toEqual(expect.arrayContaining(['priority', 'labels', 'duedate']));
    expect(parsed.issues[0]).toMatchObject({ priority: 'High', dueDate: '2026-08-01' });
  });

  it('narrows the JSON rows when --fields excludes defaults', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    const parsed = await runJsonSearch({ jql: 'x', json: true, fields: 'status' });
    expect(parsed.issues[0]).toEqual({ key: 'PROJ-1', summary: 'one', status: 'Open' });
  });

  it('resolves sprint/story-point field IDs only when those keys are selected', async () => {
    searchIssuesMock.mockResolvedValue({ issues: [], isLast: true });
    await runJsonSearch({ jql: 'x', json: true });
    expect(detectSprintFieldIdMock).not.toHaveBeenCalled();
    expect(detectStoryPointsFieldIdMock).not.toHaveBeenCalled();

    await runJsonSearch({ jql: 'x', json: true, fields: 'sprint,storyPoints' });
    expect(detectSprintFieldIdMock).toHaveBeenCalled();
    expect(searchIssuesMock.mock.calls[1][1].fields).toEqual(
      expect.arrayContaining(['customfield_10020', 'customfield_10030'])
    );
  });

  it('prints "No matching issues." when empty + TTY', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    searchIssuesMock.mockResolvedValue({ issues: [], isLast: true });
    await runSearch({ jql: 'x' });
    expect(logs.join('\n')).toContain('No matching issues.');
  });

  it('loads the profile without a project requirement', async () => {
    searchIssuesMock.mockResolvedValue({ issues: [], isLast: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runSearch({ jql: 'x', org: 'acme' });
    expect(loadOrgProfileMock).toHaveBeenCalledWith({ org: 'acme' });
  });

  it('accepts --next-page-token as an alias for --cursor', async () => {
    searchIssuesMock.mockResolvedValue({ issues: [], isLast: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runSearch({ jql: 'x', nextPageToken: ' npt-1'.trim() });
    expect(searchIssuesMock.mock.calls[0][1].nextPageToken).toBe('npt-1');
  });

  it('includes status in the human-readable rows', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runSearch({ jql: 'x' });
    const out = logs.join('\n');
    expect(out).toContain('PROJ-1');
    expect(out).toMatch(/PROJ-1.*\(Open\)/);
    expect(out).toMatch(/PROJ-2.*\(Done\)/);
  });

  it('prints cursor hint when more results available + TTY', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    searchIssuesMock.mockResolvedValue({
      issues: SAMPLE_ISSUES,
      isLast: false,
      nextPageToken: 'tok-99',
    });
    await runSearch({ jql: 'x' });
    expect(logs.join('\n')).toMatch(/More results.*--cursor tok-99/);
  });
});
