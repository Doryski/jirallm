import { describe, expect, it } from 'vitest';
import { PROJECTABLE_FIELDS, projectIssueFields } from './fieldProjection.js';

const ALL_KEYS = [...PROJECTABLE_FIELDS];

const RAW_FIELDS = {
  status: { name: 'In Progress' },
  issuetype: { name: 'Story' },
  priority: { name: 'High' },
  resolution: { name: 'Done' },
  assignee: { displayName: 'Jane Doe' },
  reporter: { displayName: 'John' },
  creator: { displayName: 'Ann' },
  created: '2026-05-20T10:00:00.000+0200',
  updated: '2026-05-23T08:30:00.000+0200',
  duedate: '2026-06-01',
  resolutiondate: '2026-05-23T09:00:00.000+0200',
  components: [{ name: 'backend' }, { name: 'auth' }],
  labels: ['p1', 'tech-debt'],
  fixVersions: [{ name: '1.4.0' }],
  versions: [{ name: '1.3.0' }],
  timetracking: { originalEstimate: '1d', remainingEstimate: '4h', timeSpent: '4h' },
  parent: {
    key: 'PROJ-9',
    fields: {
      summary: 'Parent task',
      status: { name: 'To Do' },
      issuetype: { name: 'Epic' },
      priority: { name: 'High' },
    },
  },
  customfield_10014: { key: 'PROJ-2', fields: { summary: 'The epic' } },
};

