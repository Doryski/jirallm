import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs/promises', () => ({ stat: vi.fn() }));

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    apiToken: 'tok',
  })),
  loadOrgProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x' },
    apiToken: 'tok',
  })),
  findOrgsByProjectKey: vi.fn(() => ['solo']),
}));

const uploadAttachmentMock = vi.fn();
const deleteAttachmentMock = vi.fn();
const getAttachmentMetaMock = vi.fn();
const fetchIssueDetailsMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    uploadAttachment = uploadAttachmentMock;
    deleteAttachment = deleteAttachmentMock;
    getAttachmentMeta = getAttachmentMetaMock;
    fetchIssueDetails = fetchIssueDetailsMock;
  },
}));

import { stat } from 'fs/promises';
import { runAttach, runAttachRemove } from './attach.js';

const statMock = stat as unknown as ReturnType<typeof vi.fn>;

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  uploadAttachmentMock.mockReset();
  deleteAttachmentMock.mockReset();
  getAttachmentMetaMock.mockReset();
  fetchIssueDetailsMock.mockReset();
  statMock.mockReset();
  statMock.mockResolvedValue({ isFile: () => true });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runAttach', () => {
  it('uploads each file sequentially and aggregates results', async () => {
    uploadAttachmentMock
      .mockResolvedValueOnce([{ id: 'a1', filename: 'a.png', size: 10 }])
      .mockResolvedValueOnce([{ id: 'b1', filename: 'b.txt', size: 5 }]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAttach({
      issueKey: 'PROJ-1',
      files: ['./a.png', './b.txt'],
      json: true,
    });
    expect(uploadAttachmentMock).toHaveBeenCalledTimes(2);
    expect(uploadAttachmentMock).toHaveBeenNthCalledWith(1, 'PROJ-1', './a.png');
    expect(uploadAttachmentMock).toHaveBeenNthCalledWith(2, 'PROJ-1', './b.txt');
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.issueKey).toBe('PROJ-1');
    expect(parsed.attachments).toHaveLength(2);
    expect(parsed.attachments).toEqual([
      { id: 'a1', filename: 'a.png', size: 10 },
      { id: 'b1', filename: 'b.txt', size: 5 },
    ]);
  });

  it('emits the full attachment objects Jira returns under --json', async () => {
    const created = {
      id: '99021',
      self: 'https://x/rest/api/3/attachment/99021',
      filename: 'a.png',
      size: 10,
      mimeType: 'image/png',
      created: '2026-07-21T13:24:22.000+0200',
      content: 'https://x/rest/api/3/attachment/content/99021',
      thumbnail: 'https://x/rest/api/3/attachment/thumbnail/99021',
      author: { accountId: 'acc-1', displayName: 'Jane Doe' },
    };
    uploadAttachmentMock.mockResolvedValueOnce([created]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAttach({ issueKey: 'PROJ-1', files: ['./a.png'], json: true });
    const parsed = JSON.parse(writes.join(''));
    expect(parsed).toEqual({ issueKey: 'PROJ-1', attachments: [created] });
  });

  it('auto-emits JSON when stdout is not a TTY', async () => {
    uploadAttachmentMock.mockResolvedValueOnce([{ id: 'a1', filename: 'a.png', size: 10 }]);
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    await runAttach({ issueKey: 'PROJ-1', files: ['./a.png'] });
    expect(logs).toEqual([]);
    expect(JSON.parse(writes.join('')).attachments[0].id).toBe('a1');
  });

  it('does NOT call uploadAttachment on --dry-run and reports the resolved org', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAttach({
      issueKey: 'PROJ-1',
      files: ['./a.png'],
      dryRun: true,
      json: true,
    });
    expect(uploadAttachmentMock).not.toHaveBeenCalled();
    expect(statMock).toHaveBeenCalledWith('./a.png');
    const parsed = JSON.parse(writes.join(''));
    expect(parsed).toEqual({ dryRun: true, org: 'solo', issueKey: 'PROJ-1', files: ['./a.png'] });
  });

  it('shows the resolved org in the human-readable --dry-run output', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAttach({ issueKey: 'PROJ-1', files: ['./a.png'], dryRun: true });
    const out = logs.join('\n');
    expect(out).toContain('in org "solo"');
    expect(out).toContain('./a.png');
  });

  it('errors clearly when a file is missing (ENOENT) on --dry-run', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    statMock.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'ENOENT' }));
    await expect(
      runAttach({ issueKey: 'PROJ-1', files: ['./missing.png'], dryRun: true })
    ).rejects.toThrow(/File not found: \.\/missing\.png/);
    expect(uploadAttachmentMock).not.toHaveBeenCalled();
  });

  it('prints per-attachment summary on TTY', async () => {
    uploadAttachmentMock.mockResolvedValueOnce([
      { id: 'a1', filename: 'a.png', size: 10 },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAttach({ issueKey: 'PROJ-1', files: ['./a.png'] });
    const out = logs.join('\n');
    expect(out).toContain('Uploaded 1 attachment(s)');
    expect(out).toContain('[a1] a.png (10b)');
  });
});

