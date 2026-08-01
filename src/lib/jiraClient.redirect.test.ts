import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JiraClient, isJiraApiError, requestWithRedirectPolicy } from './jiraClient.js';

const FAKE_CONFIG = {
  baseUrl: 'https://example.atlassian.net',
  projectKey: 'PROJ',
  userEmail: 'user@example.com',
};

type StubResponse = {
  status?: number;
  statusText?: string;
  location?: string;
  json?: unknown;
  body?: unknown;
};

type StubCall = { url: string; init: RequestInit };

/** Replays `responses` in order, recording every request the policy actually made. */
function stubFetchSequence(responses: StubResponse[]): StubCall[] {
  const queue = [...responses];
  const calls: StubCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const next = queue.shift();
      if (!next) throw new Error(`Unexpected extra fetch call to ${url}`);
      const status = next.status ?? 200;
      const headers = new Headers();
      if (next.location) headers.set('location', next.location);
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: next.statusText ?? 'OK',
        url,
        headers,
        json: async () => next.json ?? {},
        text: async () => '',
        body: next.body,
      } as unknown as Response;
    })
  );
  return calls;
}

const headerValue = (init: RequestInit, name: string): string | undefined => {
  const headers = init.headers as Record<string, string> | undefined;
  if (!headers) return undefined;
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return match?.[1];
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('requestWithRedirectPolicy — refusals', () => {
  it('refuses a 302 to a private IP', async () => {
    stubFetchSequence([{ status: 302, location: 'http://169.254.169.254/latest/meta-data/' }]);
    await expect(
      requestWithRedirectPolicy('https://example.atlassian.net/rest/api/3/myself')
    ).rejects.toThrow(/Refused to follow redirect.*169\.254\.169\.254/s);
  });

  it.each([
    ['loopback', 'https://127.0.0.1/x'],
    ['loopback name', 'https://localhost/x'],
    ['private class A', 'https://10.0.0.5/x'],
    ['private class B', 'https://172.20.1.1/x'],
    ['private class C', 'https://192.168.1.1/x'],
    ['CGNAT', 'https://100.100.0.1/x'],
    ['decimal-encoded loopback', 'https://2130706433/x'],
    ['IPv6 loopback', 'https://[::1]/x'],
    ['IPv6 unique-local', 'https://[fd00::1]/x'],
    ['IPv6 link-local', 'https://[fe80::1]/x'],
    ['IPv4-mapped loopback', 'https://[::ffff:127.0.0.1]/x'],
    ['.internal name', 'https://metadata.internal/x'],
  ])('refuses a redirect to %s', async (_label, location) => {
    stubFetchSequence([{ status: 302, location }]);
    await expect(
      requestWithRedirectPolicy('https://example.atlassian.net/rest/api/3/myself')
    ).rejects.toThrow(/Refused to follow redirect/);
  });

  it('refuses a 302 to a disallowed external host', async () => {
    stubFetchSequence([{ status: 302, location: 'https://evil.example.com/collect' }]);
    await expect(
      requestWithRedirectPolicy('https://example.atlassian.net/rest/api/3/myself')
    ).rejects.toThrow(/host "evil\.example\.com" is not in the allowed redirect hosts/);
  });

  it('refuses a scheme downgrade to http on another allowed host', async () => {
    stubFetchSequence([{ status: 302, location: 'http://media.atlassian.com/file/1' }]);
    await expect(
      requestWithRedirectPolicy('https://example.atlassian.net/rest/api/3/myself')
    ).rejects.toThrow(/scheme "http:" is not allowed/);
  });

  it('refuses a host that only looks like an allowed suffix', async () => {
    stubFetchSequence([{ status: 302, location: 'https://evil-atlassian.net/x' }]);
    await expect(
      requestWithRedirectPolicy('https://example.atlassian.net/x')
    ).rejects.toThrow(/is not in the allowed redirect hosts/);
  });

  it('throws a JiraApiError carrying the redirect status and location', async () => {
    stubFetchSequence([{ status: 307, statusText: 'Temporary Redirect', location: 'https://evil.example.com/' }]);
    const error = await requestWithRedirectPolicy('https://example.atlassian.net/x').catch(
      (e: unknown) => e
    );
    expect(isJiraApiError(error)).toBe(true);
    if (!isJiraApiError(error)) throw new Error('unreachable');
    expect(error.status).toBe(307);
    expect(error.headers.location).toBe('https://evil.example.com/');
  });

  it('terminates at the hop limit instead of looping forever', async () => {
    const calls = stubFetchSequence(
      Array.from({ length: 6 }, (_, i) => ({
        status: 302,
        location: `https://example.atlassian.net/hop-${i + 1}`,
      }))
    );
    await expect(
      requestWithRedirectPolicy('https://example.atlassian.net/start')
    ).rejects.toThrow(/exceeded 3 redirect hops/);
    // The initial request plus exactly `maxRedirects` follow-ups.
    expect(calls).toHaveLength(4);
  });

  it('honours a custom maxRedirects', async () => {
    const calls = stubFetchSequence([
      { status: 302, location: 'https://example.atlassian.net/a' },
      { status: 302, location: 'https://example.atlassian.net/b' },
    ]);
    await expect(
      requestWithRedirectPolicy('https://example.atlassian.net/start', {}, { maxRedirects: 1 })
    ).rejects.toThrow(/exceeded 1 redirect hops/);
    expect(calls).toHaveLength(2);
  });
});

describe('requestWithRedirectPolicy — allowed hops', () => {
  it('leaves a normal 2xx untouched and never follows anything', async () => {
    const calls = stubFetchSequence([{ status: 200, json: { ok: true } }]);
    const response = await requestWithRedirectPolicy('https://example.atlassian.net/x');
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].init.redirect).toBe('manual');
  });

  it('follows a 303 to an Atlassian media host and drops the credentials', async () => {
    const calls = stubFetchSequence([
      { status: 303, location: 'https://media.atlassian.com/file/abc?token=signed' },
      { status: 200, json: { ok: true } },
    ]);
    const response = await requestWithRedirectPolicy(
      'https://example.atlassian.net/rest/api/3/attachment/content/1',
      { headers: { Authorization: 'Basic secret', Accept: 'application/json' } }
    );
    expect(response.status).toBe(200);
    expect(calls[1].url).toBe('https://media.atlassian.com/file/abc?token=signed');
    expect(headerValue(calls[1].init, 'authorization')).toBeUndefined();
    expect(headerValue(calls[1].init, 'accept')).toBe('application/json');
  });

  it('keeps the credentials on a same-origin hop', async () => {
    const calls = stubFetchSequence([
      { status: 302, location: '/rest/api/3/moved' },
      { status: 200 },
    ]);
    await requestWithRedirectPolicy('https://example.atlassian.net/rest/api/3/x', {
      headers: { Authorization: 'Basic secret' },
    });
    expect(calls[1].url).toBe('https://example.atlassian.net/rest/api/3/moved');
    expect(headerValue(calls[1].init, 'authorization')).toBe('Basic secret');
  });

  it('allows a private address when it is the host the caller asked for (Data Center)', async () => {
    const calls = stubFetchSequence([
      { status: 302, location: 'http://10.0.0.5/jira/login' },
      { status: 200 },
    ]);
    const response = await requestWithRedirectPolicy('http://10.0.0.5/jira/rest/api/3/myself');
    expect(response.status).toBe(200);
    expect(calls[1].url).toBe('http://10.0.0.5/jira/login');
  });

  it('follows a host added through allowedRedirectHosts', async () => {
    const calls = stubFetchSequence([
      { status: 302, location: 'https://sso.corp.example.com/authorize' },
      { status: 200 },
    ]);
    await requestWithRedirectPolicy(
      'https://jira.corp.example.com/rest/api/3/myself',
      {},
      { allowedRedirectHosts: ['.corp.example.com'] }
    );
    expect(calls[1].url).toBe('https://sso.corp.example.com/authorize');
  });

  it('turns a redirected POST into a GET without a body (301/302/303)', async () => {
    const calls = stubFetchSequence([
      { status: 303, location: 'https://example.atlassian.net/result' },
      { status: 200 },
    ]);
    await requestWithRedirectPolicy('https://example.atlassian.net/submit', {
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
    });
    expect(calls[1].init.method).toBe('GET');
    expect(calls[1].init.body).toBeUndefined();
  });

  it('preserves the method and body across a 307', async () => {
    const calls = stubFetchSequence([
      { status: 307, location: 'https://example.atlassian.net/result' },
      { status: 200 },
    ]);
    await requestWithRedirectPolicy('https://example.atlassian.net/submit', {
      method: 'POST',
      body: '{"a":1}',
    });
    expect(calls[1].init.method).toBe('POST');
    expect(calls[1].init.body).toBe('{"a":1}');
  });

  it('returns a 3xx that carries no Location instead of throwing', async () => {
    stubFetchSequence([{ status: 302, statusText: 'Found' }]);
    const response = await requestWithRedirectPolicy('https://example.atlassian.net/x');
    expect(response.status).toBe(302);
  });

  it('leaves a 304 Not Modified alone', async () => {
    const calls = stubFetchSequence([{ status: 304, location: 'https://evil.example.com/' }]);
    const response = await requestWithRedirectPolicy('https://example.atlassian.net/x');
    expect(response.status).toBe(304);
    expect(calls).toHaveLength(1);
  });
});

