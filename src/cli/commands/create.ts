import { readFile } from 'node:fs/promises';
import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type CreateOptions = {
  org: string;
  projectKey?: string;
  type: string;
  summary: string;
  description?: string;
  descriptionFile?: string;
  assignee?: string;
  labels?: string;
  priority?: string;
  parent?: string;
  dryRun?: boolean;
  json?: boolean;
};

export async function runCreate(opts: CreateOptions): Promise<void> {
  const profile = await loadProfile({ org: opts.org, project: opts.projectKey });
  const projectKey = opts.projectKey ?? profile.project.key;

  let descriptionMarkdown: string | undefined;
  if (opts.descriptionFile) {
    descriptionMarkdown = await readFile(opts.descriptionFile, 'utf8');
  } else if (opts.description) {
    descriptionMarkdown = opts.description;
  }

  const labels = opts.labels?.split(',').map((s) => s.trim()).filter(Boolean);

  const input = {
    projectKey,
    issueType: opts.type,
    summary: opts.summary,
    descriptionMarkdown,
    assigneeAccountId: opts.assignee,
    labels,
    priority: opts.priority,
    parentKey: opts.parent,
  };

  if (opts.dryRun) {
    if (shouldOutputJson(opts)) {
      printJson({ dryRun: true, input });
    } else {
      console.log('Dry run — would create issue:');
      console.log(JSON.stringify(input, null, 2));
    }
    return;
  }

  const client = new JiraClient(profile.config, profile.apiToken);
  const result = await client.createIssue(input);

  if (shouldOutputJson(opts)) {
    printJson(result);
    return;
  }
  console.log(`✓ Created ${result.key}`);
}