describe('runAttachRemove', () => {
  it('deletes by numeric attachment id when -o is given', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAttachRemove({ target: '99021', org: 'acme' });
    expect(deleteAttachmentMock).toHaveBeenCalledWith('99021');
  });

  it('errors about the org when a bare numeric id is given without -o (no API calls)', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await expect(
      runAttachRemove({ target: '99021', dryRun: true, json: true })
    ).rejects.toThrow(/Cannot infer org from attachment id 99021.*-o/s);
    expect(deleteAttachmentMock).not.toHaveBeenCalled();
    expect(getAttachmentMetaMock).not.toHaveBeenCalled();
  });

  it('infers the org from an org/id prefix on a numeric target', async () => {
    getAttachmentMetaMock.mockResolvedValueOnce({
      id: '99021',
      filename: 'shot.png',
      size: 42,
      author: 'Jane',
    });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAttachRemove({ target: 'acme/99021', dryRun: true, json: true });
    expect(getAttachmentMetaMock).toHaveBeenCalledWith('99021');
    expect(JSON.parse(writes.join(''))).toEqual({
      dryRun: true,
      attachment: { id: '99021', filename: 'shot.png', size: 42, author: 'Jane' },
    });
  });

  it('previews attachment meta on by-id --dry-run when an org is given', async () => {
    getAttachmentMetaMock.mockResolvedValueOnce({
      id: '99021',
      filename: 'shot.png',
      size: 42,
      author: 'Jane',
    });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAttachRemove({ target: '99021', org: 'acme', dryRun: true, json: true });
    expect(deleteAttachmentMock).not.toHaveBeenCalled();
    expect(getAttachmentMetaMock).toHaveBeenCalledWith('99021');
    expect(JSON.parse(writes.join(''))).toEqual({
      dryRun: true,
      attachment: { id: '99021', filename: 'shot.png', size: 42, author: 'Jane' },
    });
  });

  it('emits {attachmentId, removed:true} when --json after success', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAttachRemove({ target: '99021', org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual({ attachmentId: '99021', removed: true });
  });

  it('removes by issue-key + filename, resolving the id via fetchIssueDetails', async () => {
    fetchIssueDetailsMock.mockResolvedValueOnce({
      attachments: [
        { id: '100', filename: 'a.png', url: 'u', size: 1 },
        { id: '200', filename: 'report.pdf', url: 'u', size: 2 },
      ],
    });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAttachRemove({ target: 'PROJ-1', filename: 'report.pdf', json: true });
    expect(fetchIssueDetailsMock).toHaveBeenCalledWith('PROJ-1', expect.objectContaining({
      includeComments: false,
      includeChangelog: false,
    }));
    expect(deleteAttachmentMock).toHaveBeenCalledWith('200');
    expect(JSON.parse(writes.join(''))).toEqual({ attachmentId: '200', removed: true });
  });

  it('errors clearly, listing available filenames, for an issue-key target without a filename', async () => {
    fetchIssueDetailsMock.mockResolvedValueOnce({
      attachments: [
        { id: '100', filename: 'a.png', url: 'u', size: 1 },
        { id: '200', filename: 'report.pdf', url: 'u', size: 2 },
      ],
    });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await expect(
      runAttachRemove({ target: 'PROJ-1' })
    ).rejects.toThrow(/A filename is required to remove an attachment from PROJ-1.*a\.png.*report\.pdf/s);
    expect(deleteAttachmentMock).not.toHaveBeenCalled();
  });

  it('throws with the available filenames when the named attachment is absent', async () => {
    fetchIssueDetailsMock.mockResolvedValueOnce({
      attachments: [{ id: '100', filename: 'a.png', url: 'u', size: 1 }],
    });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await expect(
      runAttachRemove({ target: 'PROJ-1', filename: 'missing.pdf' })
    ).rejects.toThrow(/No attachment named "missing.pdf".*a\.png/s);
    expect(deleteAttachmentMock).not.toHaveBeenCalled();
  });

  it('throws listing the matching ids when the filename is ambiguous', async () => {
    fetchIssueDetailsMock.mockResolvedValueOnce({
      attachments: [
        { id: '100', filename: 'report.pdf', url: 'u', size: 1 },
        { id: '200', filename: 'report.pdf', url: 'u', size: 2 },
      ],
    });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await expect(
      runAttachRemove({ target: 'PROJ-1', filename: 'report.pdf' })
    ).rejects.toThrow(/Multiple attachments named "report.pdf".*100.*200/s);
    expect(deleteAttachmentMock).not.toHaveBeenCalled();
  });

  it('previews meta on issue-key + filename --dry-run without deleting', async () => {
    fetchIssueDetailsMock.mockResolvedValueOnce({
      attachments: [{ id: '200', filename: 'report.pdf', url: 'u', size: 2 }],
    });
    getAttachmentMetaMock.mockResolvedValueOnce({
      id: '200',
      filename: 'report.pdf',
      size: 2048,
      mimeType: 'application/pdf',
    });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAttachRemove({ target: 'PROJ-1', filename: 'report.pdf', dryRun: true, json: true });
    expect(deleteAttachmentMock).not.toHaveBeenCalled();
    expect(getAttachmentMetaMock).toHaveBeenCalledWith('200');
    expect(JSON.parse(writes.join(''))).toEqual({
      dryRun: true,
      attachment: { id: '200', filename: 'report.pdf', size: 2048, mimeType: 'application/pdf' },
    });
  });
});
