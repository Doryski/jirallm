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
          id: '10501',
          type: { inward: 'is blocked by', outward: 'blocks', name: 'Blocks' },
          outwardIssue: {
            key: 'PROJ-200',
            fields: { summary: 'Blocked one', status: { name: 'To Do' } },
          },
        },
        {
          id: '10502',
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
      { id: '10501', type: 'blocks', key: 'PROJ-200', title: 'Blocked one', status: 'To Do' },
      { id: '10502', type: 'relates to', key: 'PROJ-300', title: 'Related', status: 'Done' },
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

const CHANGELOG_WITH_MIXED_ITEMS = {
  changelog: {
    histories: [
      {
        id: '1',
        author: { displayName: 'Jane' },
        created: '2026-05-20T10:00:00.000+0200',
        items: [
          { field: 'status', fromString: 'To Do', toString: 'In Progress' },
          { field: 'assignee', fromString: null, toString: 'Jane' },
          { field: 'priority', fromString: 'Low', toString: 'High' },
        ],
      },
    ],
  },
};

describe('JiraClient.fetchIssueDetails — changelog / mergeHistory', () => {
  it('keeps only status_change entries when fullChangelog is false (default)', async () => {
    installFetchSequence([
      [],
      makeIssueResponse({}),
      { comments: [], total: 0, maxResults: 100, startAt: 0 },
      CHANGELOG_WITH_MIXED_ITEMS,
    ]);
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const task = await client.fetchIssueDetails('PROJ-1');
    expect(task.history).toEqual([
      {
        type: 'status_change',
        author: 'Jane',
        date: '2026-05-20T10:00:00.000+0200',
        content: 'To Do → In Progress',
      },
    ]);
  });

  it('adds field_change entries with .field set when fullChangelog is true', async () => {
    installFetchSequence([
      [],
      makeIssueResponse({}),
      { comments: [], total: 0, maxResults: 100, startAt: 0 },
      CHANGELOG_WITH_MIXED_ITEMS,
    ]);
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const task = await client.fetchIssueDetails('PROJ-1', { fullChangelog: true });
    expect(task.history).toEqual([
      {
        type: 'status_change',
        author: 'Jane',
        date: '2026-05-20T10:00:00.000+0200',
        content: 'To Do → In Progress',
      },
      {
        type: 'field_change',
        field: 'assignee',
        author: 'Jane',
        date: '2026-05-20T10:00:00.000+0200',
        content: 'assignee: None → Jane',
      },
      {
        type: 'field_change',
        field: 'priority',
        author: 'Jane',
        date: '2026-05-20T10:00:00.000+0200',
        content: 'priority: Low → High',
      },
    ]);
  });
});

describe('JiraClient.fetchIssueDetails — network gating', () => {
  function installUrlTracker(): { urls: string[] } {
    const urls: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      urls.push(url);
      let body: unknown;
      if (url.endsWith('/field')) body = [];
      else if (url.includes('expand=changelog')) body = { changelog: { histories: [] } };
      else if (url.includes('/comment')) body = { comments: [], total: 0, maxResults: 100, startAt: 0 };
      else if (url.includes('/worklog')) body = { worklogs: [], total: 0, maxResults: 100, startAt: 0 };
      else body = makeIssueResponse({});
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return { urls };
  }

  it('fetches comments and changelog by default', async () => {
    const { urls } = installUrlTracker();
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await client.fetchIssueDetails('PROJ-1');
    expect(urls.some((u) => u.includes('/comment'))).toBe(true);
    expect(urls.some((u) => u.includes('expand=changelog'))).toBe(true);
  });

  it('skips comment and changelog requests when explicitly disabled', async () => {
    const { urls } = installUrlTracker();
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const task = await client.fetchIssueDetails('PROJ-1', {
      includeComments: false,
      includeChangelog: false,
    });
    expect(urls.some((u) => u.includes('/comment'))).toBe(false);
    expect(urls.some((u) => u.includes('expand=changelog'))).toBe(false);
    expect(task.history).toEqual([]);
  });

  it('adds issuelinks to the fields query when includeLinks is set', async () => {
    const { urls } = installUrlTracker();
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await client.fetchIssueDetails('PROJ-1', { includeLinks: true });
    const issueCall = urls.find((u) => u.includes('/issue/PROJ-1?fields='));
    expect(issueCall).toContain('issuelinks');
  });

  it('populates task.worklogs when includeWorklog is set', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      let body: unknown;
      if (url.endsWith('/field')) body = [];
      else if (url.includes('expand=changelog')) body = { changelog: { histories: [] } };
      else if (url.includes('/comment')) body = { comments: [], total: 0, maxResults: 100, startAt: 0 };
      else if (url.includes('/worklog')) {
        body = {
          worklogs: [
            {
              author: { displayName: 'Bob' },
              started: '2026-05-21T09:00:00.000+0200',
              timeSpent: '2h',
            },
          ],
          total: 1,
          maxResults: 100,
          startAt: 0,
        };
      } else body = makeIssueResponse({});
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const task = await client.fetchIssueDetails('PROJ-1', { includeWorklog: true });
    expect(task.worklogs).toEqual([
      { author: 'Bob', started: '2026-05-21T09:00:00.000+0200', timeSpent: '2h' },
    ]);
  });

  it('leaves worklogs undefined when includeWorklog is not set', async () => {
    installUrlTracker();
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const task = await client.fetchIssueDetails('PROJ-1');
    expect(task.worklogs).toBeUndefined();
  });

  it('populates task.comments with full body when comments are included (default)', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      let body: unknown;
      if (url.endsWith('/field')) body = [];
      else if (url.includes('expand=changelog')) body = { changelog: { histories: [] } };
      else if (url.includes('/comment')) {
        body = {
          comments: [
            {
              id: 'c-1',
              author: { displayName: 'Alice' },
              created: '2026-05-20T10:00:00.000+0200',
              body: 'full comment body',
            },
          ],
          total: 1,
          maxResults: 100,
          startAt: 0,
        };
      } else body = makeIssueResponse({});
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
    expect(task.comments).toEqual([
      {
        id: 'c-1',
        author: 'Alice',
        created: '2026-05-20T10:00:00.000+0200',
        body: 'full comment body',
      },
    ]);
  });

  it('leaves comments undefined when includeComments is false', async () => {
    installUrlTracker();
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const task = await client.fetchIssueDetails('PROJ-1', { includeComments: false });
    expect(task.comments).toBeUndefined();
  });
});