describe('JiraClient — redirect policy wiring', () => {
  it('applies the policy to REST v3 calls', async () => {
    stubFetchSequence([{ status: 302, location: 'https://169.254.169.254/latest/meta-data/' }]);
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await expect(client.getCurrentUser()).rejects.toThrow(/Refused to follow redirect/);
  });

  it('applies the policy to Agile API calls', async () => {
    stubFetchSequence([{ status: 302, location: 'https://evil.example.com/' }]);
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await expect(client.findBoardByName('Board')).rejects.toThrow(/Refused to follow redirect/);
  });

  it('applies the policy to write calls', async () => {
    stubFetchSequence([{ status: 302, location: 'https://evil.example.com/' }]);
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await expect(client.assignIssue('PROJ-1', null)).rejects.toThrow(
      /Refused to follow redirect/
    );
  });

  it('threads config.redirects through to the policy', async () => {
    const calls = stubFetchSequence([
      { status: 302, location: 'https://sso.corp.example.com/authorize' },
      { status: 200, json: { accountId: 'a1', displayName: 'A' } },
    ]);
    const client = new JiraClient(
      {
        ...FAKE_CONFIG,
        baseUrl: 'https://jira.corp.example.com',
        redirects: { allowedRedirectHosts: ['.corp.example.com'] },
      },
      'token'
    );
    await expect(client.getCurrentUser()).resolves.toEqual({ accountId: 'a1', displayName: 'A' });
    expect(calls[1].url).toBe('https://sso.corp.example.com/authorize');
  });
});

