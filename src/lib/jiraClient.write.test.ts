import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  body: unknown;
  rawBody: BodyInit | null | undefined;
};

function captureFetch(
  handler: (url: string, init?: RequestInit) => {
    ok?: boolean;
    status?: number;
    statusText?: string;
    json?: unknown;
    text?: string;
  } = () => ({ json: {} })
): { client: JiraClient; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const raw = init?.body;
      let parsed: unknown;
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
      } else {
        parsed = raw;
      }
      calls.push({
        url,
        method: init?.method ?? 'GET',
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: parsed,
        rawBody: raw,
      });
      const res = handler(url, init);
      return {
        ok: res.ok ?? true,
        status: res.status ?? 200,
        statusText: res.statusText ?? 'OK',
        json: async () => res.json ?? {},
        text: async () => res.text ?? '',
      } as unknown as Response;
    })
  );
  return { client: new JiraClient(FAKE_CONFIG, 'token'), calls };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('JiraClient.createIssue', () => {
  it('POSTs /rest/api/2/issue with mapped fields and converts markdown→wiki', async () => {
    const { client, calls } = captureFetch(() => ({
      json: { id: '10100', key: 'PROJ-99', self: 'https://x/rest/api/2/issue/10100' },
    }));

    const result = await client.createIssue({
      projectKey: 'PROJ',
      issueType: 'Bug',
      summary: 'Crash',
      descriptionMarkdown: '**bold** text',
      assigneeAccountId: 'acc-1',
      labels: ['urgent'],
      priority: 'High',
      parentKey: 'PROJ-1',
    });

    expect(result.key).toBe('PROJ-99');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://example.atlassian.net/rest/api/2/issue');
    const body = calls[0].body as { fields: Record<string, unknown> };
    expect(body.fields.project).toEqual({ key: 'PROJ' });
    expect(body.fields.issuetype).toEqual({ name: 'Bug' });
    expect(body.fields.summary).toBe('Crash');
    expect(body.fields.assignee).toEqual({ accountId: 'acc-1' });
    expect(body.fields.labels).toEqual(['urgent']);
    expect(body.fields.priority).toEqual({ name: 'High' });
    expect(body.fields.parent).toEqual({ key: 'PROJ-1' });
    // Markdown → Jira wiki: **x** becomes *x*
    expect(body.fields.description).toBe('*bold* text');
  });

  it('sends the description as-is when noWiki is set', async () => {
    const { client, calls } = captureFetch(() => ({
      json: { id: '1', key: 'PROJ-1', self: 'x' },
    }));
    await client.createIssue({
      projectKey: 'PROJ',
      issueType: 'Task',
      summary: 's',
      descriptionMarkdown: 'h2. Heading\n# ordered item',
      noWiki: true,
    });
    const body = calls[0].body as { fields: Record<string, unknown> };
    expect(body.fields.description).toBe('h2. Heading\n# ordered item');
  });

  it('omits optional fields when not provided', async () => {
    const { client, calls } = captureFetch(() => ({
      json: { id: '1', key: 'PROJ-1', self: 'x' },
    }));
    await client.createIssue({
      projectKey: 'PROJ',
      issueType: 'Task',
      summary: 'minimal',
    });
    const body = calls[0].body as { fields: Record<string, unknown> };
    expect(body.fields).toEqual({
      project: { key: 'PROJ' },
      issuetype: { name: 'Task' },
      summary: 'minimal',
    });
  });

  it('maps components to [{ name }] and spreads pre-shaped customFields', async () => {
    const { client, calls } = captureFetch(() => ({
      json: { id: '1', key: 'PROJ-1', self: 'x' },
    }));
    await client.createIssue({
      projectKey: 'PROJ',
      issueType: 'Bug',
      summary: 's',
      components: ['Web', 'API'],
      customFields: { customfield_10050: { value: 'High' } },
    });
    const body = calls[0].body as { fields: Record<string, unknown> };
    expect(body.fields.components).toEqual([{ name: 'Web' }, { name: 'API' }]);
    expect(body.fields.customfield_10050).toEqual({ value: 'High' });
  });

  it('throws a descriptive error when Jira returns non-OK', async () => {
    const { client } = captureFetch(() => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: 'project required',
    }));
    await expect(
      client.createIssue({ projectKey: 'PROJ', issueType: 'Bug', summary: 's' })
    ).rejects.toThrow(/createIssue failed: 400 Bad Request/);
  });
});

