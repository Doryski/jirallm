import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    apiToken: 'tok',
  })),
  findOrgsByProjectKey: vi.fn(() => ['solo']),
}));

const addCommentMock = vi.fn();
const updateCommentMock = vi.fn();
const deleteCommentMock = vi.fn();
const getCommentMock = vi.fn();
const fetchIssueCommentsMock = vi.fn();
const uploadAttachmentMock = vi.fn();
const updateCommentAdfMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    updateCommentAdf = updateCommentAdfMock;
    addComment = addCommentMock;
    updateComment = updateCommentMock;
    deleteComment = deleteCommentMock;
    getComment = getCommentMock;
    fetchIssueComments = fetchIssueCommentsMock;
    uploadAttachment = uploadAttachmentMock;
    convertADFToMarkdown = (body: unknown) => (typeof body === 'string' ? body : '');
  },
}));

const confirmOrAbortMock = vi.fn();
vi.mock('../confirm.js', () => ({
  confirmOrAbort: (...args: unknown[]) => confirmOrAbortMock(...args),
}));

import { runComment, runCommentList, runDeleteComment, runEditComment } from './comment.js';

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
  updateCommentMock.mockReset();
  deleteCommentMock.mockReset();
  getCommentMock.mockReset();
  fetchIssueCommentsMock.mockReset();
  uploadAttachmentMock.mockReset();
  updateCommentAdfMock.mockReset();
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

  it('--attach uploads files and embeds them (images as thumbnails, others as links)', async () => {
    uploadAttachmentMock.mockImplementation(async (_key: string, file: string) => [
      { id: `id-${file}`, filename: file.split('/').pop(), size: 1 },
    ]);
    await runComment('PROJ-1', {
      text: 'summary body',
      noWiki: true,
      attach: ['/tmp/shot.png', '/tmp/verification.md'],
    });
    expect(uploadAttachmentMock).toHaveBeenCalledTimes(2);
    const posted = addCommentMock.mock.calls.map((c) => c[1] as string).join('\n');
    expect(posted).toContain('summary body');
    expect(posted).toContain('!shot.png|thumbnail!');
    expect(posted).toContain('[^verification.md]');
  });

  it('--attach in dry-run embeds by basename without uploading', async () => {
    await runComment('PROJ-1', {
      text: 'summary body',
      noWiki: true,
      dryRun: true,
      json: true,
      attach: ['/tmp/shot.png'],
    });
    expect(uploadAttachmentMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.attachments).toEqual(['shot.png']);
    expect(parsed.chunks.map((c: { body: string }) => c.body).join('\n')).toContain(
      '!shot.png|thumbnail!'
    );
  });

  it('--attach-images rewrites the posted comment into mediaSingle + em caption', async () => {
    uploadAttachmentMock.mockImplementation(async (_key: string, file: string) => [
      { id: `id-${file}`, filename: file.split('/').pop(), size: 1 },
    ]);
    getCommentMock.mockImplementation(async () => ({
      id: 'new-1',
      author: { displayName: 'Alice' },
      created: '2026-01-01',
      body: {
        version: 1,
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'summary body' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '⟦jirallm-media-0⟧' }] },
          {
            type: 'mediaGroup',
            content: [{ type: 'media', attrs: { type: 'file', id: 'uuid-1', collection: '' } }],
          },
        ],
      },
    }));

    await runComment('PROJ-1', {
      text: 'summary body',
      noWiki: true,
      attachImages: ['/tmp/shot.png:"Nowe pole"'],
      imageLayout: 'align-start',
      imageWidth: '50',
    });

    const posted = addCommentMock.mock.calls[0][1] as string;
    expect(posted).toContain('⟦jirallm-media-0⟧');
    expect(posted).toContain('[^shot.png]');

    const [issueKey, commentId, adf] = updateCommentAdfMock.mock.calls[0];
    expect(issueKey).toBe('PROJ-1');
    expect(commentId).toBe('new-1');
    expect(adf.content[1]).toEqual({
      type: 'mediaSingle',
      attrs: { layout: 'align-start', width: 50 },
      content: [{ type: 'media', attrs: { type: 'file', id: 'uuid-1', collection: '' } }],
    });
    expect(adf.content[2]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Nowe pole', marks: [{ type: 'em' }] }],
    });
    expect(JSON.stringify(adf)).not.toContain('"caption"');
  });

  it('--attach-images in dry-run touches no network and previews the embeds', async () => {
    await runComment('PROJ-1', {
      text: 'body',
      noWiki: true,
      dryRun: true,
      json: true,
      attachImages: ['/tmp/shot.png:"Podpis"'],
      imageLayout: 'center',
      imageWidth: '80',
    });

    expect(uploadAttachmentMock).not.toHaveBeenCalled();
    expect(addCommentMock).not.toHaveBeenCalled();
    expect(updateCommentAdfMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.embeddedImages).toEqual([
      { filename: 'shot.png', kind: 'image', caption: 'Podpis', layout: 'center', width: 80 },
    ]);
  });

  it('rejects an invalid --image-layout or --image-width before calling Jira', async () => {
    await expect(
      runComment('PROJ-1', { text: 'x', attachImages: ['/tmp/a.png'], imageLayout: 'sideways' })
    ).rejects.toThrow(/Invalid --image-layout/);
    await expect(
      runComment('PROJ-1', { text: 'x', attachImages: ['/tmp/a.png'], imageWidth: '900' })
    ).rejects.toThrow(/between 1 and 100/);
    expect(uploadAttachmentMock).not.toHaveBeenCalled();
    expect(addCommentMock).not.toHaveBeenCalled();
  });

  it('embeds a non-image passed to --attach-images as a compact mediaGroup tile', async () => {
    uploadAttachmentMock.mockImplementation(async (_key: string, file: string) => [
      { id: `id-${file}`, filename: file.split('/').pop(), size: 1 },
    ]);
    getCommentMock.mockImplementation(async () => ({
      id: 'new-1',
      author: { displayName: 'Alice' },
      created: '2026-01-01',
      body: {
        version: 1,
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'body' }] },
          { type: 'paragraph', content: [{ type: 'text', text: '⟦jirallm-media-0⟧' }] },
          {
            type: 'mediaGroup',
            content: [{ type: 'media', attrs: { type: 'file', id: 'uuid-f', collection: '' } }],
          },
        ],
      },
    }));

    await runComment('PROJ-1', { text: 'body', noWiki: true, attachImages: ['/tmp/report.txt'] });

    const posted = addCommentMock.mock.calls[0][1] as string;
    expect(posted).toContain('[^report.txt]');
    expect(posted).toContain('⟦jirallm-media-0⟧');

    const [, , adf] = updateCommentAdfMock.mock.calls[0];
    expect(adf.content[1]).toEqual({
      type: 'mediaGroup',
      content: [{ type: 'media', attrs: { type: 'file', id: 'uuid-f', collection: '' } }],
    });
  });

  it('places media at an @@media:...@@ placeholder instead of appending it', async () => {
    uploadAttachmentMock.mockImplementation(async (_key: string, file: string) => [
      { id: `id-${file}`, filename: file.split('/').pop(), size: 1 },
    ]);
    getCommentMock.mockResolvedValue({
      id: 'new-1',
      author: { displayName: 'Alice' },
      created: '2026-01-01',
      body: { version: 1, type: 'doc', content: [] },
    });
    await runComment('PROJ-1', {
      text: 'intro\n\n@@media:shot.png@@\n\noutro',
      noWiki: true,
      attachImages: ['/tmp/shot.png'],
    });

    const posted = addCommentMock.mock.calls[0][1] as string;
    expect(posted).toBe('intro\n\n⟦jirallm-media-0⟧\n\n[^shot.png]\n\noutro');
  });
});