describe('JiraClient.mergeHistory — comment identity', () => {
  it('carries comment id and author accountId onto comment history entries', async () => {
    installFetchSequence([
      [],
      makeIssueResponse({}),
      {
        comments: [
          {
            id: 'c-100',
            author: { displayName: 'Jane', accountId: 'acc-jane' },
            created: '2026-05-20T10:00:00.000+0200',
            body: 'hello',
          },
        ],
        total: 1,
        maxResults: 100,
        startAt: 0,
      },
      { changelog: { histories: [] } },
    ]);
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const task = await client.fetchIssueDetails('PROJ-1');
    expect(task.history).toEqual([
      {
        type: 'comment',
        author: 'Jane',
        date: '2026-05-20T10:00:00.000+0200',
        content: 'hello',
        id: 'c-100',
        authorAccountId: 'acc-jane',
      },
    ]);
  });
});

describe('JiraClient.getComment', () => {
  it('GETs a single comment by id', async () => {
    const comment = {
      id: 'c-7',
      author: { displayName: 'Bob', accountId: 'acc-bob' },
      created: '2026-05-20T10:00:00.000+0200',
      body: 'body',
    };
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return { ok: true, status: 200, statusText: 'OK', json: async () => comment } as unknown as Response;
      })
    );
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const result = await client.getComment('PROJ-1', 'c-7');
    expect(urls[0]).toContain('/rest/api/3/issue/PROJ-1/comment/c-7');
    expect(result.id).toBe('c-7');
    expect(result.author.accountId).toBe('acc-bob');
  });
});

function installErrorResponse(status: number, statusText: string, text: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      return {
        ok: false,
        status,
        statusText,
        text: async () => text,
      } as unknown as Response;
    })
  );
}

function doc(...content: unknown[]): unknown {
  return { version: 1, type: 'doc', content };
}

