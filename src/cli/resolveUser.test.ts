import { beforeEach, describe, expect, it, vi } from 'vitest';
import { looksLikeAccountId, resolveAccountId } from './resolveUser.js';

function makeClient() {
  return {
    getCurrentUser: vi.fn(),
    searchAssignableUsers: vi.fn(),
    searchUsers: vi.fn(),
  };
}

let client: ReturnType<typeof makeClient>;

beforeEach(() => {
  client = makeClient();
});

describe('looksLikeAccountId', () => {
  it('recognizes long alphanumeric ids', () => {
    expect(looksLikeAccountId('5b10ac8d82e05b22cc7d4ef5aaaa')).toBe(true);
  });

  it('recognizes colon-prefixed ids', () => {
    expect(looksLikeAccountId('557058:f58131cb-b67d-43c7')).toBe(true);
  });

  it('rejects emails and plain names', () => {
    expect(looksLikeAccountId('jane@example.com')).toBe(false);
    expect(looksLikeAccountId('Jane Doe')).toBe(false);
  });
});

describe('resolveAccountId', () => {
  it('resolves "me" via getCurrentUser', async () => {
    client.getCurrentUser.mockResolvedValue({ accountId: 'ME', displayName: 'Me' });
    expect(await resolveAccountId(client, 'me', {})).toEqual({ accountId: 'ME', displayName: 'Me' });
  });

  it('resolves "none"/"-" to null when unassign allowed', async () => {
    expect(await resolveAccountId(client, 'none', { allowUnassign: true })).toEqual({ accountId: null });
    expect(await resolveAccountId(client, '-', { allowUnassign: true })).toEqual({ accountId: null });
  });

  it('throws for "none" when unassign not allowed', async () => {
    await expect(resolveAccountId(client, 'none', {})).rejects.toThrow(/not allowed/);
  });

  it('passes through a raw accountId', async () => {
    const id = '5b10ac8d82e05b22cc7d4ef5aaaa';
    expect(await resolveAccountId(client, id, {})).toEqual({ accountId: id });
    expect(client.searchUsers).not.toHaveBeenCalled();
  });

  it('resolves an exact email match', async () => {
    client.searchUsers.mockResolvedValue([
      { accountId: 'A1', displayName: 'Jane', emailAddress: 'jane@example.com' },
    ]);
    expect(await resolveAccountId(client, 'jane@example.com', {})).toEqual({
      accountId: 'A1',
      displayName: 'Jane',
    });
  });

  it('throws when email has no match', async () => {
    client.searchUsers.mockResolvedValue([]);
    await expect(resolveAccountId(client, 'nobody@example.com', {})).rejects.toThrow(/No user/);
  });

  it('resolves a single display-name match', async () => {
    client.searchUsers.mockResolvedValue([{ accountId: 'A2', displayName: 'Jane Doe' }]);
    expect(await resolveAccountId(client, 'Jane Doe', {})).toEqual({
      accountId: 'A2',
      displayName: 'Jane Doe',
    });
  });

  it('throws listing candidates on ambiguous name', async () => {
    client.searchUsers.mockResolvedValue([
      { accountId: 'A3', displayName: 'Jane Doe' },
      { accountId: 'A4', displayName: 'Janet Doe' },
    ]);
    await expect(resolveAccountId(client, 'Jane', {})).rejects.toThrow(/Multiple users/);
  });

  it('disambiguates by exact name when multiple fuzzy matches', async () => {
    client.searchUsers.mockResolvedValue([
      { accountId: 'A3', displayName: 'Jane' },
      { accountId: 'A4', displayName: 'Janet' },
    ]);
    expect(await resolveAccountId(client, 'Jane', {})).toEqual({
      accountId: 'A3',
      displayName: 'Jane',
    });
  });

  it('uses assignable search when issueKey provided', async () => {
    client.searchAssignableUsers.mockResolvedValue([{ accountId: 'A5', displayName: 'Bob' }]);
    await resolveAccountId(client, 'Bob', { issueKey: 'PROJ-1' });
    expect(client.searchAssignableUsers).toHaveBeenCalledWith({
      query: 'Bob',
      issueKey: 'PROJ-1',
      project: undefined,
    });
    expect(client.searchUsers).not.toHaveBeenCalled();
  });
});
