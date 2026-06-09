import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    project: { key: 'PROJ' },
    apiToken: 'tok',
  })),
}));

const listComponentsMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    listComponents = listComponentsMock;
  },
}));

import { runComponents } from './components.js';

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  listComponentsMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runComponents', () => {
  it('falls back to profile.project.key when --project not provided', async () => {
    listComponentsMock.mockResolvedValue([]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runComponents({ org: 'acme' });
    expect(listComponentsMock).toHaveBeenCalledWith('PROJ');
  });

  it('uses explicit --project override', async () => {
    listComponentsMock.mockResolvedValue([]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runComponents({ org: 'acme', project: 'OTHER' });
    expect(listComponentsMock).toHaveBeenCalledWith('OTHER');
  });

  it('prints names with descriptions on TTY', async () => {
    listComponentsMock.mockResolvedValue([
      { id: '1', name: 'Web', description: 'Frontend' },
      { id: '2', name: 'API' },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runComponents({ org: 'acme' });
    const out = logs.join('\n');
    expect(out).toContain('Web — Frontend');
    expect(out).toContain('API');
  });

  it('emits raw array as JSON', async () => {
    const components = [{ id: '1', name: 'Web' }];
    listComponentsMock.mockResolvedValue(components);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runComponents({ org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual(components);
  });
});