describe('JiraClient.editIssue', () => {
  it('PUTs /rest/api/2/issue/{key} with only provided fields', async () => {
    const { client, calls } = captureFetch(() => ({ status: 204 }));
    await client.editIssue('PROJ-1', {
      summary: 'new title',
      labels: ['a'],
    });
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toBe('https://example.atlassian.net/rest/api/2/issue/PROJ-1');
    const body = calls[0].body as { fields: Record<string, unknown> };
    expect(body.fields).toEqual({ summary: 'new title', labels: ['a'] });
  });

  it('passes assignee=null to unassign', async () => {
    const { client, calls } = captureFetch(() => ({ status: 204 }));
    await client.editIssue('PROJ-1', { assigneeAccountId: null });
    const body = calls[0].body as { fields: Record<string, unknown> };
    expect(body.fields).toEqual({ assignee: null });
  });

  it('wraps assignee accountId in object form', async () => {
    const { client, calls } = captureFetch(() => ({ status: 204 }));
    await client.editIssue('PROJ-1', { assigneeAccountId: 'acc-99' });
    const body = calls[0].body as { fields: Record<string, unknown> };
    expect(body.fields).toEqual({ assignee: { accountId: 'acc-99' } });
  });

  it('converts markdown description to wiki', async () => {
    const { client, calls } = captureFetch(() => ({ status: 204 }));
    await client.editIssue('PROJ-1', { descriptionMarkdown: '_italic_' });
    const body = calls[0].body as { fields: Record<string, unknown> };
    expect(body.fields.description).toBe('_italic_');
  });

  it('sends the description as-is when noWiki is set', async () => {
    const { client, calls } = captureFetch(() => ({ status: 204 }));
    await client.editIssue('PROJ-1', {
      descriptionMarkdown: 'h2. Heading\n# ordered item',
      noWiki: true,
    });
    const body = calls[0].body as { fields: Record<string, unknown> };
    expect(body.fields.description).toBe('h2. Heading\n# ordered item');
  });

  it('maps components and customFields on edit', async () => {
    const { client, calls } = captureFetch(() => ({ status: 204 }));
    await client.editIssue('PROJ-1', {
      components: ['Web'],
      customFields: { customfield_10051: { value: 'Always' } },
    });
    const body = calls[0].body as { fields: Record<string, unknown> };
    expect(body.fields.components).toEqual([{ name: 'Web' }]);
    expect(body.fields.customfield_10051).toEqual({ value: 'Always' });
  });

  it('maps parentKey and dueDate on edit', async () => {
    const { client, calls } = captureFetch(() => ({ status: 204 }));
    await client.editIssue('PROJ-1', { parentKey: 'PROJ-9', dueDate: '2026-08-01' });
    const body = calls[0].body as { fields: Record<string, unknown> };
    expect(body.fields.parent).toEqual({ key: 'PROJ-9' });
    expect(body.fields.duedate).toBe('2026-08-01');
  });

  it('treats customFields/components as updatable fields (not "no fields")', async () => {
    const { client, calls } = captureFetch(() => ({ status: 204 }));
    await client.editIssue('PROJ-1', { customFields: { customfield_10051: 1 } });
    expect(calls[0].method).toBe('PUT');
  });

  it('throws when called with no fields', async () => {
    const { client } = captureFetch(() => ({ status: 204 }));
    await expect(client.editIssue('PROJ-1', {})).rejects.toThrow(/no fields/);
  });
});

