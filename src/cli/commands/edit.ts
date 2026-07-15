import { readFile } from 'node:fs/promises';
import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { parseFieldFlags } from '../../lib/customFieldWrite.js';
import { parseIssueKey } from '../issueKey.js';
import { resolveOrg } from '../resolveOrg.js';
import { resolveAccountId } from '../resolveUser.js';
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
  parent?: string;
  due?: string;
  components?: string;
  field?: string[];
  dryRun?: boolean;
  json?: boolean;
};

export async function runEdit(opts: EditOptions): Promise<void> {
  const parsed = parseIssueKey(opts.issueKey);
  const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);
  const profile = await loadProfile({ org, project: parsed.projectKey });

  const client = new JiraClient(profile.config, profile.apiToken);

  let descriptionMarkdown: string | undefined;
  if (opts.descriptionFile) {
    descriptionMarkdown = await readFile(opts.descriptionFile, 'utf8');
  } else if (opts.description !== undefined) {
    descriptionMarkdown = opts.description;
  }

  let assigneeAccountId: string | null | undefined;
  let assigneeDisplayName: string | undefined;
  if (opts.unassign) {
    assigneeAccountId = null;
  } else if (opts.assignee !== undefined) {
    const resolved = await resolveAccountId(client, opts.assignee, {
      issueKey: parsed.key,
      project: parsed.projectKey,
      allowUnassign: true,
    });
    assigneeAccountId = resolved.accountId;
    assigneeDisplayName = resolved.displayName;
  }
  const labels = opts.labels?.split(',').map((s) => s.trim()).filter(Boolean);
  const components = opts.components?.split(',').map((s) => s.trim()).filter(Boolean);
  const customFields = parseFieldFlags(opts.field, profile.org?.export?.customFieldDefs);

  const fields = {
    summary: opts.summary,
    descriptionMarkdown,
    assigneeAccountId,
    labels,
    priority: opts.priority,
    parentKey: opts.parent,
    dueDate: opts.due,
    components,
    customFields,
  };

  if (opts.dryRun) {
    const dryRunFields =
      assigneeDisplayName !== undefined ? { ...fields, assigneeDisplayName } : fields;
    if (shouldOutputJson(opts)) {
      printJson({ dryRun: true, issueKey: parsed.key, fields: dryRunFields });
    } else {
      console.log(`Dry run — would edit ${parsed.key}:`);
      console.log(JSON.stringify(dryRunFields, null, 2));
    }
    return;
  }

  await client.editIssue(parsed.key, fields);

  if (shouldOutputJson(opts)) {
    printJson({ issueKey: parsed.key, updated: true });
    return;
  }
  console.log(`✓ Updated ${parsed.key}`);
}
