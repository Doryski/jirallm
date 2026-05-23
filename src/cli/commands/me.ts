import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type MeOptions = {
  org: string;
  json?: boolean;
};

export async function runMe(opts: MeOptions): Promise<void> {
  const profile = await loadProfile({ org: opts.org });
  const client = new JiraClient(profile.config, profile.apiToken);
  const user = await client.getCurrentUser();

  if (shouldOutputJson(opts)) {
    printJson(user);
    return;
  }
  console.log(`Display name: ${user.displayName}`);
  console.log(`Account ID:   ${user.accountId}`);
  if (user.emailAddress) console.log(`Email:        ${user.emailAddress}`);
}
