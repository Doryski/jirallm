import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    apiToken: 'tok',
  })),
  findOrgsByProjectKey: vi.fn(() => ['solo']),
}));

const editIssueMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    editIssue = editIssueMock;
  },
}));

import { runEdit } from './edit.js';

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;
let tmp: string;

beforeEach(async () => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  editIssueMock.mockReset();
  editIssueMock.mockResolvedValue(undefined);
  tmp = await mkdtemp(join(tmpdir(), 'jirallm-edit-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
  await rm(tmp, { recursive: true, force: true });
});

describe('runEdit', () => {
  it('maps --unassign to assigneeAccountId: null', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', unassign: true });
    expect(editIssueMock).toHaveBeenCalledWith('PROJ-1', expect.objectContaining({
      assigneeAccountId: null,
    }));
  });

  it('passes assignee accountId when --assignee provided', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', assignee: 'acc-7' });
    expect(editIssueMock.mock.calls[0][1].assigneeAccountId).toBe('acc-7');
  });

  it('parses comma-separated labels', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', labels: ' a , b , c ' });
    expect(editIssueMock.mock.calls[0][1].labels).toEqual(['a', 'b', 'c']);
  });

  it('reads description from file when --description-file', async () => {
    const path = join(tmp, 'd.md');
    await writeFile(path, 'content');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', descriptionFile: path });
    expect(editIssueMock.mock.calls[0][1].descriptionMarkdown).toBe('content');
  });

  it('does NOT call editIssue on --dry-run; emits JSON when requested', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', summary: 'new', dryRun: true, json: true });
    expect(editIssueMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.dryRun).toBe(true);
    expect(parsed.issueKey).toBe('PROJ-1');
    expect(parsed.fields.summary).toBe('new');
  });

  it('emits {issueKey, updated:true} when --json after success', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runEdit({ issueKey: 'PROJ-1', summary: 'x', json: true });
    expect(JSON.parse(writes.join(''))).toEqual({ issueKey: 'PROJ-1', updated: true });
  });
});
