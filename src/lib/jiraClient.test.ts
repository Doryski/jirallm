import { describe, expect, it, vi, beforeEach } from 'vitest';
import { JiraClient } from './jiraClient.js';

const FAKE_CONFIG = {
  baseUrl: 'https://example.atlassian.net',
  projectKey: 'PROJ',
  userEmail: 'user@example.com',
};

function makeIssueResponse(fields: Record<string, unknown>): unknown {
  return {
    key: 'PROJ-1',
    fields: {
      summary: 'Title',
      description: null,
      status: { name: 'In Progress' },
      issuetype: { name: 'Story' },
      attachment: [],
      ...fields,
    },
  };
}

function installFetchSequence(responses: unknown[]): void {
  const queue = [...responses];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const next = queue.shift();
      if (next === undefined) throw new Error('Unexpected extra fetch call');
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => next,
      } as unknown as Response;
    })
  );
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('JiraClient.fetchIssueDetails — field mapping', () => {
  it('maps all standard fields onto JiraTaskData', async () => {
    const issue = makeIssueResponse({
      priority: { name: 'High' },
      resolution: { name: 'Done' },
      assignee: { displayName: 'Jane Doe' },
      reporter: { displayName: 'John' },
      creator: { displayName: 'John' },
      created: '2026-05-20T10:00:00.000+0200',
      updated: '2026-05-23T08:30:00.000+0200',
      duedate: '2026-06-01',
      resolutiondate: '2026-05-23T09:00:00.000+0200',
      components: [{ name: 'backend' }, { name: 'auth' }],
      labels: ['p1', 'tech-debt'],
      fixVersions: [{ name: '1.4.0' }],
      versions: [{ name: '1.3.0' }],
      timetracking: { originalEstimate: '1d', remainingEstimate: '4h', timeSpent: '4h' },
      issuelinks: [
        {
          type: { inward: 'is blocked by', outward: 'blocks', name: 'Blocks' },
          outwardIssue: {
            key: 'PROJ-200',
            fields: { summary: 'Blocked one', status: { name: 'To Do' } },
          },
        },
        {
          type: { inward: 'relates to', name: 'Relates' },
          inwardIssue: {
            key: 'PROJ-300',
            fields: { summary: 'Related', status: { name: 'Done' } },
          },
        },
      ],
    });

    installFetchSequence([
      [], // /field listing
      issue, // /issue/PROJ-1
      { comments: [], total: 0, maxResults: 100, startAt: 0 }, // comments
      { changelog: { histories: [] } }, // changelog
    ]);

    const client = new JiraClient(FAKE_CONFIG, 'token');
    const task = await client.fetchIssueDetails('PROJ-1');

    expect(task.priority).toBe('High');
    expect(task.resolution).toBe('Done');
    expect(task.assignee).toBe('Jane Doe');
    expect(task.reporter).toBe('John');
    expect(task.creator).toBe('John');
    expect(task.createdAt).toBe('2026-05-20T10:00:00.000+0200');
    expect(task.updatedAt).toBe('2026-05-23T08:30:00.000+0200');
    expect(task.dueDate).toBe('2026-06-01');
    expect(task.resolutionDate).toBe('2026-05-23T09:00:00.000+0200');
    expect(task.components).toEqual(['backend', 'auth']);
    expect(task.labels).toEqual(['p1', 'tech-debt']);
    expect(task.fixVersions).toEqual(['1.4.0']);
    expect(task.versions).toEqual(['1.3.0']);
    expect(task.timetracking).toEqual({
      originalEstimate: '1d',
      remainingEstimate: '4h',
      timeSpent: '4h',
    });
    expect(task.issueLinks).toEqual([
      { type: 'blocks', key: 'PROJ-200', title: 'Blocked one', status: 'To Do' },
      { type: 'relates to', key: 'PROJ-300', title: 'Related', status: 'Done' },
    ]);
  });

  it('omits optional fields when source values are missing', async () => {
    installFetchSequence([
      [],
      makeIssueResponse({}),
      { comments: [], total: 0, maxResults: 100, startAt: 0 },
      { changelog: { histories: [] } },
    ]);
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const task = await client.fetchIssueDetails('PROJ-1');
    expect(task.priority).toBeUndefined();
    expect(task.assignee).toBeUndefined();
    expect(task.dueDate).toBeUndefined();
    expect(task.labels).toBeUndefined();
    expect(task.components).toBeUndefined();
    expect(task.issueLinks).toBeUndefined();
    expect(task.timetracking).toBeUndefined();
    expect(task.customFields).toBeUndefined();
  });

  it('extracts sprint name from auto-detected sprint custom field (array form)', async () => {
    installFetchSequence([
      [
        {
          id: 'customfield_10020',
          name: 'Sprint',
          custom: true,
          schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' },
        },
      ],
      makeIssueResponse({
        customfield_10020: [
          { name: 'Old Sprint', state: 'closed' },
          { name: 'Sprint 42', state: 'active' },
        ],
      }),
      { comments: [], total: 0, maxResults: 100, startAt: 0 },
      { changelog: { histories: [] } },
    ]);
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const task = await client.fetchIssueDetails('PROJ-1');
    expect(task.sprint).toBe('Sprint 42');
  });

  it('extracts sprint name from legacy GreenHopper string form', async () => {
    installFetchSequence([
      [
        {
          id: 'customfield_10020',
          name: 'Sprint',
          custom: true,
          schema: { custom: 'com.pyxis.greenhopper.jira:gh-sprint' },
        },
      ],
      makeIssueResponse({
        customfield_10020: [
          'com.atlassian.greenhopper.service.sprint.Sprint@1[id=12,name=Sprint 99,state=ACTIVE]',
        ],
      }),
      { comments: [], total: 0, maxResults: 100, startAt: 0 },
      { changelog: { histories: [] } },
    ]);
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const task = await client.fetchIssueDetails('PROJ-1');
    expect(task.sprint).toBe('Sprint 99');
  });

  it('reads story points via auto-detected float custom field', async () => {
    installFetchSequence([
      [
        {
          id: 'customfield_10016',
          name: 'Story Points',
          custom: true,
          schema: { custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' },
        },
      ],
      makeIssueResponse({ customfield_10016: 5 }),
      { comments: [], total: 0, maxResults: 100, startAt: 0 },
      { changelog: { histories: [] } },
    ]);
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const task = await client.fetchIssueDetails('PROJ-1');
    expect(task.storyPoints).toBe(5);
  });

  it('uses caller-provided sprint custom field override (no field listing call)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      let body: unknown;
      if (url.includes('/issue/PROJ-1?fields=')) {
        body = makeIssueResponse({
          customfield_10020: [{ name: 'Sprint X', state: 'active' }],
        });
      } else if (url.includes('/comment')) {
        body = { comments: [], total: 0, maxResults: 100, startAt: 0 };
      } else if (url.includes('expand=changelog')) {
        body = { changelog: { histories: [] } };
      } else if (url.endsWith('/field')) {
        throw new Error('Should not call /field when override provided');
      } else {
        throw new Error(`Unexpected URL: ${url}`);
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new JiraClient(FAKE_CONFIG, 'token');
    const task = await client.fetchIssueDetails('PROJ-1', {
      customFieldDefs: {
        sprint: { id: 'customfield_10020', type: 'sprint' },
        storyPoints: { id: 'customfield_10016', type: 'number' },
      },
    });
    expect(task.sprint).toBe('Sprint X');
  });

  it('maps custom fields of each type into customFields block', async () => {
    installFetchSequence([
      [], // no autodetect needed
      makeIssueResponse({
        customfield_1: { value: 'S2' }, // select
        customfield_2: { displayName: 'Owner' }, // user
        customfield_3: 'plain string', // scalar
        customfield_4: 7, // number
        customfield_5: [{ value: 'red' }, { value: 'blue' }], // array
      }),
      { comments: [], total: 0, maxResults: 100, startAt: 0 },
      { changelog: { histories: [] } },
    ]);
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const task = await client.fetchIssueDetails('PROJ-1', {
      customFieldDefs: {
        severity: { id: 'customfield_1', type: 'select' },
        owner: { id: 'customfield_2', type: 'user' },
        team: { id: 'customfield_3', type: 'scalar' },
        rank: { id: 'customfield_4', type: 'number' },
        tags: { id: 'customfield_5', type: 'array' },
      },
    });
    expect(task.customFields).toEqual({
      severity: 'S2',
      owner: 'Owner',
      team: 'plain string',
      rank: 7,
      tags: ['red', 'blue'],
    });
  });

  it('omits customFields whose source values are missing or wrong-shaped', async () => {
    installFetchSequence([
      [],
      makeIssueResponse({
        customfield_1: null,
        customfield_2: 'not-a-user-object',
        customfield_3: '', // empty scalar
      }),
      { comments: [], total: 0, maxResults: 100, startAt: 0 },
      { changelog: { histories: [] } },
    ]);
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const task = await client.fetchIssueDetails('PROJ-1', {
      customFieldDefs: {
        severity: { id: 'customfield_1', type: 'select' },
        owner: { id: 'customfield_2', type: 'user' },
        team: { id: 'customfield_3', type: 'scalar' },
      },
    });
    expect(task.customFields).toBeUndefined();
  });

  it('caches /field responses across multiple fetchIssueDetails calls', async () => {
    let fieldCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      let body: unknown;
      if (url.endsWith('/field')) {
        fieldCalls++;
        body = [];
      } else if (url.includes('/issue/PROJ-')) {
        if (url.includes('expand=changelog')) {
          body = { changelog: { histories: [] } };
        } else if (url.includes('/comment')) {
          body = { comments: [], total: 0, maxResults: 100, startAt: 0 };
        } else {
          body = makeIssueResponse({});
        }
      } else {
        throw new Error(`Unexpected URL: ${url}`);
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new JiraClient(FAKE_CONFIG, 'token');
    await client.fetchIssueDetails('PROJ-1');
    await client.fetchIssueDetails('PROJ-2');
    expect(fieldCalls).toBe(1);
  });

  it('survives /field endpoint failure (falls back to no sprint/storyPoints)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/field')) {
        return {
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          text: async () => 'denied',
        } as unknown as Response;
      }
      let body: unknown;
      if (url.includes('expand=changelog')) body = { changelog: { histories: [] } };
      else if (url.includes('/comment')) body = { comments: [], total: 0, maxResults: 100, startAt: 0 };
      else body = makeIssueResponse({});
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new JiraClient(FAKE_CONFIG, 'token');
    const task = await client.fetchIssueDetails('PROJ-1');
    expect(task.sprint).toBeUndefined();
    expect(task.storyPoints).toBeUndefined();
  });

  it('skips issueLinks with neither inwardIssue nor outwardIssue', async () => {
    installFetchSequence([
      [],
      makeIssueResponse({
        issuelinks: [{ type: { outward: 'blocks' } }],
      }),
      { comments: [], total: 0, maxResults: 100, startAt: 0 },
      { changelog: { histories: [] } },
    ]);
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const task = await client.fetchIssueDetails('PROJ-1');
    expect(task.issueLinks).toBeUndefined();
  });

  it('passes extra jiraFieldIds through to the Jira request', async () => {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      let body: unknown;
      if (url.endsWith('/field')) body = [];
      else if (url.includes('expand=changelog')) body = { changelog: { histories: [] } };
      else if (url.includes('/comment')) body = { comments: [], total: 0, maxResults: 100, startAt: 0 };
      else body = makeIssueResponse({});
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new JiraClient(FAKE_CONFIG, 'token');
    await client.fetchIssueDetails('PROJ-1', {
      jiraFieldIds: ['priority', 'labels', 'customfield_99999'],
    });
    const issueCall = urls.find((u) => u.includes('/issue/PROJ-1?fields='));
    expect(issueCall).toBeDefined();
    expect(issueCall).toContain('priority');
    expect(issueCall).toContain('labels');
    expect(issueCall).toContain('customfield_99999');
  });
});
