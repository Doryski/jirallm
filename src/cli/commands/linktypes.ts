import { loadOrgProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type LinkTypesOptions = {
  org: string;
  json?: boolean;
};

export async function runLinkTypes(opts: LinkTypesOptions): Promise<void> {
  const profile = await loadOrgProfile({ org: opts.org });
  const client = new JiraClient(profile.config, profile.apiToken);
  const types = await client.listLinkTypes();

  if (shouldOutputJson(opts)) {
    printJson(types);
    return;
  }
  if (types.length === 0) {
    console.log('No link types defined.');
    return;
  }
  console.log(`${types.length} link type(s):`);
  for (const t of types) {
    console.log(`  ${t.name.padEnd(20)}  inward="${t.inward}"  outward="${t.outward}"`);
  }
}
