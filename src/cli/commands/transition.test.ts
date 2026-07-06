import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    apiToken: 'tok',
  })),
  findOrgsByProjectKey: vi.fn(() => ['solo']),
  readConfig: vi.fn(() => ({ orgs: { solo: { base_url: 'https://x' } } })),
}));

const transitions = [
  { id: '11', name: 'Start Review', to: { name: 'In Review' } },
  { id: '21', name: 'Finish', to: { name: 'Done' } },
];

const postMock = vi.fn();
const getIssueTransitionsMock = vi.fn(async () => transitions);

const resolveTransition = (targetStatus: string) => {
  const target = targetStatus.toLowerCase();
  const match =
    transitions.find((t) => t.to.name.toLowerCase() === target) ??
    transitions.find((t) => t.name.toLowerCase() === target);
  if (!match) throw new Error(`No transition to "${targetStatus}"`);
  return { id: match.id, name: match.name, toName: match.to.name };
};

const transitionIssueMock = vi.fn(
  async (_issueKey: string, targetStatus: string, opts: { dryRun?: boolean } = {}) => {
    const match = resolveTransition(targetStatus);
    if (!opts.dryRun) postMock(match.id);
    return { id: match.id, name: match.name };
  }
);

vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    getIssueTransitions = getIssueTransitionsMock;
    transitionIssue = transitionIssueMock;
  },
}));

import { runTransition } from './transition.js';

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  vi.spyOn(console, 'log').mockImplementation((...a) => {
    logs.push(a.map(String).join(' '));
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    writes.push(String(c));
    return true;
  });
  postMock.mockReset();
  getIssueTransitionsMock.mockClear();
  transitionIssueMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runTransition', () => {
  it('does NOT POST on --dry-run but reports the resolved transition', async () => {
    await runTransition('PROJ-1', { to: 'Done', dryRun: true });
    expect(transitionIssueMock).toHaveBeenCalledWith('PROJ-1', 'Done', { dryRun: true });
    expect(postMock).not.toHaveBeenCalled();
    const out = logs.join('\n');
    expect(out).toContain('[dry-run]');
    expect(out).toContain('Finish');
  });

  it('emits dryRun JSON without POSTing', async () => {
    await runTransition('PROJ-1', { to: 'Done', dryRun: true, json: true });
    expect(postMock).not.toHaveBeenCalled();
    expect(JSON.parse(writes.join(''))).toEqual({
      issueKey: 'PROJ-1',
      transition: { id: '21', name: 'Finish' },
      to: 'Done',
      dryRun: true,
    });
  });

  it('matches the target status case-insensitively', async () => {
    await runTransition('PROJ-1', { to: 'in review' });
    expect(postMock).toHaveBeenCalledWith('11');
    expect(logs.join('\n')).toContain('Start Review');
  });

  it('performs the transition (POSTs) when not a dry run', async () => {
    await runTransition('PROJ-1', { to: 'Done' });
    expect(postMock).toHaveBeenCalledWith('21');
    expect(logs.join('\n')).toContain('✓');
  });

  it('lists available transitions with both name and to.name', async () => {
    await runTransition('PROJ-1', { to: '', list: true });
    expect(transitionIssueMock).not.toHaveBeenCalled();
    const out = logs.join('\n');
    expect(out).toContain('"Start Review" → "In Review"');
    expect(out).toContain('"Finish" → "Done"');
  });

  it('emits transitions JSON on --list --json', async () => {
    await runTransition('PROJ-1', { to: '', list: true, json: true });
    expect(JSON.parse(writes.join(''))).toEqual({ issueKey: 'PROJ-1', transitions });
  });
});