function paragraph(...content: unknown[]): unknown {
  return { type: 'paragraph', content };
}

function text(value: string, marks?: unknown[]): unknown {
  return marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
}

describe('JiraClient.convertADFToMarkdown', () => {
  const client = new JiraClient(FAKE_CONFIG, 'token');

  it('returns empty string for null/undefined content', () => {
    expect(client.convertADFToMarkdown(null)).toBe('');
    expect(client.convertADFToMarkdown(undefined)).toBe('');
  });

  it('returns plain string content unchanged', () => {
    expect(client.convertADFToMarkdown('already text')).toBe('already text');
  });

  it('applies inline marks (strong, em, code, strike, link)', () => {
    const out = client.convertADFToMarkdown(
      doc(
        paragraph(
          text('bold', [{ type: 'strong' }]),
          text(' '),
          text('italic', [{ type: 'em' }]),
          text(' '),
          text('mono', [{ type: 'code' }]),
          text(' '),
          text('gone', [{ type: 'strike' }]),
          text(' '),
          text('site', [{ type: 'link', attrs: { href: 'https://x.io' } }])
        )
      ) as never
    );
    expect(out).toBe('**bold** *italic* `mono` ~~gone~~ [site](https://x.io)\n');
  });

  it('renders headings with the given level', () => {
    const out = client.convertADFToMarkdown(
      doc({ type: 'heading', attrs: { level: 3 }, content: [text('Title')] }) as never
    );
    expect(out).toBe('### Title');
  });

  it('renders code blocks with language fence', () => {
    const out = client.convertADFToMarkdown(
      doc({
        type: 'codeBlock',
        attrs: { language: 'ts' },
        content: [text('const a = 1;')],
      }) as never
    );
    expect(out).toBe('```ts\nconst a = 1;\n```');
  });

  it('renders blockquotes with > prefixes per line', () => {
    const out = client.convertADFToMarkdown(
      doc({
        type: 'blockquote',
        content: [paragraph(text('line one')), paragraph(text('line two'))],
      }) as never
    );
    expect(out).toBe('> line one\n> line two');
  });

  it('renders bullet and ordered lists', () => {
    const bullet = client.convertADFToMarkdown(
      doc({
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [paragraph(text('a'))] },
          { type: 'listItem', content: [paragraph(text('b'))] },
        ],
      }) as never
    );
    expect(bullet).toBe('- a\n- b');

    const ordered = client.convertADFToMarkdown(
      doc({
        type: 'orderedList',
        content: [
          { type: 'listItem', content: [paragraph(text('first'))] },
          { type: 'listItem', content: [paragraph(text('second'))] },
        ],
      }) as never
    );
    expect(ordered).toBe('1. first\n2. second');
  });

  it('renders task items with checked/unchecked boxes', () => {
    const out = client.convertADFToMarkdown(
      doc({
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { state: 'DONE' }, content: [text('done thing')] },
          { type: 'taskItem', attrs: { state: 'TODO' }, content: [text('todo thing')] },
        ],
      }) as never
    );
    expect(out).toBe('- [x] done thing\n- [ ] todo thing');
  });

  it('renders tables with header, separator, and body rows', () => {
    const cell = (value: string) => ({ type: 'tableCell', content: [paragraph(text(value))] });
    const out = client.convertADFToMarkdown(
      doc({
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('H1'), cell('H2')] },
          { type: 'tableRow', content: [cell('a'), cell('b')] },
        ],
      }) as never
    );
    expect(out).toBe('| H1 | H2 |\n| --- | --- |\n| a | b |');
  });

  it('renders rule and hardBreak nodes', () => {
    expect(client.convertADFToMarkdown(doc({ type: 'rule' }) as never)).toBe('---');
    const withBreak = client.convertADFToMarkdown(
      doc(paragraph(text('a'), { type: 'hardBreak' }, text('b'))) as never
    );
    expect(withBreak).toBe('a\nb\n');
  });

  it('links matched media by alt to the attachment path (image vs file)', () => {
    const image = client.convertADFToMarkdown(
      doc(paragraph({ type: 'media', attrs: { alt: 'shot.png' } })) as never,
      [{ id: '1', filename: 'shot.png' }]
    );
    expect(image).toBe('![image](attachments/shot.png)\n');

    const file = client.convertADFToMarkdown(
      doc(paragraph({ type: 'media', attrs: { alt: 'doc.pdf' } })) as never,
      [{ id: '2', filename: 'doc.pdf' }]
    );
    expect(file).toBe('[doc.pdf](attachments/doc.pdf)\n');
  });

  it('falls back to unmatched attachments for media without a matching alt', () => {
    const out = client.convertADFToMarkdown(
      doc(paragraph({ type: 'media', attrs: { alt: 'unknown.png' } })) as never,
      [{ id: '9', filename: 'real.png' }]
    );
    expect(out).toBe('![image](attachments/real.png)\n');
  });

  it('shows a visible marker for wiki-embedded media (id only, no alt, no attachments)', () => {
    const out = client.convertADFToMarkdown(
      doc(paragraph({ type: 'media', attrs: { id: 'b5739fcc-uuid', type: 'file' } })) as never
    );
    expect(out).toBe('![embedded media](media/b5739fcc-uuid)\n');
  });

  it('resolves inlineCard urls to attachment links when the id matches', () => {
    const out = client.convertADFToMarkdown(
      doc(
        paragraph({
          type: 'inlineCard',
          attrs: { url: 'https://x/attachment/content/555' },
        })
      ) as never,
      [{ id: '555', filename: 'card.txt', url: 'https://x/rest/api/3/attachment/content/555' }]
    );
    expect(out).toBe('[card.txt](attachments/card.txt)\n');
  });

  it('keeps the raw url for an inlineCard with no matching attachment', () => {
    const out = client.convertADFToMarkdown(
      doc(paragraph({ type: 'inlineCard', attrs: { url: 'https://example.com/page' } })) as never
    );
    expect(out).toBe('https://example.com/page\n');
  });
});

