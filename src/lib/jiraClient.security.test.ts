import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JiraClient } from './jiraClient.js';

const FAKE_CONFIG = {
  baseUrl: 'https://example.atlassian.net',
  projectKey: 'PROJ',
  userEmail: 'user@example.com',
};

const ISSUE_RESPONSE = { key: 'PROJ-1', fields: { summary: 'S' } };

function captureFetch(json: (url: string) => unknown = () => ({})): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        url,
        headers: new Headers(),
        json: async () => json(url),
        text: async () => '',
        body: Readable.from([Buffer.from('file-contents')]),
      } as unknown as Response;
    })
  );
  return urls;
}

const pathOf = (url: string): string => new URL(url).pathname;
const searchOf = (url: string): string => new URL(url).search;

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubEnv('JIRALLM_ALLOW_INSECURE_HTTP', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('JiraClient constructor — base URL', () => {
  it('rejects a plain http:// remote host', () => {
    expect(
      () => new JiraClient({ ...FAKE_CONFIG, baseUrl: 'http://jira.example.com' }, 'token')
    ).toThrow(/must use https:\/\//);
  });

  it.each(['https://example.atlassian.net', 'http://localhost:8080', 'http://127.0.0.1:8080'])(
    'accepts %s',
    (baseUrl) => {
      expect(() => new JiraClient({ ...FAKE_CONFIG, baseUrl }, 'token')).not.toThrow();
    }
  );

  it('accepts a remote http:// host with explicit allowInsecureHttp', () => {
    expect(
      () =>
        new JiraClient(
          { ...FAKE_CONFIG, baseUrl: 'http://jira.internal', allowInsecureHttp: true },
          'token'
        )
    ).not.toThrow();
  });

  it('accepts a remote http:// host when JIRALLM_ALLOW_INSECURE_HTTP=1', () => {
    vi.stubEnv('JIRALLM_ALLOW_INSECURE_HTTP', '1');
    expect(
      () => new JiraClient({ ...FAKE_CONFIG, baseUrl: 'http://jira.internal' }, 'token')
    ).not.toThrow();
  });

  it('lets an explicit allowInsecureHttp: false override the env opt-in', () => {
    vi.stubEnv('JIRALLM_ALLOW_INSECURE_HTTP', '1');
    expect(
      () =>
        new JiraClient(
          { ...FAKE_CONFIG, baseUrl: 'http://jira.internal', allowInsecureHttp: false },
          'token'
        )
    ).toThrow(/must use https:\/\//);
  });

  it('rejects a base URL carrying credentials', () => {
    expect(
      () => new JiraClient({ ...FAKE_CONFIG, baseUrl: 'https://u:p@example.atlassian.net' }, 'token')
    ).toThrow(/must not contain credentials/);
  });
});

describe('JiraClient.downloadAttachment — origin check', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'jirallm-security-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('refuses a foreign origin without calling fetch or leaking the query string', async () => {
    const urls = captureFetch();
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const download = client.downloadAttachment(
      'https://evil.example.com/steal?secret=abc',
      join(tmpDir, 'out.bin')
    );
    await expect(download).rejects.toThrow(/Refused to download attachment from "https:\/\/evil\.example\.com"/);
    await expect(download).rejects.not.toThrow(/secret=abc/);
    expect(urls).toHaveLength(0);
  });

  it('refuses an http:// URL on the Jira host without calling fetch', async () => {
    const urls = captureFetch();
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await expect(
      client.downloadAttachment(
        'http://example.atlassian.net/rest/api/3/attachment/content/1',
        join(tmpDir, 'out.bin')
      )
    ).rejects.toThrow(/Refused to download attachment from "http:\/\/example\.atlassian\.net"/);
    expect(urls).toHaveLength(0);
  });

  it('refuses an unparseable URL without calling fetch', async () => {
    const urls = captureFetch();
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await expect(
      client.downloadAttachment('not a url', join(tmpDir, 'out.bin'))
    ).rejects.toThrow(/Refused to download attachment from an invalid URL/);
    expect(urls).toHaveLength(0);
  });

  it('still downloads from the configured origin with credentials', async () => {
    const urls = captureFetch();
    const client = new JiraClient(FAKE_CONFIG, 'token');
    const out = join(tmpDir, 'out.bin');
    await client.downloadAttachment(
      'https://example.atlassian.net/rest/api/3/attachment/content/1',
      out
    );
    expect(urls).toEqual(['https://example.atlassian.net/rest/api/3/attachment/content/1']);
    await expect(readFile(out, 'utf8')).resolves.toBe('file-contents');
  });
});

describe('JiraClient — path segment encoding', () => {
  it('keeps a traversal-shaped link id inside /issueLink/', async () => {
    const urls = captureFetch();
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await client.removeIssueLink('../issue/PROJ-9?deleteSubtasks=true');
    expect(pathOf(urls[0])).toBe(
      '/rest/api/3/issueLink/..%2Fissue%2FPROJ-9%3FdeleteSubtasks%3Dtrue'
    );
    expect(searchOf(urls[0])).toBe('');
  });

  it('keeps a traversal-shaped comment id inside the comment endpoint', async () => {
    const urls = captureFetch();
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await client.deleteComment('PROJ-1', '../../../attachment/10001');
    expect(pathOf(urls[0])).toBe(
      '/rest/api/2/issue/PROJ-1/comment/..%2F..%2F..%2Fattachment%2F10001'
    );
  });

  it.each(['..', '.', ''])('rejects the bare segment %j before any request', async (segment) => {
    const urls = captureFetch();
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await expect(client.getComment('PROJ-1', segment)).rejects.toThrow(/path segment/);
    await expect(client.removeIssueLink(segment)).rejects.toThrow(/path segment/);
    expect(urls).toHaveLength(0);
  });

  it('encodes issue keys used by worklog writes', async () => {
    const urls = captureFetch(() => ({ id: '1', issueId: '2' }));
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await client.updateWorklog('PROJ-1/../../x', '7?y=1', { timeSpentSeconds: 60 });
    expect(pathOf(urls[0])).toBe('/rest/api/2/issue/PROJ-1%2F..%2F..%2Fx/worklog/7%3Fy%3D1');
    expect(searchOf(urls[0])).toBe('');
  });

  it('encodes numeric board ids and project keys', async () => {
    const urls = captureFetch(() => ({ values: [] }));
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await client.listSprints(12, { state: 'active' });
    await client.listVersions('PR/J');
    expect(urls[0]).toBe('https://example.atlassian.net/rest/agile/1.0/board/12/sprint?state=active');
    expect(pathOf(urls[1])).toBe('/rest/api/3/project/PR%2FJ/versions');
  });

  it('encodes caller-supplied field ids into the fields query parameter', async () => {
    const urls = captureFetch((url) => (url.includes('/field') && !url.includes('/issue') ? [] : ISSUE_RESPONSE));
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await client.fetchIssueDetails('PROJ-1', {
      includeComments: false,
      includeChangelog: false,
      jiraFieldIds: ['customfield_1&expand=changelog'],
    });
    const issueUrl = new URL(urls[urls.length - 1]);
    expect(issueUrl.pathname).toBe('/rest/api/3/issue/PROJ-1');
    expect([...issueUrl.searchParams.keys()]).toEqual(['fields']);
    expect(issueUrl.searchParams.get('fields')).toContain('customfield_1&expand=changelog');
  });
});
