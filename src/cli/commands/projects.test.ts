import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadOrgProfile: vi.fn(async () => ({
    org: {
      name: 'acme',
      projects: { PROJ: { key: 'PROJ' }, DOCS: { key: 'DOCS' } },
    },
    config: { baseUrl: 'https://x', userEmail: 'u@x' },
    apiToken: 'tok',
  })),
}));

const listProjectsMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    listProjects = listProjectsMock;
  },
}));

import { loadOrgProfile } from '../../lib/config.js';
import { runProjects } from './projects.js';

const loadOrgProfileMock = vi.mocked(loadOrgProfile);

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  listProjectsMock.mockReset();
  loadOrgProfileMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runProjects', () => {
  it('forwards query/limit/startAt as parsed numbers', async () => {
    listProjectsMock.mockResolvedValue({ values: [], startAt: 0, maxResults: 50, isLast: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runProjects({ org: 'acme', query: 'foo', limit: '25', startAt: '50' });
    expect(listProjectsMock).toHaveBeenCalledWith({ query: 'foo', limit: 25, startAt: 50 });
  });

  it('emits the raw page JSON when --json', async () => {
    const page = {
      values: [{ id: '1', key: 'PROJ', name: 'Proj' }],
      startAt: 0,
      maxResults: 50,
      isLast: true,
    };
    listProjectsMock.mockResolvedValue(page);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runProjects({ org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual(page);
  });

  it('lists projects human-readably with key+name on TTY', async () => {
    listProjectsMock.mockResolvedValue({
      values: [
        { id: '1', key: 'PROJ', name: 'Proj' },
        { id: '2', key: 'DOCS', name: 'Docs' },
      ],
      startAt: 0,
      maxResults: 50,
      isLast: true,
    });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runProjects({ org: 'acme' });
    expect(logs.join('\n')).toContain('2 project(s):');
    expect(logs.join('\n')).toContain('PROJ');
    expect(logs.join('\n')).toContain('Proj');
    expect(logs.join('\n')).toContain('DOCS');
  });

  it('succeeds for a multi-project org with no -P (never requires a project)', async () => {
    listProjectsMock.mockResolvedValue({
      values: [
        { id: '1', key: 'PROJ', name: 'Proj' },
        { id: '2', key: 'DOCS', name: 'Docs' },
      ],
      startAt: 0,
      maxResults: 50,
      isLast: true,
    });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runProjects({ org: 'acme' });
    expect(loadOrgProfileMock).toHaveBeenCalledWith({ org: 'acme' });
    expect(logs.join('\n')).toContain('2 project(s):');
  });

  it('prints "No projects found." when empty', async () => {
    listProjectsMock.mockResolvedValue({ values: [], startAt: 0, maxResults: 50, isLast: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runProjects({ org: 'acme' });
    expect(logs.join('\n')).toContain('No projects found.');
  });
});
