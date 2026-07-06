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
const listLinkTypesMock = vi.fn(async () => [
  { id: '1', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
  { id: '2', name: 'Relates', inward: 'relates to', outward: 'relates to' },
]);
const fetchIssueDetailsMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    linkIssues = linkIssuesMock;
    removeIssueLink = removeIssueLinkMock;
    listLinkTypes = listLinkTypesMock;
    fetchIssueDetails = fetchIssueDetailsMock;
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
  fetchIssueDetailsMock.mockReset();
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

  it('resolves the link type case-insensitively', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLink({ inwardKey: 'PROJ-1', outwardKey: 'PROJ-2', type: 'blocks' });
    expect(linkIssuesMock).toHaveBeenCalledWith('PROJ-1', 'PROJ-2', 'Blocks', undefined);
  });

  it('swaps direction when matching the inward label', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLink({ inwardKey: 'PROJ-1', outwardKey: 'PROJ-2', type: 'is blocked by' });
    expect(linkIssuesMock).toHaveBeenCalledWith('PROJ-2', 'PROJ-1', 'Blocks', undefined);
  });

  it('lists valid type names and throws on an unknown type', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await expect(
      runLink({ inwardKey: 'PROJ-1', outwardKey: 'PROJ-2', type: 'nope' })
    ).rejects.toThrow(/Unknown link type "nope".*Blocks, Relates/s);
    expect(linkIssuesMock).not.toHaveBeenCalled();
  });

  it('validates the type in --dry-run and does NOT call linkIssues', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLink({
      inwardKey: 'PROJ-1',
      outwardKey: 'PROJ-2',
      type: 'blocks',
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

  it('rejects an unknown type in --dry-run', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await expect(
      runLink({ inwardKey: 'PROJ-1', outwardKey: 'PROJ-2', type: 'nope', dryRun: true })
    ).rejects.toThrow(/Unknown link type/);
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
  it('calls removeIssueLink with a bare link id', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLinkRemove({ linkId: '10042', org: 'acme' });
    expect(removeIssueLinkMock).toHaveBeenCalledWith('10042');
  });

  it('does NOT call removeIssueLink on a bare-id --dry-run', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLinkRemove({ linkId: '10042', org: 'acme', dryRun: true, json: true });
    expect(removeIssueLinkMock).not.toHaveBeenCalled();
    expect(JSON.parse(writes.join(''))).toEqual({ dryRun: true, linkId: '10042' });
  });

  it('does NOT require -o in the bare-id --dry-run path', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLinkRemove({ linkId: '10042', dryRun: true, json: true });
    expect(JSON.parse(writes.join(''))).toEqual({ dryRun: true, linkId: '10042' });
  });

  it('emits {linkId, removed:true} on success when --json', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLinkRemove({ linkId: '10042', org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual({ linkId: '10042', removed: true });
  });

  it('resolves the link id from an issue key + --to and removes it', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    fetchIssueDetailsMock.mockResolvedValue({
      issueLinks: [
        { id: '555', type: 'blocks', key: 'PROJ-2', title: 'Other' },
        { id: '777', type: 'relates to', key: 'PROJ-9', title: 'Elsewhere' },
      ],
    });
    await runLinkRemove({ linkId: 'PROJ-1', to: 'PROJ-2' });
    expect(fetchIssueDetailsMock).toHaveBeenCalledWith(
      'PROJ-1',
      expect.objectContaining({ includeLinks: true })
    );
    expect(removeIssueLinkMock).toHaveBeenCalledWith('555');
  });

  it('does not require -o for the issue-key + --to dry-run and reports the resolved id', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    fetchIssueDetailsMock.mockResolvedValue({
      issueLinks: [{ id: '555', type: 'blocks', key: 'PROJ-2', title: 'Other' }],
    });
    await runLinkRemove({ linkId: 'PROJ-1', to: 'PROJ-2', dryRun: true, json: true });
    expect(removeIssueLinkMock).not.toHaveBeenCalled();
    expect(JSON.parse(writes.join(''))).toEqual({
      dryRun: true,
      linkId: '555',
      issueKey: 'PROJ-1',
      to: 'PROJ-2',
      type: 'blocks',
    });
  });

  it('includes the resolved link type in the issue-key + --to dry-run preview', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    fetchIssueDetailsMock.mockResolvedValue({
      issueLinks: [{ id: '555', type: 'blocks', key: 'PROJ-2', title: 'Other' }],
    });
    await runLinkRemove({ linkId: 'PROJ-1', to: 'PROJ-2', dryRun: true });
    expect(removeIssueLinkMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toMatch(/blocks/);
  });

  it('lists the issue links when --to is omitted', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    fetchIssueDetailsMock.mockResolvedValue({
      issueLinks: [{ id: '555', type: 'blocks', key: 'PROJ-2', title: 'Other' }],
    });
    await runLinkRemove({ linkId: 'PROJ-1', json: true });
    expect(removeIssueLinkMock).not.toHaveBeenCalled();
    expect(JSON.parse(writes.join(''))).toEqual({
      issueKey: 'PROJ-1',
      links: [{ id: '555', type: 'blocks', key: 'PROJ-2', title: 'Other' }],
    });
  });

  it('throws when no link to the --to target exists', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    fetchIssueDetailsMock.mockResolvedValue({
      issueLinks: [{ id: '555', type: 'blocks', key: 'PROJ-9', title: 'Other' }],
    });
    await expect(runLinkRemove({ linkId: 'PROJ-1', to: 'PROJ-2' })).rejects.toThrow(
      /No link from PROJ-1 to PROJ-2/
    );
  });

  it('throws with an id-based hint when multiple links share the --to target', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    fetchIssueDetailsMock.mockResolvedValue({
      issueLinks: [
        { id: '555', type: 'blocks', key: 'PROJ-2', title: 'One' },
        { id: '556', type: 'relates to', key: 'PROJ-2', title: 'Two' },
      ],
    });
    await expect(runLinkRemove({ linkId: 'PROJ-1', to: 'PROJ-2' })).rejects.toThrow(
      /Multiple links from PROJ-1 to PROJ-2.*555 \(blocks\).*556 \(relates to\).*link:rm/s
    );
    expect(removeIssueLinkMock).not.toHaveBeenCalled();
  });

  it('throws when the resolved link has no id', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    fetchIssueDetailsMock.mockResolvedValue({
      issueLinks: [{ type: 'blocks', key: 'PROJ-2', title: 'No id' }],
    });
    await expect(runLinkRemove({ linkId: 'PROJ-1', to: 'PROJ-2' })).rejects.toThrow(
      /Could not determine link id for PROJ-1 → PROJ-2/
    );
    expect(removeIssueLinkMock).not.toHaveBeenCalled();
  });

  it('emits {linkId, removed:true} when removing by issue key + --to with --json', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    fetchIssueDetailsMock.mockResolvedValue({
      issueLinks: [{ id: '555', type: 'blocks', key: 'PROJ-2', title: 'Other' }],
    });
    await runLinkRemove({ linkId: 'PROJ-1', to: 'PROJ-2', json: true });
    expect(removeIssueLinkMock).toHaveBeenCalledWith('555');
    expect(JSON.parse(writes.join(''))).toEqual({ linkId: '555', removed: true });
  });

  it('prints a human-readable confirmation when removing by issue key + --to without --json', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    fetchIssueDetailsMock.mockResolvedValue({
      issueLinks: [{ id: '555', type: 'blocks', key: 'PROJ-2', title: 'Other' }],
    });
    await runLinkRemove({ linkId: 'PROJ-1', to: 'PROJ-2' });
    expect(removeIssueLinkMock).toHaveBeenCalledWith('555');
    expect(logs.join('\n')).toContain('✓ Removed link 555 (PROJ-1 → PROJ-2)');
  });

  it('prints a no-links message when listing an issue with no links (non-json)', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    fetchIssueDetailsMock.mockResolvedValue({ issueLinks: [] });
    await runLinkRemove({ linkId: 'PROJ-1' });
    expect(logs.join('\n')).toContain('No links on PROJ-1.');
  });

  it('prints each link when listing an issue with links (non-json)', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    fetchIssueDetailsMock.mockResolvedValue({
      issueLinks: [
        { id: '555', type: 'blocks', key: 'PROJ-2', title: 'Other' },
        { type: 'relates to', key: 'PROJ-9' },
      ],
    });
    await runLinkRemove({ linkId: 'PROJ-1' });
    const out = logs.join('\n');
    expect(out).toContain('2 link(s) on PROJ-1:');
    expect(out).toContain('555  blocks → PROJ-2 (Other)');
    expect(out).toContain('?  relates to → PROJ-9');
  });

  it('throws when removing by bare id without --org', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await expect(runLinkRemove({ linkId: '10042' })).rejects.toThrow(
      /Pass --org \(-o\) to remove a link by id/
    );
    expect(removeIssueLinkMock).not.toHaveBeenCalled();
  });

  it('prints a human-readable confirmation when removing a bare id without --json', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLinkRemove({ linkId: '10042', org: 'acme' });
    expect(removeIssueLinkMock).toHaveBeenCalledWith('10042');
    expect(logs.join('\n')).toContain('✓ Removed link 10042');
  });

  it('prints a human-readable dry-run preview for a bare id without --json', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLinkRemove({ linkId: '10042', org: 'acme', dryRun: true });
    expect(removeIssueLinkMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Dry run — would remove link 10042');
  });
});

describe('runLink human-readable output', () => {
  it('prints a confirmation line after a successful link without --json', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLink({ inwardKey: 'PROJ-1', outwardKey: 'PROJ-2', type: 'Blocks' });
    expect(logs.join('\n')).toContain('✓ Linked PROJ-1 -[Blocks]-> PROJ-2');
  });

  it('prints a dry-run preview line without --json', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runLink({ inwardKey: 'PROJ-1', outwardKey: 'PROJ-2', type: 'Blocks', dryRun: true });
    expect(linkIssuesMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Dry run — would link PROJ-1 -[Blocks]-> PROJ-2');
  });
});
