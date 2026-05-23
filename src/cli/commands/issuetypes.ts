import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type IssueTypesOptions = {
  org: string;
  project?: string;
  json?: boolean;
};

export async function runIssueTypes(opts: IssueTypesOptions): Promise<void> {
  const profile = await loadProfile({ org: opts.org, project: opts.project });
  const client = new JiraClient(profile.config, profile.apiToken);

  const projectKey = opts.project ?? profile.project.key;
  const types = await client.listIssueTypes(projectKey);

  if (shouldOutputJson(opts)) {
    printJson(types);
    return;
  }

  if (types.length === 0) {
    console.log('No issue types found.');
    return;
  }
  console.log(`${types.length} issue type(s):`);
  for (const t of types) {
    const sub = t.subtask ? ' (subtask)' : '';
    console.log(`  ${t.name}${sub}`);
  }
}
