import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import type { JiraTaskData } from '../../lib/jiraClient.js';
import { parseFieldsFlag, resolveFieldSet } from '../../lib/exportFields.js';
import { parseIssueKeyArgs } from '../issueKey.js';
import { resolveOrg } from '../resolveOrg.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type FetchOptions = {
  issueKey: string;
  org?: string;
  json?: boolean;
  withComments?: boolean;
  withHistory?: boolean;
  withWorklog?: boolean;
  withSubtasks?: boolean;
  withLinks?: boolean;
  withAttachments?: boolean;
  full?: boolean;
  fields?: string;
  raw?: boolean;
  rendered?: boolean;
  expand?: string;
};

function buildCommentsSection(data: JiraTaskData): string {
  const comments = data.history.filter((entry) => entry.type === 'comment');
  const lines = comments.map(
    (entry) => `---\n${entry.author} — ${entry.date}\n${entry.content}`
  );
  return ['## Comments', '', ...lines].join('\n');
}

function buildHistorySection(data: JiraTaskData): string {
  const changes = data.history.filter((entry) => entry.type !== 'comment');
  const lines = changes.map(
    (entry) => `- ${entry.date} — ${entry.author}: ${entry.content}`
  );
  return ['## History', '', ...lines].join('\n');
}

function buildWorklogSection(data: JiraTaskData): string {
  const worklogs = data.worklogs ?? [];
  const lines = worklogs.map((worklog) => {
    const header = `- ${worklog.author} — ${worklog.started}: ${worklog.timeSpent}`;
    if (!worklog.comment) return header;
    return `${header}\n  ${worklog.comment}`;
  });
  return ['## Worklog', '', ...lines].join('\n');
}

function buildSubtasksSection(data: JiraTaskData): string {
  const subtasks = data.subtasks ?? [];
  const lines = subtasks.map(
    (subtask) => `- ${subtask.key} [${subtask.status}] ${subtask.title}`
  );
  return ['## Subtasks', '', ...lines].join('\n');
}

function buildLinksSection(data: JiraTaskData): string {
  const links = data.issueLinks ?? [];
  const lines = links.map(
    (link) => `- ${link.type}: ${link.key} [${link.status ?? '?'}] ${link.title}`
  );
  return ['## Links', '', ...lines].join('\n');
}

function buildAttachmentsSection(data: JiraTaskData): string {
  const lines = data.attachments.map(
    (att) => `- ${att.filename} (${att.size} bytes) — ${att.url}`
  );
  return ['## Attachments', '', ...lines].join('\n');
}

export async function runFetch(opts: FetchOptions): Promise<void> {
  const parsed = parseIssueKeyArgs([opts.issueKey]);
  const key = parsed.keys[0];
  const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);

  const profile = await loadProfile({ org, project: parsed.projectKey });
  const client = new JiraClient(profile.config, profile.apiToken);

  if (opts.raw || opts.rendered || opts.expand) {
    const expand = new Set(['names']);
    if (opts.rendered) expand.add('renderedFields');
    if (opts.expand) {
      for (const part of opts.expand.split(',')) {
        const trimmed = part.trim();
        if (trimmed) expand.add(trimmed);
      }
    }
    printJson(await client.fetchIssueRaw(key, [...expand]));
    return;
  }

  const withComments = opts.full ? true : opts.withComments ?? false;
  const withHistory = opts.full ? true : opts.withHistory ?? false;
  const withWorklog = opts.full ? true : opts.withWorklog ?? false;
  const withSubtasks = opts.full ? true : opts.withSubtasks ?? false;
  const withLinks = opts.full ? true : opts.withLinks ?? false;
  const withAttachments = opts.full ? true : opts.withAttachments ?? false;

  const customFieldDefs = profile.org.export?.customFieldDefs ?? {};
  const fieldSelector = opts.fields ? parseFieldsFlag(opts.fields) : undefined;
  const resolved = resolveFieldSet(fieldSelector, customFieldDefs);

  const data = await client.fetchIssueDetails(key, {
    jiraFieldIds: resolved.jiraFieldIds,
    customFieldDefs,
    includeComments: withComments,
    includeChangelog: withHistory,
    fullChangelog: withHistory,
    includeWorklog: withWorklog,
    includeLinks: withLinks,
  });

  if (withSubtasks) data.subtasks = await client.fetchIssueSubtasks(key);

  if (shouldOutputJson(opts)) {
    printJson(data);
    return;
  }

  console.log(`${data.key} — ${data.title}`);
  console.log(`Status:   ${data.status}`);
  if (data.assignee) console.log(`Assignee: ${data.assignee}`);
  if (data.issueType) console.log(`Type:     ${data.issueType}`);
  if (data.priority) console.log(`Priority: ${data.priority}`);
  if (data.sprint) console.log(`Sprint:   ${data.sprint}`);
  if (data.labels?.length) console.log(`Labels:   ${data.labels.join(', ')}`);
  console.log('');
  console.log(data.description);

  if (withComments) console.log(`\n${buildCommentsSection(data)}`);
  if (withHistory) console.log(`\n${buildHistorySection(data)}`);
  if (withWorklog && data.worklogs?.length) console.log(`\n${buildWorklogSection(data)}`);
  if (withSubtasks && data.subtasks?.length) console.log(`\n${buildSubtasksSection(data)}`);
  if (withLinks && data.issueLinks?.length) console.log(`\n${buildLinksSection(data)}`);
  if (withAttachments && data.attachments?.length) console.log(`\n${buildAttachmentsSection(data)}`);
}