describe('projectIssueFields', () => {
  it('emits only the selected keys', () => {
    const projected = projectIssueFields(RAW_FIELDS, ['status', 'assignee']);
    expect(projected).toEqual({ status: 'In Progress', assignee: 'Jane Doe' });
  });

  it('omits fields whose raw values are missing', () => {
    expect(projectIssueFields({}, ALL_KEYS)).toEqual({});
  });

  it('omits empty arrays, empty strings and non-string dates', () => {
    const projected = projectIssueFields(
      { labels: [], components: [], duedate: '', resolutiondate: '', created: 12345 },
      ALL_KEYS
    );
    expect(projected).toEqual({});
  });

  it('reads .name for status-like fields and .displayName for user fields', () => {
    const projected = projectIssueFields(RAW_FIELDS, ALL_KEYS);
    expect(projected.status).toBe('In Progress');
    expect(projected.issueType).toBe('Story');
    expect(projected.priority).toBe('High');
    expect(projected.resolution).toBe('Done');
    expect(projected.assignee).toBe('Jane Doe');
    expect(projected.reporter).toBe('John');
    expect(projected.creator).toBe('Ann');
  });

  it('maps array fields to plain name lists', () => {
    const projected = projectIssueFields(RAW_FIELDS, ALL_KEYS);
    expect(projected.components).toEqual(['backend', 'auth']);
    expect(projected.labels).toEqual(['p1', 'tech-debt']);
    expect(projected.fixVersions).toEqual(['1.4.0']);
    expect(projected.versions).toEqual(['1.3.0']);
  });

  it('carries date fields through untouched', () => {
    const projected = projectIssueFields(RAW_FIELDS, ALL_KEYS);
    expect(projected.createdAt).toBe('2026-05-20T10:00:00.000+0200');
    expect(projected.updatedAt).toBe('2026-05-23T08:30:00.000+0200');
    expect(projected.dueDate).toBe('2026-06-01');
    expect(projected.resolutionDate).toBe('2026-05-23T09:00:00.000+0200');
  });

  it('summarises parent as key, title, status, issue type and priority', () => {
    const projected = projectIssueFields(RAW_FIELDS, ALL_KEYS);
    expect(projected.parent).toEqual({
      key: 'PROJ-9',
      title: 'Parent task',
      status: 'To Do',
      issueType: 'Epic',
      priority: 'High',
    });
  });

  it('distinguishes an epic parent from a story parent', () => {
    const parentOf = (issuetype: string) =>
      projectIssueFields(
        {
          parent: {
            key: 'PROJ-9',
            fields: { summary: 'Parent', status: { name: 'To Do' }, issuetype: { name: issuetype } },
          },
        },
        ['parent']
      ).parent;
    expect(parentOf('Epic')?.issueType).toBe('Epic');
    expect(parentOf('Story')?.issueType).toBe('Story');
  });

  it('omits parent issue type and priority when the raw sub-fields are absent or empty', () => {
    const projected = projectIssueFields(
      {
        parent: {
          key: 'PROJ-9',
          fields: { summary: 'Parent task', status: { name: 'To Do' }, priority: { name: '' } },
        },
      },
      ['parent']
    );
    expect(projected.parent).toEqual({ key: 'PROJ-9', title: 'Parent task', status: 'To Do' });
  });

  it('keeps the parent key when Jira returns no expanded fields member', () => {
    const projected = projectIssueFields(
      { parent: { id: '10001', key: 'PROJ-9', self: 'https://x/rest/api/3/issue/10001' } },
      ['parent']
    );
    expect(projected.parent).toEqual({ key: 'PROJ-9', title: '', status: undefined });
  });

  it('tolerates a parent whose fields member is partial', () => {
    const projected = projectIssueFields({ parent: { key: 'PROJ-9', fields: {} } }, ['parent']);
    expect(projected.parent).toEqual({ key: 'PROJ-9', title: '', status: undefined });
  });

  it('omits parent when the raw value carries no usable key', () => {
    for (const parent of [{}, { key: '' }, { key: 42 }, null]) {
      expect(projectIssueFields({ parent }, ['parent'])).toEqual({});
    }
  });

  it('extracts the epic from the first matching epic-link custom field', () => {
    const projected = projectIssueFields(RAW_FIELDS, ALL_KEYS);
    expect(projected.epic).toEqual({ key: 'PROJ-2', title: 'The epic' });
  });

  it('labels issue links with the inward or outward direction', () => {
    const projected = projectIssueFields(
      {
        issuelinks: [
          {
            id: '1',
            type: { inward: 'is blocked by', outward: 'blocks', name: 'Blocks' },
            outwardIssue: {
              key: 'PROJ-200',
              fields: { summary: 'Blocked', status: { name: 'To Do' } },
            },
          },
          {
            id: '2',
            type: { inward: 'is blocked by', outward: 'blocks', name: 'Blocks' },
            inwardIssue: {
              key: 'PROJ-300',
              fields: { summary: 'Blocker', status: { name: 'Done' } },
            },
          },
        ],
      },
      ALL_KEYS
    );
    expect(projected.issueLinks).toEqual([
      { id: '1', type: 'blocks', key: 'PROJ-200', title: 'Blocked', status: 'To Do' },
      { id: '2', type: 'is blocked by', key: 'PROJ-300', title: 'Blocker', status: 'Done' },
    ]);
  });

  it('falls back to the link type name when no direction label exists', () => {
    const projected = projectIssueFields(
      {
        issuelinks: [
          {
            id: '3',
            type: { name: 'Relates' },
            inwardIssue: { key: 'PROJ-400', fields: { summary: 'Related' } },
          },
        ],
      },
      ALL_KEYS
    );
    expect(projected.issueLinks).toEqual([
      { id: '3', type: 'Relates', key: 'PROJ-400', title: 'Related', status: undefined },
    ]);
  });

  it('omits issue links when no side of the link is populated', () => {
    const projected = projectIssueFields({ issuelinks: [{ id: '4', type: {} }] }, ALL_KEYS);
    expect(projected.issueLinks).toBeUndefined();
  });

  it('emits timetracking only when at least one estimate is present', () => {
    const projected = projectIssueFields(RAW_FIELDS, ALL_KEYS);
    expect(projected.timetracking).toEqual({
      originalEstimate: '1d',
      remainingEstimate: '4h',
      timeSpent: '4h',
    });
    expect(projectIssueFields({ timetracking: {} }, ALL_KEYS).timetracking).toBeUndefined();
  });

  it('resolves sprint and story points through the context field ids', () => {
    const projected = projectIssueFields(
      {
        customfield_10020: [
          { name: 'Sprint 41', state: 'closed' },
          { name: 'Sprint 42', state: 'active' },
        ],
        customfield_10016: 5,
      },
      ALL_KEYS,
      { sprintFieldId: 'customfield_10020', storyPointsFieldId: 'customfield_10016' }
    );
    expect(projected.sprint).toBe('Sprint 42');
    expect(projected.storyPoints).toBe(5);
  });

  it('omits sprint when the active sprint entry has an empty name', () => {
    const projected = projectIssueFields(
      { customfield_10020: [{ name: '', state: 'active' }] },
      ALL_KEYS,
      { sprintFieldId: 'customfield_10020' }
    );
    expect('sprint' in projected).toBe(false);
  });

  it('omits sprint and story points when no context field ids are given', () => {
    const projected = projectIssueFields(
      { customfield_10020: [{ name: 'Sprint 42', state: 'active' }], customfield_10016: 5 },
      ALL_KEYS
    );
    expect(projected.sprint).toBeUndefined();
    expect(projected.storyPoints).toBeUndefined();
  });

  it('projects selected custom fields and drops empty or unselected ones', () => {
    const projected = projectIssueFields(
      {
        customfield_11000: { value: 'Platform' },
        customfield_11001: { displayName: 'Jane Doe' },
        customfield_11002: '',
        customfield_11003: 'hidden',
      },
      ['team', 'owner', 'note'],
      {
        customFieldDefs: {
          team: { id: 'customfield_11000', type: 'select' },
          owner: { id: 'customfield_11001', type: 'user' },
          note: { id: 'customfield_11002', type: 'scalar' },
          secret: { id: 'customfield_11003', type: 'scalar' },
        },
      }
    );
    expect(projected.customFields).toEqual({ team: 'Platform', owner: 'Jane Doe' });
  });

  it('omits customFields entirely when nothing survives extraction', () => {
    const projected = projectIssueFields({ customfield_11000: null }, ['team'], {
      customFieldDefs: { team: { id: 'customfield_11000', type: 'select' } },
    });
    expect(projected.customFields).toBeUndefined();
  });

  it('never emits the sprint and storyPoints sentinels as custom fields', () => {
    const projected = projectIssueFields(
      { customfield_10020: [{ name: 'Sprint 42', state: 'active' }] },
      ['sprint', 'storyPoints'],
      {
        sprintFieldId: 'customfield_10020',
        customFieldDefs: {
          sprint: { id: 'customfield_10020', type: 'sprint' },
          storyPoints: { id: 'customfield_10016', type: 'number' },
        },
      }
    );
    expect(projected.customFields).toBeUndefined();
    expect(projected.sprint).toBe('Sprint 42');
  });
});
