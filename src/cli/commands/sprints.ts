import { loadOrgProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type SprintsOptions = {
  boardId: string;
  org: string;
  state?: 'active' | 'future' | 'closed';
  limit?: string;
  startAt?: string;
  json?: boolean;
};

export async function runSprints(opts: SprintsOptions): Promise<void> {
  const boardId = parseInt(opts.boardId, 10);
  if (Number.isNaN(boardId)) throw new Error(`Invalid board ID: ${opts.boardId}`);

  const profile = await loadOrgProfile({ org: opts.org });
  const client = new JiraClient(profile.config, profile.apiToken);

  const page = await client.listSprints(boardId, {
    state: opts.state,
    limit: opts.limit ? parseInt(opts.limit, 10) : undefined,
    startAt: opts.startAt ? parseInt(opts.startAt, 10) : undefined,
  });

  if (shouldOutputJson(opts)) {
    printJson(page);
    return;
  }

  if (page.values.length === 0) {
    console.log('No sprints found.');
    return;
  }
  console.log(`${page.values.length} sprint(s):`);
  for (const s of page.values) {
    console.log(`  [${s.id}] ${s.name} (${s.state})`);
  }
}
