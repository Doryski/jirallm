import { loadOrgProfile, resolveOptionalProjectKey } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { resolveOrg } from '../resolveOrg.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type IssueTypesOptions = {
  org?: string;
  project?: string;
  json?: boolean;
};

export async function runIssueTypes(opts: IssueTypesOptions): Promise<void> {
  const org = resolveOrg(undefined, opts.org, opts.project ?? '');
  const profile = await loadOrgProfile({ org });
  const client = new JiraClient(profile.config, profile.apiToken);

  const projectKey = resolveOptionalProjectKey(profile.org, opts.project);
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
