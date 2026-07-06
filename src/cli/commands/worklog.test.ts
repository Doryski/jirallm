import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let stdinInput = '';
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    readFileSync: vi.fn((fd: unknown, enc: unknown) => {
      if (fd === 0) return stdinInput;
      return actual.readFileSync(fd as never, enc as never);
    }),
  };
});

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x.atlassian.net', userEmail: 'u@x' },
    apiToken: 'tok',
  })),
  findOrgsByProjectKey: vi.fn((projectKey: string) => {
    if (projectKey === 'MULTI') return ['orgA', 'orgB'];
    if (projectKey === 'NONE') return [];
    return ['solo'];
  }),
}));

const addWorklogMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    addWorklog = addWorklogMock;
  },
}));

import { runWorklog } from './worklog.js';

let logs: string[];
let errs: string[];
let originalExitCode: number | string | null | undefined;

function captureConsole() {
  logs = [];
  errs = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => {
    logs.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    errs.push(args.map(String).join(' '));
  });
}

function setStdin(input: string) {
  stdinInput = input;
}

beforeEach(() => {
  captureConsole();
  addWorklogMock.mockReset();
  originalExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
});

describe('runWorklog (dry-run)', () => {
  it('validates and prints entries without calling Jira', async () => {
    setStdin(
      JSON.stringify([
        { issueKey: 'PROJ-1', startTime: '2026-05-23T09:00:00Z', duration: '1h' },
        { issueKey: 'PROJ-2', startTime: '2026-05-23T10:00:00Z', endTime: '2026-05-23T11:30:00Z' },
      ])
    );
    await runWorklog({ org: 'solo', dryRun: true });
    expect(addWorklogMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toMatch(/2\/2 valid/);
    expect(logs.join('\n')).toMatch(/PROJ-1.*1h/);
    expect(logs.join('\n')).toMatch(/PROJ-2.*1h 30m/);
    expect(logs.join('\n')).toMatch(/dry-run/);
  });

  it('aborts when validation fails and reports all errors by index', async () => {
    setStdin(
      JSON.stringify([
        { issueKey: 'PROJ-1', startTime: '2026-05-23T09:00:00Z', duration: '1h' },
        { issueKey: 'bad-key!', duration: '30m' },
        { issueKey: 'PROJ-3', startTime: 'nope', duration: '30m' },
      ])
    );
    await expect(runWorklog({ org: 'solo', dryRun: true })).rejects.toThrow(/Aborting/);
    expect(addWorklogMock).not.toHaveBeenCalled();
    expect(errs.join('\n')).toMatch(/\[1\].*Invalid issue key/);
    expect(errs.join('\n')).toMatch(/\[2\].*startTime/);
  });

  it('aborts when org cannot be resolved', async () => {
    setStdin(
      JSON.stringify([{ issueKey: 'NONE-1', startTime: '2026-05-23T09:00:00Z', duration: '1h' }])
    );
    await expect(runWorklog({ dryRun: true })).rejects.toThrow();
    expect(errs.join('\n')).toMatch(/not found in any configured org/);
  });

  it('aborts when project is ambiguous across orgs', async () => {
    setStdin(
      JSON.stringify([{ issueKey: 'MULTI-1', startTime: '2026-05-23T09:00:00Z', duration: '1h' }])
    );
    await expect(runWorklog({ dryRun: true })).rejects.toThrow();
    expect(errs.join('\n')).toMatch(/multiple orgs/);
  });

  it('uses org/ prefix when present', async () => {
    setStdin(
      JSON.stringify([
        { issueKey: 'orgA/MULTI-1', startTime: '2026-05-23T09:00:00Z', duration: '1h' },
      ])
    );
    await runWorklog({ dryRun: true });
    expect(logs.join('\n')).toMatch(/orgA\/MULTI-1/);
  });
});

describe('runWorklog (live posting)', () => {
  it('posts each entry and prints summary', async () => {
    addWorklogMock.mockResolvedValueOnce({ id: '100', issueId: '1' });
    addWorklogMock.mockResolvedValueOnce({ id: '101', issueId: '2' });
    setStdin(
      JSON.stringify([
        { issueKey: 'PROJ-1', startTime: '2026-05-23T09:00:00Z', duration: '1h', description: '**bold**' },
        { issueKey: 'PROJ-2', startTime: '2026-05-23T10:00:00Z', endTime: '2026-05-23T10:30:00Z' },
      ])
    );
    await runWorklog({ org: 'solo' });

    expect(addWorklogMock).toHaveBeenCalledTimes(2);
    const [key1, payload1] = addWorklogMock.mock.calls[0];
    expect(key1).toBe('PROJ-1');
    expect(payload1.timeSpentSeconds).toBe(3600);
    expect(payload1.comment).toBe('*bold*'); // markdown → wiki
    expect(payload1.started).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/);

    const [key2, payload2] = addWorklogMock.mock.calls[1];
    expect(key2).toBe('PROJ-2');
    expect(payload2.timeSpentSeconds).toBe(1800);
    expect(payload2.comment).toBeUndefined();

    expect(logs.join('\n')).toMatch(/Summary: 2 posted, 0 failed/);
    expect(process.exitCode).toBe(0);
  });

  it('preserves description as-is when --no-wiki', async () => {
    addWorklogMock.mockResolvedValueOnce({ id: '1', issueId: 'i' });
    setStdin(
      JSON.stringify([
        { issueKey: 'PROJ-1', startTime: '2026-05-23T09:00:00Z', duration: '1h', description: '**bold**' },
      ])
    );
    await runWorklog({ org: 'solo', noWiki: true });
    expect(addWorklogMock.mock.calls[0][1].comment).toBe('**bold**');
  });

  it('continues on per-entry failure and exits non-zero', async () => {
    addWorklogMock.mockResolvedValueOnce({ id: '100', issueId: '1' });
    addWorklogMock.mockRejectedValueOnce(new Error('403 Forbidden'));
    addWorklogMock.mockResolvedValueOnce({ id: '102', issueId: '3' });
    setStdin(
      JSON.stringify([
        { issueKey: 'PROJ-1', startTime: '2026-05-23T09:00:00Z', duration: '1h' },
        { issueKey: 'PROJ-2', startTime: '2026-05-23T10:00:00Z', duration: '1h' },
        { issueKey: 'PROJ-3', startTime: '2026-05-23T11:00:00Z', duration: '1h' },
      ])
    );
    await runWorklog({ org: 'solo' });

    expect(addWorklogMock).toHaveBeenCalledTimes(3);
    expect(logs.join('\n')).toMatch(/✗.*PROJ-2.*403 Forbidden/);
    expect(logs.join('\n')).toMatch(/Summary: 2 posted, 1 failed/);
    expect(process.exitCode).toBe(1);
  });

  it('passes visibility through', async () => {
    addWorklogMock.mockResolvedValueOnce({ id: '1', issueId: 'i' });
    setStdin(
      JSON.stringify([
        {
          issueKey: 'PROJ-1',
          startTime: '2026-05-23T09:00:00Z',
          duration: '1h',
          visibility: { type: 'role', value: 'Developers' },
        },
      ])
    );
    await runWorklog({ org: 'solo' });
    expect(addWorklogMock.mock.calls[0][1].visibility).toEqual({
      type: 'role',
      value: 'Developers',
    });
  });

  it('caches JiraClient per org', async () => {
    addWorklogMock.mockResolvedValue({ id: '1', issueId: 'i' });
    const { loadProfile } = await import('../../lib/config.js');
    const loadProfileMock = vi.mocked(loadProfile);
    loadProfileMock.mockClear();
    setStdin(
      JSON.stringify([
        { issueKey: 'PROJ-1', startTime: '2026-05-23T09:00:00Z', duration: '1h' },
        { issueKey: 'PROJ-2', startTime: '2026-05-23T10:00:00Z', duration: '1h' },
        { issueKey: 'PROJ-3', startTime: '2026-05-23T11:00:00Z', duration: '1h' },
      ])
    );
    await runWorklog({ org: 'solo' });
    expect(loadProfileMock).toHaveBeenCalledTimes(1);
  });
});

