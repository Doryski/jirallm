import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { parseIssueKeyArgs } from '../issueKey.js';
import { resolveOrg } from '../resolveOrg.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type FetchOptions = {
  issueKey: string;
  org?: string;
  json?: boolean;
};

export async function runFetch(opts: FetchOptions): Promise<void> {
  const parsed = parseIssueKeyArgs([opts.issueKey]);
  const key = parsed.keys[0];
  const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);

  const profile = await loadProfile({ org, project: parsed.projectKey });
  const client = new JiraClient(profile.config, profile.apiToken);

  const data = await client.fetchIssueDetails(key);

  if (shouldOutputJson(opts)) {
    printJson(data);
    return;
  }

  console.log(`${data.key} — ${data.title}`);
  console.log(`Status:   ${data.status}`);
  if (data.assignee) console.log(`Assignee: ${data.assignee}`);
  if (data.issueType) console.log(`Type:     ${data.issueType}`);
  if (data.priority) console.log(`Priority: ${data.priority}`);
  if (data.sprint) console.log(`Sprint:   ${data.sprint}`);
  if (data.labels?.length) console.log(`Labels:   ${data.labels.join(', ')}`);
  console.log('');
  console.log(data.description);
}