describe('JiraClient.listComponents', () => {
  it('GETs /project/{key}/components', async () => {
    const { client, calls } = captureFetch(() => ({
      json: [{ id: '1', name: 'Web' }],
    }));
    const result = await client.listComponents('PROJ');
    expect(calls[0].url).toContain('/rest/api/3/project/PROJ/components');
    expect(result).toEqual([{ id: '1', name: 'Web' }]);
  });
});

describe('JiraClient.getCreateFields', () => {
  it('resolves the issue type id then returns flattened fields with allowed values', async () => {
    const { client, calls } = captureFetch((url) => {
      if (url.includes('/issuetype/project')) {
        return { json: [{ id: '10001', name: 'Bug', subtask: false }] };
      }
      if (url.endsWith('/project/PROJ')) {
        return { json: { id: '900' } };
      }
      if (url.includes('/issue/createmeta/')) {
        return {
          json: {
            fields: [
              {
                fieldId: 'customfield_10050',
                name: 'Severity',
                required: true,
                schema: { type: 'option' },
                allowedValues: [{ value: 'High' }, { value: 'Low' }],
              },
            ],
          },
        };
      }
      return { json: [] };
    });
    const fields = await client.getCreateFields('PROJ', 'bug');
    expect(calls.some((c) => c.url.includes('/issue/createmeta/PROJ/issuetypes/10001'))).toBe(true);
    expect(fields).toEqual([
      {
        fieldId: 'customfield_10050',
        name: 'Severity',
        required: true,
        schemaType: 'option',
        allowedValues: ['High', 'Low'],
      },
    ]);
  });

  it('throws when the issue type is not found', async () => {
    const { client } = captureFetch((url) => {
      if (url.includes('/issuetype/project')) {
        return { json: [{ id: '1', name: 'Task', subtask: false }] };
      }
      if (url.endsWith('/project/PROJ')) return { json: { id: '900' } };
      return { json: [] };
    });
    await expect(client.getCreateFields('PROJ', 'Bug')).rejects.toThrow(/not found/);
  });
});

describe('JiraClient.assignIssue', () => {
  it('PUTs /rest/api/3/issue/{key}/assignee with accountId payload', async () => {
    const { client, calls } = captureFetch(() => ({ status: 204 }));
    await client.assignIssue('PROJ-1', 'acc-7');
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toContain('/rest/api/3/issue/PROJ-1/assignee');
    expect(calls[0].body).toEqual({ accountId: 'acc-7' });
  });

  it('sends accountId=null to unassign', async () => {
    const { client, calls } = captureFetch(() => ({ status: 204 }));
    await client.assignIssue('PROJ-1', null);
    expect(calls[0].body).toEqual({ accountId: null });
  });
});

describe('JiraClient.linkIssues', () => {
  it('POSTs /issueLink with type + inward + outward', async () => {
    const { client, calls } = captureFetch(() => ({ status: 201 }));
    await client.linkIssues('PROJ-1', 'PROJ-2', 'Blocks');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/rest/api/3/issueLink');
    expect(calls[0].body).toEqual({
      type: { name: 'Blocks' },
      inwardIssue: { key: 'PROJ-1' },
      outwardIssue: { key: 'PROJ-2' },
    });
  });

  it('attaches wiki-converted comment when supplied', async () => {
    const { client, calls } = captureFetch(() => ({ status: 201 }));
    await client.linkIssues('PROJ-1', 'PROJ-2', 'Blocks', '**why**');
    const body = calls[0].body as { comment?: { body: string } };
    expect(body.comment?.body).toBe('*why*');
  });
});

describe('JiraClient.removeIssueLink', () => {
  it('DELETEs /issueLink/{id}', async () => {
    const { client, calls } = captureFetch(() => ({ status: 204 }));
    await client.removeIssueLink('10001');
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toContain('/rest/api/3/issueLink/10001');
  });
});

