import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';

export type BoardIssuesOptions = {
  board: string;
  column: string;
  org: string;
  project?: string;
  assignee?: string;
  json?: boolean;
};

type IssueRow = {
  key: string;
  summary: string;
  status: string;
  assignee?: string;
  issueType?: string;
};

export async function runBoardIssues(opts: BoardIssuesOptions): Promise<void> {
  const profile = await loadProfile({ org: opts.org, project: opts.project });
  const client = new JiraClient(profile.config, profile.apiToken);

  const statusIds = await client.getBoardColumnStatusIds(opts.board, opts.column);
  if (statusIds.length === 0) {
    if (opts.json) {
      process.stdout.write('[]\n');
    } else {
      console.error(`Column "${opts.column}" has no mapped statuses.`);
    }
    return;
  }

  const clauses: string[] = [
    `project = ${profile.project.key}`,
    `status in (${statusIds.map((id) => `"${id}"`).join(', ')})`,
  ];

  if (opts.assignee) {
    if (opts.assignee === 'me' || opts.assignee === 'currentUser') {
      clauses.push('assignee = currentUser()');
    } else {
      clauses.push(`assignee = "${opts.assignee}"`);
    }
  }

  const jql = clauses.join(' AND ') + ' ORDER BY rank ASC';

  const issues = await client.searchByJql(jql);

  const rows: IssueRow[] = issues.map((issue) => {
    const fields = issue.fields as {
      summary?: string;
      status?: { name?: string };
      assignee?: { displayName?: string } | null;
      issuetype?: { name?: string };
    };
    return {
      key: issue.key,
      summary: fields.summary ?? '',
      status: fields.status?.name ?? 'Unknown',
      assignee: fields.assignee?.displayName,
      issueType: fields.issuetype?.name,
    };
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify({ board: opts.board, column: opts.column, issues: rows }, null, 2) + '\n');
    return;
  }

  if (rows.length === 0) {
    console.log(`No issues in "${opts.column}" on board "${opts.board}".`);
    return;
  }

  console.log(`Board "${opts.board}" / column "${opts.column}" — ${rows.length} issue(s):`);
  for (const row of rows) {
    const assignee = row.assignee ? ` [${row.assignee}]` : '';
    console.log(`  ${row.key}  ${row.summary}${assignee}`);
  }
}
