import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    apiToken: 'tok',
  })),
  findOrgsByProjectKey: vi.fn(() => ['solo']),
}));

const linkIssuesMock = vi.fn();
const removeIssueLinkMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    linkIssues = linkIssuesMock;
    removeIssueLink = removeIssueLinkMock;
  },
}));

import { runLink, runLinkRemove } from './link.js';

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  linkIssuesMock.mockReset();
  removeIssueLinkMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runLink', () => {
  it('forwards inward/outward/type/comment to client', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLink({
      inwardKey: 'PROJ-1',
      outwardKey: 'PROJ-2',
      type: 'Blocks',
      comment: 'because',
    });
    expect(linkIssuesMock).toHaveBeenCalledWith('PROJ-1', 'PROJ-2', 'Blocks', 'because');
  });

  it('does NOT call linkIssues on --dry-run', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLink({
      inwardKey: 'PROJ-1',
      outwardKey: 'PROJ-2',
      type: 'Blocks',
      dryRun: true,
      json: true,
    });
    expect(linkIssuesMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(writes.join(''));
    expect(parsed).toEqual({
      dryRun: true,
      type: 'Blocks',
      inwardIssue: 'PROJ-1',
      outwardIssue: 'PROJ-2',
      comment: undefined,
    });
  });

  it('emits link record JSON when --json after success', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLink({
      inwardKey: 'PROJ-1',
      outwardKey: 'PROJ-2',
      type: 'Blocks',
      json: true,
    });
    expect(JSON.parse(writes.join(''))).toEqual({
      inwardIssue: 'PROJ-1',
      outwardIssue: 'PROJ-2',
      type: 'Blocks',
    });
  });
});

describe('runLinkRemove', () => {
  it('calls removeIssueLink with the linkId', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLinkRemove({ linkId: '10042', org: 'acme' });
    expect(removeIssueLinkMock).toHaveBeenCalledWith('10042');
  });

  it('does NOT call removeIssueLink on --dry-run', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLinkRemove({ linkId: '10042', org: 'acme', dryRun: true, json: true });
    expect(removeIssueLinkMock).not.toHaveBeenCalled();
    expect(JSON.parse(writes.join(''))).toEqual({ dryRun: true, linkId: '10042' });
  });

  it('emits {linkId, removed:true} on success when --json', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLinkRemove({ linkId: '10042', org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual({ linkId: '10042', removed: true });
  });
});