describe('JiraClient.listWatchers', () => {
  it('unwraps the watchers envelope', async () => {
    const { client, calls } = captureFetch(() => ({
      json: {
        watchers: [
          { accountId: 'a1', displayName: 'Alice' },
          { accountId: 'a2', displayName: 'Bob' },
        ],
      },
    }));
    const watchers = await client.listWatchers('PROJ-1');
    expect(calls[0].url).toContain('/rest/api/3/issue/PROJ-1/watchers');
    expect(watchers).toHaveLength(2);
    expect(watchers[0].accountId).toBe('a1');
  });
});

describe('JiraClient.addWatcher', () => {
  it('sends the accountId as a JSON-encoded string (Jira quirk)', async () => {
    const { client, calls } = captureFetch(() => ({ status: 204 }));
    await client.addWatcher('PROJ-1', 'acc-42');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/rest/api/3/issue/PROJ-1/watchers');
    // Body must be a JSON string literal (quoted), not an object — Jira requirement
    expect(calls[0].rawBody).toBe('"acc-42"');
    expect(calls[0].body).toBe('acc-42');
  });
});

describe('JiraClient.removeWatcher', () => {
  it('DELETEs with URL-encoded accountId in querystring', async () => {
    const { client, calls } = captureFetch(() => ({ status: 204 }));
    await client.removeWatcher('PROJ-1', 'acc with space');
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toContain('/rest/api/3/issue/PROJ-1/watchers?accountId=acc%20with%20space');
  });
});

describe('JiraClient.uploadAttachment', () => {
  let tmpDir: string;
  let filePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'jirallm-attach-'));
    filePath = join(tmpDir, 'hello.txt');
    await writeFile(filePath, 'hello world');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('POSTs multipart with X-Atlassian-Token: no-check', async () => {
    const { client, calls } = captureFetch(() => ({
      json: [{ id: 'att-1', filename: 'hello.txt', size: 11 }],
    }));
    const result = await client.uploadAttachment('PROJ-1', filePath);
    expect(result).toEqual([{ id: 'att-1', filename: 'hello.txt', size: 11 }]);
    const call = calls[0];
    expect(call.method).toBe('POST');
    expect(call.url).toContain('/rest/api/3/issue/PROJ-1/attachments');
    expect(call.headers['X-Atlassian-Token']).toBe('no-check');
    expect(call.rawBody).toBeInstanceOf(FormData);
    const form = call.rawBody as FormData;
    const file = form.get('file');
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name ?? (file as Blob & { name?: string }).name).toBe('hello.txt');
    expect((file as Blob).size).toBe(11);
  });

  it('returns the created attachment objects verbatim, including content URL and mimeType', async () => {
    const created = {
      id: '99021',
      self: 'https://jira.example.com/rest/api/3/attachment/99021',
      filename: 'hello.txt',
      size: 11,
      mimeType: 'text/plain',
      created: '2026-07-21T13:24:22.000+0200',
      content: 'https://jira.example.com/rest/api/3/attachment/content/99021',
      author: { accountId: 'acc-1', displayName: 'Jane Doe' },
    };
    const { client } = captureFetch(() => ({ json: [created] }));
    await expect(client.uploadAttachment('PROJ-1', filePath)).resolves.toEqual([created]);
  });

  it('does NOT send a Content-Type header (fetch sets multipart boundary)', async () => {
    const { client, calls } = captureFetch(() => ({ json: [] }));
    await client.uploadAttachment('PROJ-1', filePath);
    expect(calls[0].headers['Content-Type']).toBeUndefined();
  });

  it('throws a descriptive error when the file does not exist', async () => {
    const { client } = captureFetch(() => ({ json: [] }));
    await expect(client.uploadAttachment('PROJ-1', join(tmpDir, 'missing.bin'))).rejects.toThrow();
  });
});