describe('runEditComment', () => {
  beforeEach(() => {
    getCommentMock.mockResolvedValue({
      id: '55',
      author: { displayName: 'Alice' },
      created: '2026-01-01',
      body: 'old body',
    });
  });

  it('updates the comment with wiki-converted body from --text', async () => {
    await runEditComment('PROJ-1', '55', { text: '# Title' });
    expect(getCommentMock).toHaveBeenCalledWith('PROJ-1', '55');
    expect(updateCommentMock).toHaveBeenCalledWith('PROJ-1', '55', 'h1. Title');
    expect(logs.join('\n')).toContain('Updated comment 55');
  });

  it('--no-wiki sends the body as-is', async () => {
    await runEditComment('PROJ-1', '55', { text: '# Title', noWiki: true });
    expect(updateCommentMock).toHaveBeenCalledWith('PROJ-1', '55', '# Title');
  });

  it('dry-run does not call updateComment', async () => {
    await runEditComment('PROJ-1', '55', { text: 'new', noWiki: true, dryRun: true });
    expect(updateCommentMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('dry-run');
  });

  it('--json outputs structured result', async () => {
    await runEditComment('PROJ-1', '55', { text: 'new', noWiki: true, json: true });
    const parsed = JSON.parse(writes.join(''));
    expect(parsed).toMatchObject({ issueKey: 'PROJ-1', id: '55', updated: true });
  });

  it('throws on empty body', async () => {
    await expect(runEditComment('PROJ-1', '55', { text: '   ' })).rejects.toThrow('Empty comment body');
    expect(updateCommentMock).not.toHaveBeenCalled();
  });

  it('--attach uploads files and appends embeds to the updated body', async () => {
    uploadAttachmentMock.mockImplementation(async (_key: string, file: string) => [
      { id: `id-${file}`, filename: file.split('/').pop(), size: 1 },
    ]);
    await runEditComment('PROJ-1', '55', {
      text: 'updated body',
      noWiki: true,
      attach: ['/tmp/after-proof.png', '/tmp/report.md'],
    });
    expect(uploadAttachmentMock).toHaveBeenCalledTimes(2);
    const body = updateCommentMock.mock.calls[0][2] as string;
    expect(body).toContain('updated body');
    expect(body).toContain('!after-proof.png|thumbnail!');
    expect(body).toContain('[^report.md]');
  });

  it('--attach in dry-run embeds by basename without uploading', async () => {
    await runEditComment('PROJ-1', '55', {
      text: 'updated body',
      noWiki: true,
      dryRun: true,
      json: true,
      attach: ['/tmp/after-proof.png'],
    });
    expect(uploadAttachmentMock).not.toHaveBeenCalled();
    expect(updateCommentMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.attachments).toEqual(['after-proof.png']);
    expect(parsed.body).toContain('!after-proof.png|thumbnail!');
  });

  it('--attach-images rewrites the edited comment into mediaSingle', async () => {
    uploadAttachmentMock.mockImplementation(async (_key: string, file: string) => [
      { id: `id-${file}`, filename: file.split('/').pop(), size: 1 },
    ]);
    getCommentMock.mockResolvedValue({
      id: '55',
      author: { displayName: 'Alice' },
      created: '2026-01-01',
      body: {
        version: 1,
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '⟦jirallm-media-0⟧' }] },
          {
            type: 'mediaGroup',
            content: [{ type: 'media', attrs: { type: 'file', id: 'uuid-9', collection: '' } }],
          },
        ],
      },
    });

    await runEditComment('PROJ-1', '55', {
      text: 'updated body',
      noWiki: true,
      attachImages: ['/tmp/after.png:"Po poprawce"'],
    });

    const [, commentId, adf] = updateCommentAdfMock.mock.calls[0];
    expect(commentId).toBe('55');
    expect(adf.content[0].type).toBe('mediaSingle');
    expect(adf.content[1].content[0]).toEqual({
      type: 'text',
      text: 'Po poprawce',
      marks: [{ type: 'em' }],
    });
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

  it('--json includes the full comment body (not just a snippet)', async () => {
    const long = 'x'.repeat(500);
    fetchIssueCommentsMock.mockResolvedValue([
      { id: '1', author: { displayName: 'Alice' }, created: '2026-01-01', body: long },
    ]);
    await runCommentList('PROJ-1', { json: true });
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.comments[0].body).toBe(long);
    expect(parsed.comments[0].snippet.endsWith('…')).toBe(true);
    expect(parsed.comments[0].snippet.length).toBeLessThan(long.length);
  });

  it('--rendered requests renderedBody, includes it per comment, and implies JSON', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    fetchIssueCommentsMock.mockResolvedValue([
      {
        id: '1',
        author: { displayName: 'Alice' },
        created: '2026-01-01',
        body: 'hello',
        renderedBody: '<p>hello</p>',
      },
    ]);
    await runCommentList('PROJ-1', { rendered: true });
    expect(fetchIssueCommentsMock).toHaveBeenCalledWith('PROJ-1', { rendered: true });
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.comments[0]).toMatchObject({ id: '1', renderedBody: '<p>hello</p>' });
  });

  it('omits renderedBody when --rendered is not passed', async () => {
    fetchIssueCommentsMock.mockResolvedValue(sample);
    await runCommentList('PROJ-1', { json: true });
    expect(fetchIssueCommentsMock).toHaveBeenCalledWith('PROJ-1', { rendered: undefined });
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.comments[0]).not.toHaveProperty('renderedBody');
  });
});
