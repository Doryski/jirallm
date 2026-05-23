import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type BoardsOptions = {
  org: string;
  project?: string;
  type?: 'scrum' | 'kanban' | 'simple';
  name?: string;
  limit?: string;
  startAt?: string;
  json?: boolean;
};

export async function runBoards(opts: BoardsOptions): Promise<void> {
  const profile = await loadProfile({ org: opts.org, project: opts.project });
  const client = new JiraClient(profile.config, profile.apiToken);

  const page = await client.listBoards({
    projectKey: opts.project ?? profile.project.key,
    type: opts.type,
    name: opts.name,
    limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
    startAt: opts.startAt ? parseInt(opts.startAt, 10) : undefined,
  });

  if (shouldOutputJson(opts)) {
    printJson(page);
    return;
  }

  if (page.values.length === 0) {
    console.log('No boards found.');
    return;
  }
  console.log(`${page.values.length} board(s):`);
  for (const b of page.values) {
    console.log(`  [${b.id}] ${b.name} (${b.type})`);
  }
}