describe('JiraClient.resolveTransition', () => {
  it('matches to.name case-insensitively and returns id/name/toName', async () => {
    const { client, calls } = captureFetch(() => ({
      json: {
        transitions: [
          { id: '11', name: 'Start Progress', to: { id: '3', name: 'In Progress' } },
          { id: '21', name: 'Done', to: { id: '5', name: 'Done' } },
        ],
      },
    }));
    const resolved = await client.resolveTransition('PROJ-1', 'in progress');
    expect(resolved).toEqual({ id: '11', name: 'Start Progress', toName: 'In Progress' });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
  });

  it('falls back to matching transition name when no to.name matches', async () => {
    const { client } = captureFetch(() => ({
      json: {
        transitions: [{ id: '31', name: 'Reopen', to: { id: '1', name: 'To Do' } }],
      },
    }));
    const resolved = await client.resolveTransition('PROJ-1', 'REOPEN');
    expect(resolved.id).toBe('31');
    expect(resolved.toName).toBe('To Do');
  });

  it('throws with available transitions when none match', async () => {
    const { client } = captureFetch(() => ({
      json: { transitions: [{ id: '1', name: 'Done', to: { id: '5', name: 'Done' } }] },
    }));
    await expect(client.resolveTransition('PROJ-1', 'Nope')).rejects.toThrow(/No transition/);
  });
});

describe('JiraClient.transitionIssue', () => {
  it('resolves and POSTs the transition by default', async () => {
    const { client, calls } = captureFetch((url) => {
      if (url.includes('/transitions')) {
        return {
          json: {
            transitions: [{ id: '11', name: 'Go', to: { id: '3', name: 'In Progress' } }],
          },
        };
      }
      return { json: {} };
    });
    const result = await client.transitionIssue('PROJ-1', 'In Progress');
    expect(result).toEqual({ id: '11', name: 'Go' });
    const post = calls.find((c) => c.method === 'POST');
    expect(post).toBeDefined();
    expect((post!.body as { transition: { id: string } }).transition.id).toBe('11');
  });

  it('does NOT POST when dryRun is set but still returns the resolved transition', async () => {
    const { client, calls } = captureFetch(() => ({
      json: {
        transitions: [{ id: '11', name: 'Go', to: { id: '3', name: 'In Progress' } }],
      },
    }));
    const result = await client.transitionIssue('PROJ-1', 'in progress', { dryRun: true });
    expect(result).toEqual({ id: '11', name: 'Go' });
    expect(calls.every((c) => c.method === 'GET')).toBe(true);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

describe('JiraClient.getAttachmentMeta', () => {
  it('GETs /attachment/{id} and flattens author displayName', async () => {
    const { client, calls } = captureFetch(() => ({
      json: {
        id: 'att-1',
        filename: 'file.pdf',
        size: 1234,
        mimeType: 'application/pdf',
        author: { displayName: 'Alice' },
      },
    }));
    const meta = await client.getAttachmentMeta('att-1');
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toContain('/rest/api/3/attachment/att-1');
    expect(meta).toEqual({
      id: 'att-1',
      filename: 'file.pdf',
      size: 1234,
      mimeType: 'application/pdf',
      author: 'Alice',
    });
  });

  it('leaves author undefined when absent', async () => {
    const { client } = captureFetch(() => ({
      json: { id: 'att-2', filename: 'x.txt', size: 10 },
    }));
    const meta = await client.getAttachmentMeta('att-2');
    expect(meta.author).toBeUndefined();
    expect(meta.mimeType).toBeUndefined();
  });
});

describe('JiraClient.deleteAttachment', () => {
  it('DELETEs /attachment/{id}', async () => {
    const { client, calls } = captureFetch(() => ({ status: 204 }));
    await client.deleteAttachment('att-9');
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toContain('/rest/api/3/attachment/att-9');
  });
});

describe('JiraClient.addComment', () => {
  it('POSTs /rest/api/2/issue/{key}/comment and returns the new id', async () => {
    const { client, calls } = captureFetch(() => ({ json: { id: '30001' } }));
    const result = await client.addComment('PROJ-1', 'hello *wiki*');
    expect(result).toEqual({ id: '30001' });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://example.atlassian.net/rest/api/2/issue/PROJ-1/comment');
    expect(calls[0].body).toEqual({ body: 'hello *wiki*' });
  });

  it('includes parentId when replying to a comment', async () => {
    const { client, calls } = captureFetch(() => ({ json: { id: '30002' } }));
    await client.addComment('PROJ-1', 'reply', 'c-parent');
    expect(calls[0].body).toEqual({ body: 'reply', parentId: 'c-parent' });
  });

  it('throws a descriptive error on non-OK', async () => {
    const { client } = captureFetch(() => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: 'bad body',
    }));
    await expect(client.addComment('PROJ-1', 'x')).rejects.toThrow(
      /addComment failed: 400 Bad Request\nbad body/
    );
  });
});

describe('JiraClient.updateComment', () => {
  it('PUTs /rest/api/2/issue/{key}/comment/{id} with the new body', async () => {
    const { client, calls } = captureFetch(() => ({ json: {} }));
    await client.updateComment('PROJ-1', 'c-9', 'new *wiki*');
    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toBe(
      'https://example.atlassian.net/rest/api/2/issue/PROJ-1/comment/c-9'
    );
    expect(calls[0].body).toEqual({ body: 'new *wiki*' });
  });

  it('throws a descriptive error on non-OK', async () => {
    const { client } = captureFetch(() => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: 'gone',
    }));
    await expect(client.updateComment('PROJ-1', 'c-9', 'x')).rejects.toThrow(
      /updateComment failed: 404 Not Found\ngone/
    );
  });
});