describe('JiraClient.getCurrentUser', () => {
  it('GETs /myself and returns the account identity', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ accountId: 'me-1', displayName: 'Me', emailAddress: 'me@x.io' }),
        } as unknown as Response;
      })
    );
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const user = await client.getCurrentUser();
    expect(urls[0]).toContain('/rest/api/3/myself');
    expect(user).toEqual({ accountId: 'me-1', displayName: 'Me', emailAddress: 'me@x.io' });
  });

  it('throws a descriptive error when the request fails', async () => {
    installErrorResponse(401, 'Unauthorized', 'bad token');
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await expect(client.getCurrentUser()).rejects.toThrow(
      /Jira API request failed: 401 Unauthorized\nbad token/
    );
  });
});

describe('JiraClient.fetchIssueComments', () => {
  it('paginates until startAt reaches total and concatenates comments', async () => {
    installFetchSequence([
      {
        comments: [
          { id: 'c1', author: { displayName: 'A' }, created: '2026-01-01', body: 'one' },
          { id: 'c2', author: { displayName: 'B' }, created: '2026-01-02', body: 'two' },
        ],
        total: 3,
        startAt: 0,
        maxResults: 2,
      },
      {
        comments: [{ id: 'c3', author: { displayName: 'C' }, created: '2026-01-03', body: 'three' }],
        total: 3,
        startAt: 2,
        maxResults: 2,
      },
    ]);
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const comments = await client.fetchIssueComments('PROJ-1');
    expect(comments.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('returns an empty array when there are no comments', async () => {
    installFetchSequence([{ comments: [], total: 0, startAt: 0, maxResults: 100 }]);
    const client = new JiraClient(FAKE_CONFIG, 'token');
    expect(await client.fetchIssueComments('PROJ-1')).toEqual([]);
  });
});

describe('JiraClient.fetchIssueChangelog', () => {
  it('unwraps changelog.histories from the expanded issue', async () => {
    const histories = [
      { id: 'h1', author: { displayName: 'Jane' }, created: '2026-01-01', items: [] },
    ];
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ changelog: { histories } }),
        } as unknown as Response;
      })
    );
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const result = await client.fetchIssueChangelog('PROJ-1');
    expect(urls[0]).toContain('/issue/PROJ-1?expand=changelog&fields=none');
    expect(result).toEqual(histories);
  });
});

