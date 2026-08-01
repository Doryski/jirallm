import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loadOrgProfileMock } = vi.hoisted(() => {
  type OrgProfile = {
    config: { baseUrl: string; userEmail: string };
    org: {
      name: string;
      export?: { customFieldDefs?: Record<string, { id: string; type: string }> };
    };
    apiToken: string;
  };
  const profile: OrgProfile = {
    config: { baseUrl: 'https://x', userEmail: 'u@x' },
    org: { name: 'acme' },
    apiToken: 'tok',
  };
  return { loadOrgProfileMock: vi.fn(async (): Promise<OrgProfile> => profile) };
});
vi.mock('../../lib/config.js', () => ({
  loadOrgProfile: loadOrgProfileMock,
}));

const searchIssuesMock = vi.fn();
const detectSprintFieldIdMock = vi.fn(async () => 'customfield_10020');
const detectStoryPointsFieldIdMock = vi.fn(async () => 'customfield_10030');
const detectEpicLinkFieldIdMock = vi.fn(async (): Promise<string | undefined> => 'customfield_10014');
const listFieldsMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    searchIssues = searchIssuesMock;
    detectSprintFieldId = detectSprintFieldIdMock;
    detectStoryPointsFieldId = detectStoryPointsFieldIdMock;
    detectEpicLinkFieldId = detectEpicLinkFieldIdMock;
    listFields = listFieldsMock;
  },
}));

const CATALOG = [
  {
    id: 'summary',
    key: 'summary',
    name: 'Summary',
    custom: false,
    orderable: true,
    navigable: true,
    searchable: true,
    clauseNames: ['summary'],
    schema: { type: 'string', system: 'summary' },
  },
  {
    id: 'status',
    key: 'status',
    name: 'Status',
    custom: false,
    orderable: false,
    navigable: true,
    searchable: true,
    clauseNames: ['status'],
    schema: { type: 'status', system: 'status' },
  },
  {
    id: 'environment',
    key: 'environment',
    name: 'Environment',
    custom: false,
    orderable: true,
    navigable: true,
    searchable: true,
    clauseNames: ['environment'],
    schema: { type: 'string', system: 'environment' },
  },
  {
    id: 'customfield_10050',
    key: 'customfield_10050',
    name: 'Team',
    untranslatedName: 'Team',
    custom: true,
    orderable: true,
    navigable: true,
    searchable: true,
    clauseNames: ['cf[10050]', 'Team'],
    schema: {
      type: 'option',
      custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select',
      customId: 10050,
    },
  },
  {
    id: 'customfield_10020',
    key: 'customfield_10020',
    name: 'Sprint',
    custom: true,
    orderable: true,
    navigable: true,
    searchable: true,
    clauseNames: ['cf[10020]', 'Sprint'],
    schema: {
      type: 'array',
      items: 'json',
      custom: 'com.pyxis.greenhopper.jira:gh-sprint',
      customId: 10020,
    },
  },
  {
    id: 'customfield_10014',
    key: 'customfield_10014',
    name: 'Epic Link',
    custom: true,
    orderable: true,
    navigable: true,
    searchable: true,
    clauseNames: ['cf[10014]', 'Epic Link'],
    schema: {
      type: 'any',
      custom: 'com.pyxis.greenhopper.jira:gh-epic-link',
      customId: 10014,
    },
  },
  {
    id: 'customfield_10016',
    key: 'customfield_10016',
    name: 'Story Points',
    custom: true,
    orderable: true,
    navigable: true,
    searchable: true,
    clauseNames: ['cf[10016]', 'Story Points'],
    schema: {
      type: 'number',
      custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float',
      customId: 10016,
    },
  },
] as const;