describe('JiraClient.addWorklog', () => {
  it('POSTs /rest/api/2/issue/{key}/worklog and returns id/issueId', async () => {
    const { client, calls } = captureFetch(() => ({ json: { id: 'w-1', issueId: '10000' } }));
    const result = await client.addWorklog('PROJ-1', {
      started: '2026-01-01T09:00:00.000+0000',
      timeSpentSeconds: 3600,
      comment: 'worked',
    });
    expect(result).toEqual({ id: 'w-1', issueId: '10000' });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://example.atlassian.net/rest/api/2/issue/PROJ-1/worklog');
    expect(calls[0].body).toEqual({
      started: '2026-01-01T09:00:00.000+0000',
      timeSpentSeconds: 3600,
      comment: 'worked',
    });
  });

  it('throws a descriptive error on non-OK', async () => {
    const { client } = captureFetch(() => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: 'no worklog',
    }));
    await expect(
      client.addWorklog('PROJ-1', { started: 's', timeSpentSeconds: 60 })
    ).rejects.toThrow(/addWorklog failed: 403 Forbidden\nno worklog/);
  });
});

describe('JiraClient.deleteComment', () => {
  it('DELETEs /rest/api/2/issue/{key}/comment/{id} and tolerates 204', async () => {
    const { client, calls } = captureFetch(() => ({ status: 204 }));
    await client.deleteComment('PROJ-1', 'c-9');
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toContain('/rest/api/2/issue/PROJ-1/comment/c-9');
  });

  it('throws a descriptive error on non-OK', async () => {
    const { client } = captureFetch(() => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: 'gone',
    }));
    await expect(client.deleteComment('PROJ-1', 'c-9')).rejects.toThrow(
      /deleteComment failed: 404 Not Found\ngone/
    );
  });
});

