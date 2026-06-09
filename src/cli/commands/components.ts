import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type ComponentsOptions = {
  org: string;
  project?: string;
  json?: boolean;
};

export async function runComponents(opts: ComponentsOptions): Promise<void> {
  const profile = await loadProfile({ org: opts.org, project: opts.project });
  const client = new JiraClient(profile.config, profile.apiToken);

  const projectKey = opts.project ?? profile.project.key;
  const components = await client.listComponents(projectKey);

  if (shouldOutputJson(opts)) {
    printJson(components);
    return;
  }

  if (components.length === 0) {
    console.log('No components found.');
    return;
  }
  console.log(`${components.length} component(s):`);
  for (const c of components) {
    const desc = c.description ? ` — ${c.description}` : '';
    console.log(`  ${c.name}${desc}`);
  }
}