import { runSearch } from './search.js';
import {
  parseFieldsFlag,
  resolveFieldSet,
  SEARCH_ALWAYS_FETCH,
  SEARCH_DEFAULT_KEYS,
} from '../../lib/exportFields.js';
import { COMMON_EPIC_FIELDS } from '../../lib/fieldProjection.js';

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
      parent: { key: 'PROJ-9', fields: { summary: 'Parent task', status: { name: 'To Do' } } },
    },
  },
  {
    key: 'PROJ-2',
    fields: { summary: 'two', status: { name: 'Done' } },
  },
] as const;

const ISSUE_WITH_EPIC = {
  key: 'PROJ-3',
  fields: {
    summary: 'three',
    status: { name: 'Open' },
    customfield_10014: { key: 'PROJ-50', fields: { summary: 'Epic fifty' } },
    customfield_10008: { key: 'PROJ-60', fields: { summary: 'Epic sixty' } },
    customfield_99001: 'PROJ-77',
  },
} as const;

const ISSUE_WITH_LEGACY_EPIC = {
  key: 'PROJ-4',
  fields: {
    summary: 'four',
    status: { name: 'Open' },
    customfield_10008: { key: 'PROJ-60', fields: { summary: 'Epic sixty' } },
  },
} as const;

const childOf = (key: string, parentKey: string) =>
  ({
    key,
    fields: {
      summary: `child ${key}`,
      status: { name: 'Open' },
      parent: { key: parentKey, fields: { summary: `epic ${parentKey}`, status: { name: 'Open' } } },
    },
  }) as const;

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
  detectEpicLinkFieldIdMock.mockClear();
  detectEpicLinkFieldIdMock.mockResolvedValue('customfield_10014');
  listFieldsMock.mockReset();
  listFieldsMock.mockResolvedValue([...CATALOG]);
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
      parent: { key: 'PROJ-9', title: 'Parent task', status: 'To Do' },
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

  it('requests parent by default and carries it as {key, title, status} in the rows', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    const parsed = await runJsonSearch({ jql: 'x', json: true });
    expect(searchIssuesMock.mock.calls[0][1].fields).toContain('parent');
    expect(parsed.issues[0].parent).toEqual({
      key: 'PROJ-9',
      title: 'Parent task',
      status: 'To Do',
    });
  });

  it('carries the parent issueType and priority into the rows when Jira expands them (issue #22)', async () => {
    searchIssuesMock.mockResolvedValue({
      issues: [
        {
          key: 'PROJ-101',
          fields: {
            summary: 'child',
            status: { name: 'Open' },
            parent: {
              key: 'PROJ-100',
              fields: {
                summary: 'Parent epic',
                status: { name: 'QA Testing' },
                issuetype: { name: 'Epic' },
                priority: { name: 'Low' },
              },
            },
          },
        },
      ],
      isLast: true,
    });
    const parsed = await runJsonSearch({ jql: 'x', json: true });
    expect(parsed.issues[0].parent).toEqual({
      key: 'PROJ-100',
      title: 'Parent epic',
      status: 'QA Testing',
      issueType: 'Epic',
      priority: 'Low',
    });
  });

  it('tells an Epic parent from a Story parent in one page, without a second round trip', async () => {
    const parentOf = (key: string, parentKey: string, parentType: string) => ({
      key,
      fields: {
        summary: `child ${key}`,
        status: { name: 'Open' },
        parent: {
          key: parentKey,
          fields: { summary: `parent ${parentKey}`, issuetype: { name: parentType } },
        },
      },
    });
    searchIssuesMock.mockResolvedValue({
      issues: [
        parentOf('PROJ-101', 'PROJ-100', 'Epic'),
        parentOf('PROJ-201', 'PROJ-200', 'Story'),
      ],
      isLast: true,
    });
    const parsed = await runJsonSearch({ jql: 'x', json: true });
    const byParentType = parsed.issues.map(
      (row: { key: string; parent?: { issueType?: string } }) => [row.key, row.parent?.issueType]
    );
    expect(byParentType).toEqual([
      ['PROJ-101', 'Epic'],
      ['PROJ-201', 'Story'],
    ]);
  });

  it('leaves parent issueType and priority absent, not empty, when Jira omits them', async () => {
    searchIssuesMock.mockResolvedValue({ issues: [childOf('PROJ-101', 'PROJ-100')], isLast: true });
    const parsed = await runJsonSearch({ jql: 'x', json: true });
    const { parent } = parsed.issues[0];
    expect(parent).toEqual({ key: 'PROJ-100', title: 'epic PROJ-100', status: 'Open' });
    expect('issueType' in parent).toBe(false);
    expect('priority' in parent).toBe(false);
  });

  it('groups a page of children into a parent → children map (issue #21)', async () => {
    searchIssuesMock.mockResolvedValue({
      issues: [
        childOf('PROJ-101', 'PROJ-100'),
        childOf('PROJ-201', 'PROJ-200'),
        childOf('PROJ-102', 'PROJ-100'),
        childOf('PROJ-301', 'PROJ-300'),
      ],
      isLast: true,
    });
    const parsed = await runJsonSearch({
      jql: 'parent in (PROJ-100, PROJ-200, PROJ-300)',
      json: true,
    });
    const grouped = parsed.issues.reduce(
      (acc: Record<string, string[]>, row: { key: string; parent?: { key: string } }) => {
        const parentKey = row.parent?.key ?? 'orphan';
        acc[parentKey] = [...(acc[parentKey] ?? []), row.key];
        return acc;
      },
      {}
    );
    expect(grouped).toEqual({
      'PROJ-100': ['PROJ-101', 'PROJ-102'],
      'PROJ-200': ['PROJ-201'],
      'PROJ-300': ['PROJ-301'],
    });
  });

  it('omits parent entirely for an issue that has none', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    const parsed = await runJsonSearch({ jql: 'x', json: true });
    expect('parent' in parsed.issues[1]).toBe(false);
    expect(parsed.issues[1]).toEqual({ key: 'PROJ-2', summary: 'two', status: 'Done' });
  });

  it('drops parent from the requested IDs and the rows on --fields -parent', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    const parsed = await runJsonSearch({ jql: 'x', json: true, fields: '-parent' });
    expect(searchIssuesMock.mock.calls[0][1].fields).not.toContain('parent');
    expect(new Set(resolveSearchFields('-parent').friendlyKeys)).toEqual(
      new Set(SEARCH_DEFAULT_KEYS.filter((key) => key !== 'parent'))
    );
    expect('parent' in parsed.issues[0]).toBe(false);
  });

  it('renders every row when one of them carries a parent with no expanded fields', async () => {
    searchIssuesMock.mockResolvedValue({
      issues: [
        childOf('PROJ-101', 'PROJ-100'),
        { key: 'PROJ-102', fields: { summary: 'restricted', parent: { key: 'PROJ-200' } } },
        childOf('PROJ-103', 'PROJ-100'),
      ],
      isLast: true,
    });
    const parsed = await runJsonSearch({ jql: 'x', json: true });
    expect(parsed.issues.map((row: { key: string }) => row.key)).toEqual([
      'PROJ-101',
      'PROJ-102',
      'PROJ-103',
    ]);
    expect(parsed.issues[1].parent).toEqual({ key: 'PROJ-200', title: '' });
  });

  it('never includes parent for a narrowing selector', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    const parsed = await runJsonSearch({ jql: 'x', json: true, fields: 'summary,status' });
    expect(searchIssuesMock.mock.calls[0][1].fields).not.toContain('parent');
    expect('parent' in parsed.issues[0]).toBe(false);
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

  it('appends the parent key to the human-readable row only when the issue has a parent', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runSearch({ jql: 'x' });
    const [first, second] = logs.filter((line) => line.includes('PROJ-'));
    expect(first).toContain('parent: PROJ-9');
    expect(second).not.toContain('parent:');
  });

  it('never asks Jira for the field catalog when no --fields is given (issue #23 follow-up)', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    await runJsonSearch({ jql: 'x', json: true });
    expect(listFieldsMock).not.toHaveBeenCalled();
  });

  it('never asks Jira for the field catalog when every name is known (issue #23 follow-up)', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    await runJsonSearch({ jql: 'x', json: true, fields: 'status,assignee,+labels,-parent' });
    expect(listFieldsMock).not.toHaveBeenCalled();
    expect(searchIssuesMock).toHaveBeenCalled();
  });

  it('accepts a raw custom field id that the catalog knows (issue #23 follow-up)', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    const parsed = await runJsonSearch({ jql: 'x', json: true, fields: 'customfield_10050' });
    expect(listFieldsMock).toHaveBeenCalledTimes(1);
    expect(searchIssuesMock.mock.calls[0][1].fields).toContain('customfield_10050');
    expect(parsed.issues[0].customfield_10050).toEqual({ value: 'Platform' });
  });

  it('accepts a raw system field id the catalog knows (issue #23 follow-up)', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    const parsed = await runJsonSearch({ jql: 'x', json: true, fields: 'environment' });
    expect(searchIssuesMock.mock.calls[0][1].fields).toContain('environment');
    expect(parsed.issues[0].environment).toBe('staging');
  });

  it('rejects a display name and names the id to use instead (issue #23 follow-up)', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    await expect(runSearch({ jql: 'x', json: true, fields: 'Team' })).rejects.toThrow(
      /Unknown field "Team"\..*raw Jira field IDs, not display names.*"Team" → "customfield_10050"/s
    );
    expect(searchIssuesMock).not.toHaveBeenCalled();
  });

  it('rejects a mis-cased id rather than passing it through empty (issue #23 follow-up)', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    await expect(runSearch({ jql: 'x', json: true, fields: 'Environment' })).rejects.toThrow(
      /"Environment" → "environment"/
    );
  });

  it('reports name-only and unknown tokens together (issue #23 follow-up)', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    const err = await runSearch({ jql: 'x', json: true, fields: 'Team,issuelinkz' }).catch(
      (e: Error) => e
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('"Team" → "customfield_10050"');
    expect((err as Error).message).toContain('Unknown field "issuelinkz"');
    expect((err as Error).message).toContain('Did you mean "issueLinks"?');
  });

  it('never suggests a display name as a fix for a typo (issue #23 follow-up)', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    const err = await runSearch({ jql: 'x', json: true, fields: 'enviroment' }).catch(
      (e: Error) => e
    );
    expect((err as Error).message).toContain('Did you mean "environment"?');
    expect((err as Error).message).not.toContain('"Environment"');
  });

  it('does not reject an exclude token, which never reaches Jira (issue #23 follow-up)', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    await runJsonSearch({ jql: 'x', json: true, fields: 'default,-customfield_99999' });
    expect(listFieldsMock).not.toHaveBeenCalled();
    expect(searchIssuesMock.mock.calls[0][1].fields).not.toContain('customfield_99999');
  });

  it('passes the *all / *navigable wildcards through unchecked (issue #23 follow-up)', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    await runJsonSearch({ jql: 'x', json: true, fields: '*all' });
    expect(listFieldsMock).not.toHaveBeenCalled();
    expect(searchIssuesMock.mock.calls[0][1].fields).toContain('*all');

    await runJsonSearch({ jql: 'x', json: true, fields: '+*navigable' });
    expect(searchIssuesMock.mock.calls[1][1].fields).toContain('*navigable');
  });

  it('asks for the field catalog exactly once per search (issue #23 follow-up)', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    await runJsonSearch({ jql: 'x', json: true, fields: 'sprint,customfield_10050' });
    expect(listFieldsMock).toHaveBeenCalledTimes(1);
  });

  it('validates an additive raw field id the same way (issue #23 follow-up)', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    await runJsonSearch({ jql: 'x', json: true, fields: '+customfield_10050' });
    expect(listFieldsMock).toHaveBeenCalledTimes(1);
    expect(searchIssuesMock.mock.calls[0][1].fields).toContain('customfield_10050');

    await expect(
      runSearch({ jql: 'x', json: true, fields: '+issuelinkz' })
    ).rejects.toThrow(/issuelinkz/);
  });

  it('rejects a typo that matches neither jirallm nor the Jira catalog (issue #23 follow-up)', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    await expect(runSearch({ jql: 'x', json: true, fields: 'issuelinkz' })).rejects.toThrow(
      /Unknown field "issuelinkz"\..*Did you mean "issueLinks"\?.*jirallm fields/s
    );
    expect(searchIssuesMock).not.toHaveBeenCalled();
  });

  it('resolves a capitalised built-in instead of rejecting it (issue #25 follow-up)', async () => {
    searchIssuesMock.mockResolvedValue({
      issues: [
        {
          key: 'PROJ-1',
          fields: {
            summary: 'one',
            status: { name: 'Open' },
            customfield_10020: [{ name: 'Sprint 7', state: 'active' }],
          },
        },
      ],
      isLast: true,
    });
    const parsed = await runJsonSearch({ jql: 'x', json: true, fields: 'Sprint' });
    expect(searchIssuesMock.mock.calls[0][1].fields).toContain('customfield_10020');
    expect(searchIssuesMock.mock.calls[0][1].fields).not.toContain('__sprint__');
    expect(parsed.issues[0]).toMatchObject({ key: 'PROJ-1', sprint: 'Sprint 7' });
  });

  it('steers a capitalised configured custom-field key to that key (issue #23 follow-up)', async () => {
    loadOrgProfileMock.mockResolvedValueOnce({
      config: { baseUrl: 'https://x', userEmail: 'u@x' },
      org: { name: 'acme', export: { customFieldDefs: { team: { id: 'customfield_10050', type: 'select' } } } },
      apiToken: 'tok',
    });
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    const err = await runSearch({ jql: 'x', json: true, fields: 'Team' }).catch((e: Error) => e);
    expect((err as Error).message).toContain('Did you mean "team"?');
    expect((err as Error).message).not.toContain('customfield_10050');
  });

  it('accepts a custom-field key that only the org config defines, with no catalog call (issue #23 follow-up)', async () => {
    loadOrgProfileMock.mockResolvedValueOnce({
      config: { baseUrl: 'https://x', userEmail: 'u@x' },
      org: { name: 'acme', export: { customFieldDefs: { severity: { id: 'customfield_77777', type: 'select' } } } },
      apiToken: 'tok',
    });
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    await runJsonSearch({ jql: 'x', json: true, fields: 'severity' });
    expect(listFieldsMock).not.toHaveBeenCalled();
    expect(searchIssuesMock.mock.calls[0][1].fields).toContain('customfield_77777');
  });

  it('lists every id when a display name is ambiguous (issue #23 follow-up)', async () => {
    listFieldsMock.mockResolvedValue([
      { id: 'customfield_10050', name: 'Team', custom: true },
      { id: 'customfield_20050', name: 'Team', custom: true },
    ]);
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    const err = await runSearch({ jql: 'x', json: true, fields: 'Team' }).catch((e: Error) => e);
    expect((err as Error).message).toContain('"customfield_10050", "customfield_20050"');
    expect((err as Error).message).toContain('2 fields share that name');
  });

  it('reports several aliased and several unknown tokens in one error (issue #23 follow-up)', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    const err = await runSearch({
      jql: 'x',
      json: true,
      fields: 'Team,Story Points,issuelinkz,labelz',
    }).catch((e: Error) => e);
    const message = (err as Error).message;
    expect(message).toContain('"Team" → "customfield_10050"');
    expect(message).toContain('"Story Points" → "customfield_10016"');
    expect(message).toContain('Unknown fields "issuelinkz", "labelz"');
    expect(message).toContain('"issuelinkz" → "issueLinks"');
    expect(message).toContain('"labelz" → "labels"');
  });

  it('validates bare and unknown "*" tokens instead of waving them through (issue #23 follow-up)', async () => {
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    await expect(runSearch({ jql: 'x', json: true, fields: '*' })).rejects.toThrow(
      /Unknown field "\*"/
    );
    await expect(runSearch({ jql: 'x', json: true, fields: '*foo' })).rejects.toThrow(
      /Unknown field "\*foo"/
    );
    expect(searchIssuesMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-array body', { values: [] }],
    ['a null entry', [null]],
    ['an entry with no id', [{ name: 'Team', custom: true }]],
    ['an empty catalog', []],
  ])('warns and still searches on %s (issue #23 follow-up)', async (_label, response) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    listFieldsMock.mockResolvedValue(response);
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    await runJsonSearch({ jql: 'x', json: true, fields: 'customfield_10050' });
    expect(warn.mock.calls[0][0]).toContain('Warning: could not verify --fields');
    expect(searchIssuesMock).toHaveBeenCalled();
    expect(searchIssuesMock.mock.calls[0][1].fields).toContain('customfield_10050');
  });

  it('warns and still searches when the field catalog is unreachable (issue #23 follow-up)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    listFieldsMock.mockRejectedValue(new Error('403 Forbidden'));
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    await runJsonSearch({ jql: 'x', json: true, fields: 'issuelinkz' });
    expect(warn.mock.calls[0][0]).toContain('Warning: could not verify --fields');
    expect(warn.mock.calls[0][0]).toContain('403 Forbidden');
    expect(searchIssuesMock).toHaveBeenCalled();
  });

  it('puts the resolved Epic Link id on the wire and the epic on the row (issue #25)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    searchIssuesMock.mockResolvedValue({ issues: [ISSUE_WITH_EPIC], isLast: true });
    const parsed = await runJsonSearch({ jql: 'x', json: true, fields: 'default,+epic' });
    expect(detectEpicLinkFieldIdMock).toHaveBeenCalledTimes(1);
    expect(searchIssuesMock.mock.calls[0][1].fields).toContain('customfield_10014');
    expect(parsed.issues[0].epic).toEqual({ key: 'PROJ-50', title: 'Epic fifty' });
  });

  it('prefers the org-config epic id over autodetection (issue #25)', async () => {
    loadOrgProfileMock.mockResolvedValueOnce({
      config: { baseUrl: 'https://x', userEmail: 'u@x' },
      org: {
        name: 'acme',
        export: { customFieldDefs: { epic: { id: 'customfield_99001', type: 'scalar' } } },
      },
      apiToken: 'tok',
    });
    searchIssuesMock.mockResolvedValue({ issues: [ISSUE_WITH_EPIC], isLast: true });
    const parsed = await runJsonSearch({ jql: 'x', json: true, fields: 'epic' });
    expect(detectEpicLinkFieldIdMock).not.toHaveBeenCalled();
    expect(searchIssuesMock.mock.calls[0][1].fields).toContain('customfield_99001');
    expect(parsed.issues[0].epic).toEqual({ key: 'PROJ-77' });
  });

  it('falls back to the common epic field ids when detection finds nothing (issue #25)', async () => {
    detectEpicLinkFieldIdMock.mockResolvedValue(undefined);
    searchIssuesMock.mockResolvedValue({ issues: [ISSUE_WITH_LEGACY_EPIC], isLast: true });
    const parsed = await runJsonSearch({ jql: 'x', json: true, fields: 'epic' });
    const requested = searchIssuesMock.mock.calls[0][1].fields;
    expect(requested).toEqual(expect.arrayContaining([...COMMON_EPIC_FIELDS]));
    expect(parsed.issues[0].epic).toEqual({ key: 'PROJ-60', title: 'Epic sixty' });
  });

  it('never detects the Epic Link field when epic is not selected (issue #25)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    await runJsonSearch({ jql: 'x', json: true });
    expect(detectEpicLinkFieldIdMock).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(searchIssuesMock.mock.calls[0][1].fields).not.toEqual(
      expect.arrayContaining([...COMMON_EPIC_FIELDS])
    );
  });

  it.each(['subtasks', 'default,+subtasks'])(
    'rejects an explicitly requested subtasks in --fields "%s" (issue #25)',
    async (fields) => {
      searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
      await expect(runSearch({ jql: 'x', json: true, fields })).rejects.toThrow(
        'Unsupported field `subtasks`. `search` cannot project it — a Jira search page carries ' +
          'no subtask data, and reading it would cost one extra request per row. Drop `subtasks` ' +
          'from `--fields`, or run `jirallm fetch <KEY> --with-subtasks` for a single issue.'
      );
      expect(searchIssuesMock).not.toHaveBeenCalled();
    }
  );

  it.each(['Subtasks', 'SUBTASKS', 'default,+Subtasks', 'default,+ subtasks '])(
    'rejects a case/space variant of subtasks in --fields "%s" (issue #25)',
    async (fields) => {
      searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
      await expect(runSearch({ jql: 'x', json: true, fields })).rejects.toThrow(
        'Unsupported field `subtasks`. `search` cannot project it — a Jira search page carries ' +
          'no subtask data, and reading it would cost one extra request per row. Drop `subtasks` ' +
          'from `--fields`, or run `jirallm fetch <KEY> --with-subtasks` for a single issue.'
      );
      expect(searchIssuesMock).not.toHaveBeenCalled();
    }
  );

  it('never puts a subtasks variant on the wire even when the field catalog read fails (issue #25)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    listFieldsMock.mockRejectedValue(new Error('catalog unavailable'));
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    await expect(runSearch({ jql: 'x', json: true, fields: 'default,+Subtasks' })).rejects.toThrow(
      /Unsupported field `subtasks`/
    );
    expect(searchIssuesMock).not.toHaveBeenCalled();

    await runJsonSearch({ jql: 'x', json: true, fields: 'default' });
    const requested: string[] = searchIssuesMock.mock.calls[0][1].fields;
    expect(requested.some((id) => id.trim().toLowerCase() === 'subtasks')).toBe(false);
  });

  it('does not throw when a subtasks case variant is excluded (issue #25)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    await expect(runSearch({ jql: 'x', json: true, fields: 'minimal,-Subtasks' })).resolves.toBeUndefined();
    const requested: string[] = searchIssuesMock.mock.calls[0][1].fields;
    expect(requested.some((id) => id.trim().toLowerCase() === 'subtasks')).toBe(false);
  });

  it.each(['minimal', 'default', 'all'] as const)(
    'warns once about preset subtasks and still searches for --fields "%s" (issue #25)',
    async (preset) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      searchIssuesMock.mockResolvedValue({ issues: [ISSUE_WITH_EPIC], isLast: true });
      const parsed = await runJsonSearch({ jql: 'x', json: true, fields: preset });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toBe(
        `Warning: the \`${preset}\` preset lists \`subtasks\`, which \`search\` cannot project — ` +
          'a Jira search page carries no subtask data, so the key is omitted from the rows. Run ' +
          '`jirallm fetch <KEY> --with-subtasks` for a single issue.'
      );
      expect(searchIssuesMock).toHaveBeenCalledTimes(1);
      expect('subtasks' in parsed.issues[0]).toBe(false);
      expect(parsed.issues[0].epic).toEqual({ key: 'PROJ-50', title: 'Epic fifty' });
    }
  );

  it('leaves a bare search free of any subtasks warning (issue #25)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    searchIssuesMock.mockResolvedValue({ issues: SAMPLE_ISSUES, isLast: true });
    const parsed = await runJsonSearch({ jql: 'x', json: true });
    expect(warn).not.toHaveBeenCalled();
    expect('subtasks' in parsed.issues[0]).toBe(false);
    expect('epic' in parsed.issues[0]).toBe(false);
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
