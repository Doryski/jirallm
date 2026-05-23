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
