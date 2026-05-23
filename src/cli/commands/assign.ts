import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { parseIssueKey } from '../issueKey.js';
import { resolveOrg } from '../resolveOrg.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type AssignOptions = {
  issueKey: string;
  assignee: string;
  org?: string;
  dryRun?: boolean;
  json?: boolean;
};

export async function runAssign(opts: AssignOptions): Promise<void> {
  const parsed = parseIssueKey(opts.issueKey);
  const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);
  const profile = await loadProfile({ org, project: parsed.projectKey });
  const client = new JiraClient(profile.config, profile.apiToken);

  let accountId: string | null;
  if (opts.assignee === 'none' || opts.assignee === '-') {
    accountId = null;
  } else if (opts.assignee === 'me') {
    const me = await client.getCurrentUser();
    accountId = me.accountId;
  } else {
    accountId = opts.assignee;
  }

  if (opts.dryRun) {
    const payload = { dryRun: true, issueKey: parsed.key, accountId };
    if (shouldOutputJson(opts)) printJson(payload);
    else console.log(`Dry run — would assign ${parsed.key} to ${accountId ?? 'none'}`);
    return;
  }

  await client.assignIssue(parsed.key, accountId);

  if (shouldOutputJson(opts)) {
    printJson({ issueKey: parsed.key, accountId });
    return;
  }
  console.log(`✓ ${parsed.key} assigned to ${accountId ?? 'nobody'}`);
}
