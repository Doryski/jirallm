import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadOrgProfileMock = vi.fn(async () => ({
  org: { name: 'acme', projects: {} },
  config: { baseUrl: 'https://x', userEmail: 'u@x' },
  apiToken: 'tok',
}));
vi.mock('../../lib/config.js', () => ({
  loadOrgProfile: (...args: unknown[]) => loadOrgProfileMock(...(args as [])),
}));

const listLinkTypesMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    listLinkTypes = listLinkTypesMock;
  },
}));

import { runLinkTypes } from './linktypes.js';

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  listLinkTypesMock.mockReset();
  loadOrgProfileMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runLinkTypes', () => {
  it('emits raw array as JSON', async () => {
    const types = [{ id: '1', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }];
    listLinkTypesMock.mockResolvedValue(types);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLinkTypes({ org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual(types);
  });

  it('prints name + inward + outward labels on TTY', async () => {
    listLinkTypesMock.mockResolvedValue([
      { id: '1', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLinkTypes({ org: 'acme' });
    const out = logs.join('\n');
    expect(out).toContain('Blocks');
    expect(out).toContain('inward="is blocked by"');
    expect(out).toContain('outward="blocks"');
  });

  it('prints "No link types defined." on empty', async () => {
    listLinkTypesMock.mockResolvedValue([]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLinkTypes({ org: 'acme' });
    expect(logs.join('\n')).toContain('No link types defined.');
  });

  it('works without a project via loadOrgProfile', async () => {
    listLinkTypesMock.mockResolvedValue([
      { id: '1', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLinkTypes({ org: 'acme' });
    expect(loadOrgProfileMock).toHaveBeenCalledWith({ org: 'acme' });
  });
});
