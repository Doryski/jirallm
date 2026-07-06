import { readFile } from 'node:fs/promises';
import { loadOrgProfile, resolveOptionalProjectKey } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { parseFieldFlags } from '../../lib/customFieldWrite.js';
import { resolveAccountId } from '../resolveUser.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type CreateOptions = {
  org?: string;
  projectKey?: string;
  type: string;
  summary: string;
  description?: string;
  descriptionFile?: string;
  assignee?: string;
  labels?: string;
  priority?: string;
  parent?: string;
  components?: string;
  field?: string[];
  dryRun?: boolean;
  json?: boolean;
};

export async function runCreate(opts: CreateOptions): Promise<void> {
  const profile = await loadOrgProfile({ org: opts.org });

  let descriptionMarkdown: string | undefined;
  if (opts.descriptionFile) {
    descriptionMarkdown = await readFile(opts.descriptionFile, 'utf8');
  } else if (opts.description) {
    descriptionMarkdown = opts.description;
  }

  const labels = opts.labels?.split(',').map((s) => s.trim()).filter(Boolean);
  const components = opts.components?.split(',').map((s) => s.trim()).filter(Boolean);
  const customFields = parseFieldFlags(opts.field, profile.org?.export?.customFieldDefs);

  const projectKey = resolveOptionalProjectKey(profile.org, opts.projectKey);
  if (!projectKey) {
    const keys = Object.keys(profile.org.projects).join(', ') || '(none)';
    throw new Error(
      `No project specified for org "${profile.org.name}". Pass --project. Available projects: ${keys}`
    );
  }

  const client = new JiraClient(profile.config, profile.apiToken);

  let assigneeAccountId: string | undefined;
  let assigneeDisplayName: string | undefined;
  if (opts.assignee) {
    const resolved = await resolveAccountId(client, opts.assignee, { project: projectKey });
    assigneeAccountId = resolved.accountId ?? undefined;
    assigneeDisplayName = resolved.displayName ?? undefined;
  }

  const input = {
    projectKey,
    issueType: opts.type,
    summary: opts.summary,
    descriptionMarkdown,
    assigneeAccountId,
    labels,
    priority: opts.priority,
    parentKey: opts.parent,
    components,
    customFields,
  };

  if (opts.dryRun) {
    const preview = assigneeDisplayName ? { ...input, assigneeDisplayName } : input;
    if (shouldOutputJson(opts)) {
      printJson({ dryRun: true, input: preview });
    } else {
      console.log('Dry run — would create issue:');
      console.log(JSON.stringify(preview, null, 2));
    }
    return;
  }

  const result = await client.createIssue(input);

  if (shouldOutputJson(opts)) {
    printJson(result);
    return;
  }
  console.log(`✓ Created ${result.key}`);
}
