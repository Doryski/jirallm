export type ResolvedUser = { accountId: string | null; displayName?: string };

type UserLookup = { accountId: string; displayName: string; emailAddress?: string };

type UserClient = {
  getCurrentUser(): Promise<UserLookup>;
  searchAssignableUsers(opts: {
    query: string;
    issueKey?: string;
    project?: string;
    maxResults?: number;
  }): Promise<UserLookup[]>;
  searchUsers(query: string, maxResults?: number): Promise<UserLookup[]>;
};

type ResolveOptions = { issueKey?: string; project?: string; allowUnassign?: boolean };

export function looksLikeAccountId(s: string): boolean {
  if (s.includes('@')) return false;
  return /^[a-zA-Z0-9._-]{24,}$/.test(s) || /^\w+:[\w-]+$/.test(s);
}

function candidateList(candidates: UserLookup[]): string {
  return candidates
    .map((c) => `  ${c.displayName}${c.emailAddress ? ` <${c.emailAddress}>` : ''} (${c.accountId})`)
    .join('\n');
}

async function lookupUsers(
  client: UserClient,
  query: string,
  opts: ResolveOptions
): Promise<UserLookup[]> {
  if (opts.issueKey || opts.project) {
    return client.searchAssignableUsers({
      query,
      issueKey: opts.issueKey,
      project: opts.project,
    });
  }
  return client.searchUsers(query);
}

async function resolveByEmail(
  client: UserClient,
  email: string,
  opts: ResolveOptions
): Promise<ResolvedUser> {
  const results = await lookupUsers(client, email, opts);
  const exact = results.filter((r) => r.emailAddress?.toLowerCase() === email.toLowerCase());
  if (exact.length === 1) return { accountId: exact[0].accountId, displayName: exact[0].displayName };
  if (exact.length > 1) {
    throw new Error(`Multiple users match email "${email}":\n${candidateList(exact)}`);
  }
  throw new Error(`No user found matching email "${email}".`);
}

async function resolveByName(
  client: UserClient,
  name: string,
  opts: ResolveOptions
): Promise<ResolvedUser> {
  const results = await lookupUsers(client, name, opts);
  if (results.length === 0) throw new Error(`No user found matching "${name}".`);
  if (results.length === 1) return { accountId: results[0].accountId, displayName: results[0].displayName };

  const exact = results.filter((r) => r.displayName.toLowerCase() === name.toLowerCase());
  if (exact.length === 1) return { accountId: exact[0].accountId, displayName: exact[0].displayName };

  throw new Error(
    `Multiple users match "${name}" — be more specific or pass an accountId:\n${candidateList(results)}`
  );
}

export async function resolveAccountId(
  client: UserClient,
  input: string,
  opts: ResolveOptions
): Promise<ResolvedUser> {
  const value = input.trim();
  const lower = value.toLowerCase();

  if (lower === 'me') {
    const me = await client.getCurrentUser();
    return { accountId: me.accountId, displayName: me.displayName };
  }

  if (lower === 'none' || value === '-') {
    if (opts.allowUnassign) return { accountId: null };
    throw new Error(`Unassigning is not allowed here (got "${input}").`);
  }

  if (looksLikeAccountId(value)) return { accountId: value };

  if (value.includes('@')) return resolveByEmail(client, value, opts);

  return resolveByName(client, value, opts);
}
