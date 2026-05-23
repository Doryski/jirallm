import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    project: { key: 'PROJ' },
    apiToken: 'tok',
  })),
}));

const createIssueMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    createIssue = createIssueMock;
  },
}));

import { runCreate } from './create.js';

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;
let tmp: string;

beforeEach(async () => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  createIssueMock.mockReset();
  createIssueMock.mockResolvedValue({ id: '100', key: 'PROJ-99', self: 'https://x' });
  tmp = await mkdtemp(join(tmpdir(), 'jirallm-create-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
  await rm(tmp, { recursive: true, force: true });
});

describe('runCreate', () => {
  it('parses comma-separated labels and forwards all fields', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({
      org: 'acme',
      projectKey: 'PROJ',
      type: 'Bug',
      summary: 'Crash',
      description: '**hi**',
      assignee: 'acc-1',
      labels: 'a, b , c',
      priority: 'High',
      parent: 'PROJ-1',
    });
    expect(createIssueMock).toHaveBeenCalledWith({
      projectKey: 'PROJ',
      issueType: 'Bug',
      summary: 'Crash',
      descriptionMarkdown: '**hi**',
      assigneeAccountId: 'acc-1',
      labels: ['a', 'b', 'c'],
      priority: 'High',
      parentKey: 'PROJ-1',
    });
    expect(logs.join('\n')).toContain('✓ Created PROJ-99');
  });

  it('reads description from --description-file', async () => {
    const path = join(tmp, 'desc.md');
    await writeFile(path, '**from file**');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Task', summary: 's', descriptionFile: path });
    expect(createIssueMock.mock.calls[0][0].descriptionMarkdown).toBe('**from file**');
  });

  it('falls back to profile project key when --project not provided', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Task', summary: 's' });
    expect(createIssueMock.mock.calls[0][0].projectKey).toBe('PROJ');
  });

  it('does NOT call createIssue on --dry-run; emits JSON when requested', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Task', summary: 's', dryRun: true, json: true });
    expect(createIssueMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(writes.join(''));
    expect(parsed.dryRun).toBe(true);
    expect(parsed.input.summary).toBe('s');
  });

  it('emits creation result JSON when --json (no dry run)', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Task', summary: 's', json: true });
    expect(JSON.parse(writes.join(''))).toEqual({
      id: '100',
      key: 'PROJ-99',
      self: 'https://x',
    });
  });

  it('passes undefined description when neither flag provided', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runCreate({ org: 'acme', type: 'Task', summary: 's' });
    expect(createIssueMock.mock.calls[0][0].descriptionMarkdown).toBeUndefined();
  });
});
