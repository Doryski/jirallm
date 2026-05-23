import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    apiToken: 'tok',
  })),
  findOrgsByProjectKey: vi.fn(() => ['solo']),
}));

const uploadAttachmentMock = vi.fn();
const deleteAttachmentMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    uploadAttachment = uploadAttachmentMock;
    deleteAttachment = deleteAttachmentMock;
  },
}));

import { runAttach, runAttachRemove } from './attach.js';

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
  });

  it('does NOT call uploadAttachment on --dry-run', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAttach({
      issueKey: 'PROJ-1',
      files: ['./a.png'],
      dryRun: true,
      json: true,
    });
    expect(uploadAttachmentMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(writes.join(''));
    expect(parsed).toEqual({ dryRun: true, issueKey: 'PROJ-1', files: ['./a.png'] });
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
  it('calls deleteAttachment with the id', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAttachRemove({ attachmentId: 'att-9', org: 'acme' });
    expect(deleteAttachmentMock).toHaveBeenCalledWith('att-9');
  });

  it('does NOT call deleteAttachment on --dry-run', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAttachRemove({ attachmentId: 'att-9', org: 'acme', dryRun: true, json: true });
    expect(deleteAttachmentMock).not.toHaveBeenCalled();
    expect(JSON.parse(writes.join(''))).toEqual({ dryRun: true, attachmentId: 'att-9' });
  });

  it('emits {attachmentId, removed:true} when --json after success', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runAttachRemove({ attachmentId: 'att-9', org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual({ attachmentId: 'att-9', removed: true });
  });
});