describe('runWorklog positional quick-log', () => {
  it('builds a single-entry array from issueKey + duration (dry-run)', async () => {
    setStdin('');
    await runWorklog({ org: 'solo', issueKey: 'PROJ-9', duration: '45m', dryRun: true });
    expect(addWorklogMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toMatch(/1\/1 valid/);
    expect(logs.join('\n')).toMatch(/PROJ-9.*45m/);
  });

  it('posts the quick-log entry live', async () => {
    addWorklogMock.mockResolvedValueOnce({ id: '900', issueId: '9' });
    setStdin('');
    await runWorklog({ org: 'solo', issueKey: 'PROJ-9', duration: '1h' });
    expect(addWorklogMock).toHaveBeenCalledTimes(1);
    const [key, payload] = addWorklogMock.mock.calls[0];
    expect(key).toBe('PROJ-9');
    expect(payload.timeSpentSeconds).toBe(3600);
    expect(logs.join('\n')).toMatch(/Summary: 1 posted, 0 failed/);
  });
});

describe('runWorklog --json', () => {
  it('emits dry-run JSON shape', async () => {
    setStdin(
      JSON.stringify([{ issueKey: 'PROJ-1', startTime: '2026-05-23T09:00:00Z', duration: '1h' }])
    );
    await runWorklog({ org: 'solo', dryRun: true, json: true });
    expect(addWorklogMock).not.toHaveBeenCalled();
    const out = JSON.parse(logs.join('\n'));
    expect(out.dryRun).toBe(true);
    expect(out.ok).toBe(true);
    expect(out.worklogs).toHaveLength(1);
    expect(out.worklogs[0]).toMatchObject({
      index: 0,
      org: 'solo',
      issueKey: 'PROJ-1',
      durationSeconds: 3600,
    });
    expect(out.worklogs[0].started).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('emits live JSON shape with summary', async () => {
    addWorklogMock.mockResolvedValueOnce({ id: '100', issueId: '1' });
    setStdin(
      JSON.stringify([{ issueKey: 'PROJ-1', startTime: '2026-05-23T09:00:00Z', duration: '1h' }])
    );
    await runWorklog({ org: 'solo', json: true });
    const out = JSON.parse(logs.join('\n'));
    expect(out.dryRun).toBe(false);
    expect(out.ok).toBe(true);
    expect(out.summary).toEqual({ posted: 1, failed: 0 });
    expect(out.worklogs[0]).toMatchObject({ ok: true, id: '100', issueKey: 'PROJ-1' });
  });

  it('emits validation errors as JSON and aborts', async () => {
    setStdin(JSON.stringify([{ issueKey: 'bad-key!', duration: '30m' }]));
    await expect(runWorklog({ org: 'solo', json: true })).rejects.toThrow(/Aborting/);
    const out = JSON.parse(logs.join('\n'));
    expect(out.ok).toBe(false);
    expect(out.errors[0].index).toBe(0);
  });
});

describe('runWorklog input handling', () => {
  it('rejects empty input', async () => {
    setStdin('');
    await expect(runWorklog({})).rejects.toThrow(/Empty input/);
  });

  it('rejects invalid JSON', async () => {
    setStdin('not json');
    await expect(runWorklog({})).rejects.toThrow(/Invalid JSON/);
  });

  it('rejects non-array input', async () => {
    setStdin(JSON.stringify({ issueKey: 'PROJ-1' }));
    await expect(runWorklog({})).rejects.toThrow(/array/);
  });

  it('rejects empty array', async () => {
    setStdin('[]');
    await expect(runWorklog({})).rejects.toThrow(/No worklog entries/);
  });
});
