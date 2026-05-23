import { readFile } from 'node:fs/promises';
import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { parseIssueKey } from '../issueKey.js';
import { resolveOrg } from '../resolveOrg.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type EditOptions = {
  issueKey: string;
  org?: string;
  summary?: string;
  description?: string;
  descriptionFile?: string;
  assignee?: string;
  unassign?: boolean;
  labels?: string;
  priority?: string;
  dryRun?: boolean;
  json?: boolean;
};

export async function runEdit(opts: EditOptions): Promise<void> {
  const parsed = parseIssueKey(opts.issueKey);
  const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);
  const profile = await loadProfile({ org, project: parsed.projectKey });

  let descriptionMarkdown: string | undefined;
  if (opts.descriptionFile) {
    descriptionMarkdown = await readFile(opts.descriptionFile, 'utf8');
  } else if (opts.description !== undefined) {
    descriptionMarkdown = opts.description;
  }

  const assigneeAccountId: string | null | undefined = opts.unassign
    ? null
    : opts.assignee;
  const labels = opts.labels?.split(',').map((s) => s.trim()).filter(Boolean);

  const fields = {
    summary: opts.summary,
    descriptionMarkdown,
    assigneeAccountId,
    labels,
    priority: opts.priority,
  };

  if (opts.dryRun) {
    if (shouldOutputJson(opts)) {
      printJson({ dryRun: true, issueKey: parsed.key, fields });
    } else {
      console.log(`Dry run — would edit ${parsed.key}:`);
      console.log(JSON.stringify(fields, null, 2));
    }
    return;
  }

  const client = new JiraClient(profile.config, profile.apiToken);
  await client.editIssue(parsed.key, fields);

  if (shouldOutputJson(opts)) {
    printJson({ issueKey: parsed.key, updated: true });
    return;
  }
  console.log(`✓ Updated ${parsed.key}`);
}