describe('JiraClient.downloadAttachment — redirects', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'jirallm-redirect-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('follows the Jira Cloud media redirect and streams the file', async () => {
    const { Readable } = await import('node:stream');
    const calls = stubFetchSequence([
      { status: 303, location: 'https://api.media.atlassian.com/file/abc/binary?token=signed' },
      { status: 200, body: Readable.from([Buffer.from('file-contents')]) },
    ]);
    const out = join(tmpDir, 'nested', 'out.bin');
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await client.downloadAttachment(
      'https://example.atlassian.net/rest/api/3/attachment/content/1',
      out
    );
    expect(calls).toHaveLength(2);
    expect(headerValue(calls[1].init, 'authorization')).toBeUndefined();
    await expect(readFile(out, 'utf8')).resolves.toBe('file-contents');
  });

  it('refuses to download through a redirect to a private address', async () => {
    stubFetchSequence([{ status: 302, location: 'http://169.254.169.254/latest/meta-data/' }]);
    const client = new JiraClient(FAKE_CONFIG, 'token');
    await expect(
      client.downloadAttachment(
        'https://example.atlassian.net/rest/api/3/attachment/content/1',
        join(tmpDir, 'out.bin')
      )
    ).rejects.toThrow(/Refused to follow redirect/);
  });
});