describe('JiraClient.fetchIssueSubtasks', () => {
  it('POSTs a parent JQL and maps issues to subtask summaries', async () => {
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            issues: [
              { key: 'PROJ-2', fields: { summary: 'Sub A', status: { name: 'To Do' } } },
              { key: 'PROJ-3', fields: { summary: 'Sub B' } },
            ],
          }),
        } as unknown as Response;
      })
    );
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const subtasks = await client.fetchIssueSubtasks('PROJ-1');
    expect(calls[0].url).toContain('/search/jql');
    expect(JSON.parse(calls[0].body!).jql).toBe('parent = PROJ-1 ORDER BY key ASC');
    expect(subtasks).toEqual([
      { key: 'PROJ-2', title: 'Sub A', status: 'To Do' },
      { key: 'PROJ-3', title: 'Sub B', status: 'Unknown' },
    ]);
  });

  it('returns an empty array and warns when the request fails', async () => {
    installErrorResponse(500, 'Server Error', 'boom');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const subtasks = await client.fetchIssueSubtasks('PROJ-1');
    expect(subtasks).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch subtasks for PROJ-1'));
    warn.mockRestore();
  });
});

describe('JiraClient.searchByJql', () => {
  it('follows nextPageToken until isLast and accumulates issues', async () => {
    const bodies: unknown[] = [];
    installFetchSequenceWithBodies(
      [
        { issues: [{ key: 'PROJ-1', fields: {} }], nextPageToken: 'p2', isLast: false },
        { issues: [{ key: 'PROJ-2', fields: {} }], isLast: true },
      ],
      bodies
    );
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const issues = await client.searchByJql('project = PROJ');
    expect(issues.map((i) => i.key)).toEqual(['PROJ-1', 'PROJ-2']);
    expect((bodies[0] as { nextPageToken?: string }).nextPageToken).toBeUndefined();
    expect((bodies[1] as { nextPageToken?: string }).nextPageToken).toBe('p2');
  });

  it('stops after a single page when isLast is not false', async () => {
    const bodies: unknown[] = [];
    installFetchSequenceWithBodies([{ issues: [{ key: 'PROJ-9', fields: {} }] }], bodies);
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const issues = await client.searchByJql('x', ['summary']);
    expect(issues).toHaveLength(1);
    expect((bodies[0] as { fields: string[] }).fields).toEqual(['summary']);
  });
});

function installFetchSequenceWithBodies(responses: unknown[], bodies: unknown[]): void {
  const queue = [...responses];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body));
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

describe('JiraClient.fetchIssueWorklogs', () => {
  it('paginates and maps author/started/timeSpent/comment', async () => {
    const pages = [
      {
        worklogs: [
          {
            author: { displayName: 'Alice' },
            started: '2026-05-20T10:00:00.000+0200',
            timeSpent: '1h',
            comment: 'first log',
          },
          {
            author: { displayName: 'Bob' },
            started: '2026-05-20T11:00:00.000+0200',
            timeSpent: '30m',
          },
        ],
        total: 3,
        startAt: 0,
        maxResults: 2,
      },
      {
        worklogs: [
          {
            author: { displayName: 'Carol' },
            started: '2026-05-20T12:00:00.000+0200',
            timeSpent: '45m',
            comment: {
              version: 1,
              type: 'doc',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'adf comment' }] },
              ],
            },
          },
        ],
        total: 3,
        startAt: 2,
        maxResults: 2,
      },
    ];
    installFetchSequence([...pages]);
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const worklogs = await client.fetchIssueWorklogs('PROJ-1');
    expect(worklogs).toEqual([
      {
        author: 'Alice',
        started: '2026-05-20T10:00:00.000+0200',
        timeSpent: '1h',
        comment: 'first log',
      },
      { author: 'Bob', started: '2026-05-20T11:00:00.000+0200', timeSpent: '30m' },
      {
        author: 'Carol',
        started: '2026-05-20T12:00:00.000+0200',
        timeSpent: '45m',
        comment: 'adf comment\n',
      },
    ]);
  });
});
