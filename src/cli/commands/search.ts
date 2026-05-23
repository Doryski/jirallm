import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type SearchOptions = {
  jql: string;
  org?: string;
  project?: string;
  limit?: string;
  cursor?: string;
  fields?: string;
  json?: boolean;
};

export async function runSearch(opts: SearchOptions): Promise<void> {
  const profile = await loadProfile({ org: opts.org, project: opts.project });
  const client = new JiraClient(profile.config, profile.apiToken);

  const fields = opts.fields?.split(',').map((s) => s.trim()).filter(Boolean);
  const limit = opts.limit ? parseInt(opts.limit, 10) : 50;

  const page = await client.searchIssues(opts.jql, {
    fields,
    limit,
    nextPageToken: opts.cursor,
  });

  const rows = page.issues.map((issue) => {
    const f = issue.fields as {
      summary?: string;
      status?: { name?: string };
      assignee?: { displayName?: string } | null;
      issuetype?: { name?: string };
    };
    return {
      key: issue.key,
      summary: f.summary ?? '',
      status: f.status?.name ?? 'Unknown',
      assignee: f.assignee?.displayName,
      issueType: f.issuetype?.name,
    };
  });

  if (shouldOutputJson(opts)) {
    printJson({ issues: rows, nextPageToken: page.nextPageToken, isLast: page.isLast });
    return;
  }

  if (rows.length === 0) {
    console.log('No matching issues.');
    return;
  }
  console.log(`${rows.length} issue(s):`);
  for (const r of rows) {
    const assignee = r.assignee ? ` [${r.assignee}]` : '';
    console.log(`  ${r.key}  ${r.summary}${assignee}`);
  }
  if (!page.isLast && page.nextPageToken) {
    console.log(`\nMore results — pass --cursor ${page.nextPageToken}`);
  }
}
