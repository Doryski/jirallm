import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { resolveOrg } from '../resolveOrg.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type ComponentsOptions = {
  org?: string;
  project?: string;
  json?: boolean;
};

export async function runComponents(opts: ComponentsOptions): Promise<void> {
  try {
    const org = resolveOrg(undefined, opts.org, opts.project ?? '');
    const profile = await loadProfile({ org, project: opts.project });
    const client = new JiraClient(profile.config, profile.apiToken);

    const projectKey = profile.project.key;
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
  } catch (err) {
    if (shouldOutputJson(opts)) {
      printJson({ error: err instanceof Error ? err.message : String(err) });
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}
