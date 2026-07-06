import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadOrgProfileMock = vi.fn(async (..._args: unknown[]) => ({
  config: { baseUrl: 'https://x', userEmail: 'u@x' },
  org: { name: 'acme' },
  apiToken: 'tok',
}));
vi.mock('../../lib/config.js', () => ({
  loadOrgProfile: (...args: unknown[]) => loadOrgProfileMock(...args),
}));

const listSprintsMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    listSprints = listSprintsMock;
  },
}));

import { runSprints } from './sprints.js';

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  listSprintsMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runSprints', () => {
  it('parses boardId to number and forwards state filter', async () => {
    listSprintsMock.mockResolvedValue({ values: [], startAt: 0, maxResults: 50, isLast: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runSprints({ boardId: '42', org: 'acme', state: 'active', limit: '10' });
    expect(listSprintsMock).toHaveBeenCalledWith(42, {
      state: 'active',
      limit: 10,
      startAt: undefined,
    });
  });

  it('loads org profile without a project (board id only)', async () => {
    listSprintsMock.mockResolvedValue({ values: [], startAt: 0, maxResults: 50, isLast: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runSprints({ boardId: '7', org: 'acme' });
    expect(loadOrgProfileMock).toHaveBeenCalledWith({ org: 'acme' });
    expect(listSprintsMock).toHaveBeenCalledWith(7, {
      state: undefined,
      limit: undefined,
      startAt: undefined,
    });
  });

  it('throws on non-numeric boardId', async () => {
    await expect(runSprints({ boardId: 'abc', org: 'acme' })).rejects.toThrow(/Invalid board ID/);
  });

  it('emits page JSON when --json', async () => {
    const page = {
      values: [{ id: 99, self: 's', name: 'Sprint 99', state: 'active' }],
      startAt: 0,
      maxResults: 50,
      isLast: true,
    };
    listSprintsMock.mockResolvedValue(page);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runSprints({ boardId: '1', org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual(page);
  });

  it('prints "[id] name (state)" lines on TTY', async () => {
    listSprintsMock.mockResolvedValue({
      values: [{ id: 99, self: 's', name: 'Sprint 99', state: 'active' }],
      startAt: 0,
      maxResults: 50,
      isLast: true,
    });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runSprints({ boardId: '1', org: 'acme' });
    expect(logs.join('\n')).toContain('[99] Sprint 99 (active)');
  });
});
