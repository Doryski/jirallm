import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JiraClient } from './jiraClient.js';

const FAKE_CONFIG = {
  baseUrl: 'https://example.atlassian.net',
  projectKey: 'PROJ',
  userEmail: 'user@example.com',
};

type CapturedCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
};

function captureFetch(handler: (url: string) => unknown): {
  client: JiraClient;
  calls: CapturedCall[];
} {
  const calls: CapturedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : undefined;
      calls.push({
        url,
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body,
      });
      const payload = handler(url);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => payload,
      } as unknown as Response;
    })
  );
  return { client: new JiraClient(FAKE_CONFIG, 'token'), calls };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('JiraClient.searchIssues', () => {
  it('POSTs to /search/jql with JQL, fields, and limit', async () => {
    const { client, calls } = captureFetch(() => ({
      issues: [{ key: 'PROJ-1', fields: { summary: 'one' } }],
      isLast: true,
    }));

    const page = await client.searchIssues('project = PROJ', {
      fields: ['summary', 'status'],
      limit: 25,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/rest/api/3/search/jql');
    const body = JSON.parse(calls[0].body!);
    expect(body).toEqual({
      jql: 'project = PROJ',
      fields: ['summary', 'status'],
      maxResults: 25,
    });
    expect(page.issues).toHaveLength(1);
    expect(page.isLast).toBe(true);
  });

  it('forwards nextPageToken in body when provided', async () => {
    const { client, calls } = captureFetch(() => ({
      issues: [],
      nextPageToken: 'abc',
      isLast: false,
    }));
    const page = await client.searchIssues('x', { nextPageToken: 'prev-token' });
    const body = JSON.parse(calls[0].body!);
    expect(body.nextPageToken).toBe('prev-token');
    expect(page.nextPageToken).toBe('abc');
    expect(page.isLast).toBe(false);
  });

  it('defaults fields and limit when not provided', async () => {
    const { client, calls } = captureFetch(() => ({ issues: [], isLast: true }));
    await client.searchIssues('x');
    const body = JSON.parse(calls[0].body!);
    expect(body.fields).toEqual(['summary', 'status', 'assignee', 'issuetype']);
    expect(body.maxResults).toBe(50);
    expect(body.nextPageToken).toBeUndefined();
  });

  it('treats response.isLast === undefined as isLast: true', async () => {
    const { client } = captureFetch(() => ({ issues: [] }));
    const page = await client.searchIssues('x');
    expect(page.isLast).toBe(true);
  });
});

describe('JiraClient.listProjects', () => {
  it('GETs /project/search with query and pagination params', async () => {
    const { client, calls } = captureFetch(() => ({
      values: [{ id: '1', key: 'PROJ', name: 'Proj' }],
      startAt: 0,
      maxResults: 50,
      isLast: true,
    }));
    const result = await client.listProjects({ query: 'pro', limit: 10, startAt: 5 });
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toContain('/rest/api/3/project/search?');
    expect(calls[0].url).toContain('query=pro');
    expect(calls[0].url).toContain('maxResults=10');
    expect(calls[0].url).toContain('startAt=5');
    expect(result.values[0].key).toBe('PROJ');
  });

  it('omits query string when no opts provided', async () => {
    const { client, calls } = captureFetch(() => ({
      values: [],
      startAt: 0,
      maxResults: 50,
      isLast: true,
    }));
    await client.listProjects();
    expect(calls[0].url).toBe('https://example.atlassian.net/rest/api/3/project/search');
  });
});

describe('JiraClient.listBoards', () => {
  it('GETs /rest/agile/1.0/board with projectKey/type/name filters', async () => {
    const { client, calls } = captureFetch(() => ({
      values: [{ id: 7, name: 'Board', type: 'scrum' }],
      startAt: 0,
      maxResults: 50,
      isLast: true,
    }));
    await client.listBoards({ projectKey: 'PROJ', type: 'scrum', name: 'My' });
    expect(calls[0].url).toContain('/rest/agile/1.0/board?');
    expect(calls[0].url).toContain('projectKeyOrId=PROJ');
    expect(calls[0].url).toContain('type=scrum');
    expect(calls[0].url).toContain('name=My');
  });
});

describe('JiraClient.listSprints', () => {
  it('GETs /rest/agile/1.0/board/{id}/sprint with state filter', async () => {
    const { client, calls } = captureFetch(() => ({
      values: [{ id: 99, name: 'Sprint 99', state: 'active', self: 'x' }],
      startAt: 0,
      maxResults: 50,
      isLast: true,
    }));
    const page = await client.listSprints(42, { state: 'active', limit: 5 });
    expect(calls[0].url).toContain('/rest/agile/1.0/board/42/sprint?');
    expect(calls[0].url).toContain('state=active');
    expect(calls[0].url).toContain('maxResults=5');
    expect(page.values[0].id).toBe(99);
  });

  it('omits query string when no opts provided', async () => {
    const { client, calls } = captureFetch(() => ({
      values: [],
      startAt: 0,
      maxResults: 50,
      isLast: true,
    }));
    await client.listSprints(42);
    expect(calls[0].url).toBe('https://example.atlassian.net/rest/agile/1.0/board/42/sprint');
  });
});

describe('JiraClient.listIssueTypes', () => {
  it('GETs /issuetype when no project supplied', async () => {
    const { client, calls } = captureFetch(() => [
      { id: '1', name: 'Task', subtask: false },
    ]);
    const types = await client.listIssueTypes();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/rest/api/3/issuetype');
    expect(calls[0].url).not.toContain('project');
    expect(types[0].name).toBe('Task');
  });

  it('resolves projectId then queries /issuetype/project when project supplied', async () => {
    const { client, calls } = captureFetch((url) => {
      if (url.endsWith('/project/PROJ')) return { id: '10000' };
      return [{ id: '1', name: 'Bug', subtask: false }];
    });
    const types = await client.listIssueTypes('PROJ');
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('/rest/api/3/project/PROJ');
    expect(calls[1].url).toContain('/rest/api/3/issuetype/project?projectId=10000');
    expect(types[0].name).toBe('Bug');
  });
});

describe('JiraClient.listLinkTypes', () => {
  it('unwraps the issueLinkTypes envelope', async () => {
    const { client } = captureFetch(() => ({
      issueLinkTypes: [
        { id: '1', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
      ],
    }));
    const types = await client.listLinkTypes();
    expect(types).toEqual([
      { id: '1', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
    ]);
  });
});

describe('JiraClient.listPriorities', () => {
  it('GETs /priority', async () => {
    const { client, calls } = captureFetch(() => [{ id: '3', name: 'Medium' }]);
    const out = await client.listPriorities();
    expect(calls[0].url).toContain('/rest/api/3/priority');
    expect(out[0].name).toBe('Medium');
  });
});

describe('JiraClient.searchAssignableUsers', () => {
  it('GETs /user/assignable/search with query, issueKey and maxResults', async () => {
    const { client, calls } = captureFetch(() => [
      { accountId: 'a1', displayName: 'Alice', emailAddress: 'alice@x.com' },
    ]);
    const users = await client.searchAssignableUsers({
      query: 'ali',
      issueKey: 'PROJ-1',
      maxResults: 10,
    });
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toContain('/rest/api/3/user/assignable/search?');
    expect(calls[0].url).toContain('query=ali');
    expect(calls[0].url).toContain('issueKey=PROJ-1');
    expect(calls[0].url).toContain('maxResults=10');
    expect(users[0].accountId).toBe('a1');
  });

  it('passes project instead of issueKey and defaults maxResults', async () => {
    const { client, calls } = captureFetch(() => []);
    await client.searchAssignableUsers({ query: 'bob', project: 'PROJ' });
    expect(calls[0].url).toContain('project=PROJ');
    expect(calls[0].url).toContain('maxResults=50');
    expect(calls[0].url).not.toContain('issueKey');
  });
});

describe('JiraClient.searchUsers', () => {
  it('GETs /user/search with query and maxResults', async () => {
    const { client, calls } = captureFetch(() => [
      { accountId: 'a2', displayName: 'Bob' },
    ]);
    const users = await client.searchUsers('bob', 5);
    expect(calls[0].url).toContain('/rest/api/3/user/search?');
    expect(calls[0].url).toContain('query=bob');
    expect(calls[0].url).toContain('maxResults=5');
    expect(users[0].displayName).toBe('Bob');
  });
});

describe('JiraClient.findBoardByName', () => {
  it('matches board name case-insensitively', async () => {
    const { client } = captureFetch(() => ({
      values: [
        { id: 1, name: 'Alpha Board', type: 'scrum' },
        { id: 2, name: 'Beta Board', type: 'kanban' },
      ],
    }));
    const board = await client.findBoardByName('beta board');
    expect(board.id).toBe(2);
  });
});

describe('JiraClient.getBoardColumnStatusIds', () => {
  it('matches column name case-insensitively', async () => {
    const { client } = captureFetch((url) => {
      if (url.includes('/board/1/configuration')) {
        return {
          columnConfig: {
            columns: [
              { name: 'To Do', statuses: [{ id: '10', self: 'x' }] },
              { name: 'In Progress', statuses: [{ id: '20', self: 'x' }] },
            ],
          },
        };
      }
      return { values: [{ id: 1, name: 'Board', type: 'scrum' }] };
    });
    const ids = await client.getBoardColumnStatusIds('Board', 'in progress');
    expect(ids).toEqual(['20']);
  });
});

describe('JiraClient.getBoardColumnNames', () => {
  it('returns the ordered list of column names', async () => {
    const { client } = captureFetch((url) => {
      if (url.includes('/board/1/configuration')) {
        return {
          columnConfig: {
            columns: [
              { name: 'To Do', statuses: [] },
              { name: 'In Progress', statuses: [] },
              { name: 'Done', statuses: [] },
            ],
          },
        };
      }
      return { values: [{ id: 1, name: 'Board', type: 'scrum' }] };
    });
    const names = await client.getBoardColumnNames('Board');
    expect(names).toEqual(['To Do', 'In Progress', 'Done']);
  });
});

function installError(status: number, statusText: string, text: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      return { ok: false, status, statusText, text: async () => text } as unknown as Response;
    })
  );
}

describe('JiraClient.findBoardByName — resolution branches', () => {
  it('returns the sole result when there is exactly one non-exact match', async () => {
    const { client } = captureFetch(() => ({
      values: [{ id: 5, name: 'The Only Board', type: 'scrum' }],
    }));
    const board = await client.findBoardByName('only');
    expect(board.id).toBe(5);
  });

  it('throws when no board matches', async () => {
    const { client } = captureFetch(() => ({ values: [] }));
    await expect(client.findBoardByName('nope')).rejects.toThrow(/No board found matching "nope"/);
  });

  it('throws listing candidates when multiple boards match without an exact name', async () => {
    const { client } = captureFetch(() => ({
      values: [
        { id: 1, name: 'Team Alpha', type: 'scrum' },
        { id: 2, name: 'Team Beta', type: 'kanban' },
      ],
    }));
    await expect(client.findBoardByName('team')).rejects.toThrow(
      /Multiple boards matched "team": Team Alpha, Team Beta/
    );
  });
});

describe('JiraClient.getBoardColumnStatusIds — missing column', () => {
  it('throws with the available column names when the column is absent', async () => {
    const { client } = captureFetch((url) => {
      if (url.includes('/board/1/configuration')) {
        return {
          columnConfig: {
            columns: [
              { name: 'To Do', statuses: [{ id: '10', self: 'x' }] },
              { name: 'Done', statuses: [{ id: '30', self: 'x' }] },
            ],
          },
        };
      }
      return { values: [{ id: 1, name: 'Board', type: 'scrum' }] };
    });
    await expect(client.getBoardColumnStatusIds('Board', 'Review')).rejects.toThrow(
      /Column "Review" not found on board "Board"\. Available: To Do, Done/
    );
  });
});

describe('JiraClient.searchByJql', () => {
  it('sends default fields and accumulates a single page', async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body));
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ issues: [{ key: 'PROJ-1', fields: {} }], isLast: true }),
        } as unknown as Response;
      })
    );
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const issues = await client.searchByJql('project = PROJ');
    expect(issues).toHaveLength(1);
    expect((bodies[0] as { fields: string[] }).fields).toEqual([
      'summary',
      'status',
      'assignee',
      'issuetype',
    ]);
  });
});

