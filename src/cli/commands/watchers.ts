import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { parseIssueKey } from '../issueKey.js';
import { resolveOrg } from '../resolveOrg.js';
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
    if (opts.dryRun) {
      const payload = { dryRun: true, issueKey: parsed.key, add: opts.add, rm: opts.rm };
      if (shouldOutputJson(opts)) printJson(payload);
      else console.log(`Dry run — would mutate watchers on ${parsed.key}: ${JSON.stringify(payload)}`);
      return;
    }
    if (opts.add) {
      const accountId = opts.add === 'me' ? (await client.getCurrentUser()).accountId : opts.add;
      await client.addWatcher(parsed.key, accountId);
    }
    if (opts.rm) {
      const accountId = opts.rm === 'me' ? (await client.getCurrentUser()).accountId : opts.rm;
      await client.removeWatcher(parsed.key, accountId);
    }
  }

  const watchers = await client.listWatchers(parsed.key);
  if (shouldOutputJson(opts)) {
    printJson({ issueKey: parsed.key, watchers });
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
