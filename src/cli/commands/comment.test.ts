import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    apiToken: 'tok',
  })),
  findOrgsByProjectKey: vi.fn(() => ['solo']),
}));

const addCommentMock = vi.fn();
const deleteCommentMock = vi.fn();
const getCommentMock = vi.fn();
const fetchIssueCommentsMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    addComment = addCommentMock;
    deleteComment = deleteCommentMock;
    getComment = getCommentMock;
    fetchIssueComments = fetchIssueCommentsMock;
    convertADFToMarkdown = (body: unknown) => (typeof body === 'string' ? body : '');
  },
}));

const confirmOrAbortMock = vi.fn();
vi.mock('../confirm.js', () => ({
  confirmOrAbort: (...args: unknown[]) => confirmOrAbortMock(...args),
}));

import { runComment, runCommentList, runDeleteComment } from './comment.js';

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => {
    logs.push(a.map(String).join(' '));
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    writes.push(String(c));
    return true;
  });
  addCommentMock.mockReset();
  deleteCommentMock.mockReset();
  getCommentMock.mockReset();
  fetchIssueCommentsMock.mockReset();
  confirmOrAbortMock.mockReset();
  addCommentMock.mockResolvedValue({ id: 'new-1' });
  confirmOrAbortMock.mockResolvedValue(true);
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runDeleteComment', () => {
  it('dry-run previews the comment via getComment and does NOT delete', async () => {
    getCommentMock.mockResolvedValue({
      id: '55',
      author: { displayName: 'Alice' },
      created: '2026-01-01',
      body: 'the comment text',
    });
    await runDeleteComment('PROJ-1', '55', { dryRun: true });
    expect(getCommentMock).toHaveBeenCalledWith('PROJ-1', '55');
    expect(deleteCommentMock).not.toHaveBeenCalled();
    expect(confirmOrAbortMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('the comment text');
    expect(logs.join('\n')).toContain('would delete comment 55');
  });

  it('reads back and confirms before deleting; deletes when confirmed', async () => {
    getCommentMock.mockResolvedValue({
      id: '55',
      author: { displayName: 'Alice' },
      created: '2026-01-01',
      body: 'body',
    });
    confirmOrAbortMock.mockResolvedValue(true);
    await runDeleteComment('PROJ-1', '55', {});
    expect(getCommentMock).toHaveBeenCalledWith('PROJ-1', '55');
    expect(confirmOrAbortMock).toHaveBeenCalledTimes(1);
    expect(deleteCommentMock).toHaveBeenCalledWith('PROJ-1', '55');
  });

  it('does NOT delete when confirmation is declined', async () => {
    getCommentMock.mockResolvedValue({
      id: '55',
      author: { displayName: 'Alice' },
      created: '2026-01-01',
      body: 'body',
    });
    confirmOrAbortMock.mockResolvedValue(false);
    await runDeleteComment('PROJ-1', '55', {});
    expect(deleteCommentMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Aborted');
  });

  it('--yes bypasses confirmation prompt and deletes', async () => {
    getCommentMock.mockResolvedValue({
      id: '55',
      author: { displayName: 'Alice' },
      created: '2026-01-01',
      body: 'body',
    });
    await runDeleteComment('PROJ-1', '55', { yes: true });
    expect(confirmOrAbortMock).toHaveBeenCalledWith(expect.any(String), { yes: true });
    expect(deleteCommentMock).toHaveBeenCalledWith('PROJ-1', '55');
  });

  it('--json dry-run prints structured preview', async () => {
    getCommentMock.mockResolvedValue({
      id: '55',
      author: { displayName: 'Alice' },
      created: '2026-01-01',
      body: 'json body',
    });
    await runDeleteComment('PROJ-1', '55', { dryRun: true, json: true });
    const parsed = JSON.parse(writes.join(''));
    expect(parsed).toMatchObject({ dryRun: true, issueKey: 'PROJ-1', id: '55', body: 'json body' });
    expect(deleteCommentMock).not.toHaveBeenCalled();
  });
});

describe('runComment', () => {
  it('uses English chunk headers with (reply) marker', async () => {
    const body = 'first paragraph here.\n\nsecond paragraph here.';
    await runComment('PROJ-1', { text: body, noWiki: true, maxChars: '25', replyTo: 'root-9' });
    const bodies = addCommentMock.mock.calls.map((c) => c[1] as string);
    expect(bodies.length).toBeGreaterThan(1);
    expect(bodies[0]).toContain('_Part 1/');
    expect(bodies[0]).toContain('(reply)');
    expect(bodies[1]).toContain('_Part 2/');
    expect(bodies.join('\n')).not.toMatch(/Część|replika/);
  });

  it('--json outputs posted comment ids and suppresses progress logs', async () => {
    addCommentMock.mockResolvedValueOnce({ id: 'c-1' });
    await runComment('PROJ-1', { text: 'hello', noWiki: true, json: true });
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.issueKey).toBe('PROJ-1');
    expect(parsed.posted[0].id).toBe('c-1');
    expect(logs.join('\n')).not.toContain('Posting');
  });

  it('dry-run does not post', async () => {
    await runComment('PROJ-1', { text: 'hello', noWiki: true, dryRun: true });
    expect(addCommentMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('dry-run');
  });
});

describe('runCommentList', () => {
  const sample = [
    { id: '1', author: { displayName: 'Alice' }, created: '2026-01-01', body: 'hello world' },
    { id: '2', author: { displayName: 'Bob' }, created: '2026-01-02', body: 'second one' },
  ];

  it('lists comment id/author/snippet in human output', async () => {
    fetchIssueCommentsMock.mockResolvedValue(sample);
    await runCommentList('PROJ-1', {});
    const out = logs.join('\n');
    expect(out).toContain('PROJ-1 comments (2)');
    expect(out).toContain('Alice');
    expect(out).toContain('hello world');
    expect(out).toContain('Bob');
  });

  it('prints "no comments" when empty', async () => {
    fetchIssueCommentsMock.mockResolvedValue([]);
    await runCommentList('PROJ-1', {});
    expect(logs.join('\n')).toContain('PROJ-1 has no comments.');
  });

  it('--json outputs structured comment list', async () => {
    fetchIssueCommentsMock.mockResolvedValue(sample);
    await runCommentList('PROJ-1', { json: true });
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.issueKey).toBe('PROJ-1');
    expect(parsed.comments).toHaveLength(2);
    expect(parsed.comments[0]).toMatchObject({ id: '1', author: 'Alice', snippet: 'hello world' });
  });
});