describe('JiraClient — write method error paths', () => {
  it('transitionIssue throws when the POST fails', async () => {
    const { client } = captureFetch((url, init) => {
      if (url.includes('/transitions') && (init?.method ?? 'GET') === 'GET') {
        return {
          json: { transitions: [{ id: '11', name: 'Go', to: { id: '3', name: 'In Progress' } }] },
        };
      }
      return { ok: false, status: 500, statusText: 'Server Error', text: 'transition boom' };
    });
    await expect(client.transitionIssue('PROJ-1', 'In Progress')).rejects.toThrow(
      /transition failed: 500 Server Error/
    );
  });

  it('assignIssue throws on non-OK, non-204', async () => {
    const { client } = captureFetch(() => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: 'bad account',
    }));
    await expect(client.assignIssue('PROJ-1', 'acc-1')).rejects.toThrow(
      /assignIssue failed: 400 Bad Request\nbad account/
    );
  });

  it('linkIssues throws on non-OK, non-201', async () => {
    const { client } = captureFetch(() => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: 'no such link type',
    }));
    await expect(client.linkIssues('PROJ-1', 'PROJ-2', 'Blocks')).rejects.toThrow(
      /linkIssues failed: 404 Not Found\nno such link type/
    );
  });

  it('removeIssueLink throws on non-OK, non-204', async () => {
    const { client } = captureFetch(() => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: 'missing',
    }));
    await expect(client.removeIssueLink('l-1')).rejects.toThrow(
      /removeIssueLink failed: 404 Not Found\nmissing/
    );
  });

  it('addWatcher throws on non-OK, non-204', async () => {
    const { client } = captureFetch(() => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: 'bad watcher',
    }));
    await expect(client.addWatcher('PROJ-1', 'acc-1')).rejects.toThrow(
      /addWatcher failed: 400 Bad Request\nbad watcher/
    );
  });

  it('removeWatcher throws on non-OK, non-204', async () => {
    const { client } = captureFetch(() => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: 'not watching',
    }));
    await expect(client.removeWatcher('PROJ-1', 'acc-1')).rejects.toThrow(
      /removeWatcher failed: 404 Not Found\nnot watching/
    );
  });

  it('uploadAttachment throws a descriptive error on non-OK', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'jirallm-upload-err-'));
    const file = join(tmp, 'f.txt');
    await writeFile(file, 'x');
    const { client } = captureFetch(() => ({
      ok: false,
      status: 413,
      statusText: 'Payload Too Large',
      text: 'too big',
    }));
    await expect(client.uploadAttachment('PROJ-1', file)).rejects.toThrow(
      /uploadAttachment failed: 413 Payload Too Large\ntoo big/
    );
    await rm(tmp, { recursive: true, force: true });
  });

  it('deleteAttachment throws on non-OK, non-204', async () => {
    const { client } = captureFetch(() => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: 'denied',
    }));
    await expect(client.deleteAttachment('att-1')).rejects.toThrow(
      /deleteAttachment failed: 403 Forbidden\ndenied/
    );
  });
});

describe('JiraClient.downloadAttachment', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'jirallm-download-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('streams the response body into the output file', async () => {
    const { Readable } = await import('node:stream');
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          body: Readable.from([Buffer.from('file-contents')]),
        } as unknown as Response;
      })
    );
    const out = join(tmpDir, 'nested', 'out.bin');
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await client.downloadAttachment('https://x/attachment/content/1', out);
    expect(urls[0]).toBe('https://x/attachment/content/1');
    const written = await readFile(out, 'utf8');
    expect(written).toBe('file-contents');
  });

  it('throws when the download response is not OK', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return { ok: false, status: 404, statusText: 'Not Found' } as unknown as Response;
      })
    );
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await expect(
      client.downloadAttachment('https://x/1', join(tmpDir, 'a.bin'))
    ).rejects.toThrow(/Failed to download attachment: 404 Not Found/);
  });

  it('throws when the response body is null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return { ok: true, status: 200, statusText: 'OK', body: null } as unknown as Response;
      })
    );
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await expect(
      client.downloadAttachment('https://x/1', join(tmpDir, 'b.bin'))
    ).rejects.toThrow(/Response body is null/);
  });
});

describe('JiraClient — Authorization header', () => {
  it('sends Basic auth on every write call', async () => {
    const { client, calls } = captureFetch(() => ({ status: 204 }));
    await client.assignIssue('PROJ-1', null);
    const expected =
      'Basic ' + Buffer.from('user@example.com:token').toString('base64');
    expect(calls[0].headers.Authorization).toBe(expected);
  });
});
