import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { parseIssueKeyArgs } from '../issueKey.js';
import { resolveOrg } from '../resolveOrg.js';
import { resolveAccountId } from '../resolveUser.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type AssignOptions = {
  issueKey: string;
  assignee: string;
  org?: string;
  dryRun?: boolean;
  json?: boolean;
};

export async function runAssign(opts: AssignOptions): Promise<void> {
  const parsed = parseIssueKeyArgs([opts.issueKey]);
  const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);
  const profile = await loadProfile({ org, project: parsed.projectKey });
  const client = new JiraClient(profile.config, profile.apiToken);

  const { accountId, displayName } = await resolveAccountId(client, opts.assignee, {
    project: parsed.projectKey,
    allowUnassign: true,
  });
  const label = displayName ?? accountId ?? 'nobody';
  const results = parsed.keys.map((issueKey) => ({ issueKey, accountId, displayName }));

  if (opts.dryRun) {
    if (shouldOutputJson(opts)) {
      printJson({ dryRun: true, results });
      return;
    }
    for (const issueKey of parsed.keys) {
      console.log(`Dry run — would assign ${issueKey} to ${label}`);
    }
    return;
  }

  for (const issueKey of parsed.keys) {
    await client.assignIssue(issueKey, accountId);
  }

  if (shouldOutputJson(opts)) {
    printJson({ results });
    return;
  }
  for (const issueKey of parsed.keys) {
    console.log(`✓ ${issueKey} assigned to ${label}`);
  }
}