describe('JiraClient — request error propagation', () => {
  it('makeRequest surfaces status, statusText and body on non-2xx (listProjects)', async () => {
    installError(500, 'Internal Server Error', 'kaboom');
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await expect(client.listProjects()).rejects.toThrow(
      /Jira API request failed: 500 Internal Server Error\nkaboom/
    );
  });

  it('makeAgileRequest surfaces the agile error prefix on non-2xx (listBoards)', async () => {
    installError(403, 'Forbidden', 'no agile access');
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await expect(client.listBoards()).rejects.toThrow(
      /Jira Agile API request failed: 403 Forbidden\nno agile access/
    );
  });
});

describe('JiraClient.listStatuses', () => {
  it('GETs /status when no project provided', async () => {
    const { client, calls } = captureFetch(() => [{ id: '1', name: 'Open' }]);
    const out = await client.listStatuses();
    expect(calls[0].url).toContain('/rest/api/3/status');
    expect(out[0].name).toBe('Open');
  });

  it('deduplicates statuses across issue types when project provided', async () => {
    const { client, calls } = captureFetch(() => [
      { statuses: [{ id: '1', name: 'Open' }, { id: '2', name: 'Done' }] },
      { statuses: [{ id: '1', name: 'Open' }, { id: '3', name: 'In Progress' }] },
    ]);
    const out = await client.listStatuses('PROJ');
    expect(calls[0].url).toContain('/rest/api/3/project/PROJ/statuses');
    const ids = out.map((s) => s.id).sort();
    expect(ids).toEqual(['1', '2', '3']);
  });
});
