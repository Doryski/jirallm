import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { parseIssueKey } from '../issueKey.js';
import { resolveOrg } from '../resolveOrg.js';
import { resolveAccountId } from '../resolveUser.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type WatchersOptions = {
  issueKey: string;
  add?: string;
  rm?: string;
  org?: string;
  dryRun?: boolean;
  json?: boolean;
};

export async function runWatchers(opts: WatchersOptions): Promise<void> {
  const parsed = parseIssueKey(opts.issueKey);
  const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);
  const profile = await loadProfile({ org, project: parsed.projectKey });
  const client = new JiraClient(profile.config, profile.apiToken);

  if (opts.add || opts.rm) {
    const resolveOpts = { issueKey: parsed.key, project: parsed.projectKey };
    const addUser = opts.add ? await resolveAccountId(client, opts.add, resolveOpts) : undefined;
    const rmUser = opts.rm ? await resolveAccountId(client, opts.rm, resolveOpts) : undefined;
    const addId = addUser?.accountId ?? undefined;
    const rmId = rmUser?.accountId ?? undefined;

    if (addId && rmId && addId === rmId) {
      throw new Error(
        `--add and --rm resolve to the same user (${addId}); nothing to do.`
      );
    }

    if (opts.dryRun) {
      const add = addId ? { accountId: addId, displayName: addUser?.displayName } : undefined;
      const rm = rmId ? { accountId: rmId, displayName: rmUser?.displayName } : undefined;
      const payload = { dryRun: true, org, issueKey: parsed.key, add, rm };
      if (shouldOutputJson(opts)) printJson(payload);
      else console.log(`Dry run — would mutate watchers on ${parsed.key}: ${JSON.stringify(payload)}`);
      return;
    }
    if (addId) await client.addWatcher(parsed.key, addId);
    if (rmId) await client.removeWatcher(parsed.key, rmId);
  }

  const watchers = await client.listWatchers(parsed.key);
  if (shouldOutputJson(opts)) {
    printJson({ org, issueKey: parsed.key, watchers });
    return;
  }
  if (watchers.length === 0) {
    console.log(`${parsed.key} has no watchers.`);
    return;
  }
  console.log(`${parsed.key} watchers (${watchers.length}):`);
  for (const w of watchers) {
    console.log(`  ${w.accountId.padEnd(28)}  ${w.displayName}`);
  }
}
