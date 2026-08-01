import { loadOrgProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import type { JiraTaskData } from '../../lib/jiraClient.js';
import {
  parseFieldsFlag,
  resolveFieldSet,
  SEARCH_ALWAYS_FETCH,
  SEARCH_DEFAULT_KEYS,
} from '../../lib/exportFields.js';
import type { CustomFieldDefs } from '../../lib/exportFields.js';
import { PROJECTABLE_FIELDS, projectIssueFields } from '../../lib/fieldProjection.js';
import type { ProjectionContext } from '../../lib/fieldProjection.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type SearchOptions = {
  jql: string;
  org?: string;
  limit?: string;
  cursor?: string;
  nextPageToken?: string;
  fields?: string;
  json?: boolean;
};

export type SearchRow = Partial<Omit<JiraTaskData, 'key' | 'title'>> & {
  key: string;
  summary: string;
} & Record<string, unknown>;

const PROJECTABLE_FIELD_SET: ReadonlySet<string> = new Set(PROJECTABLE_FIELDS);

const isPresent = (value: unknown) => {
  if (value === undefined || value === null || value === '') return false;
  return !(Array.isArray(value) && value.length === 0);
};

function passThroughRawFields(
  rawFields: Record<string, unknown>,
  selectedKeys: readonly string[],
  customFieldDefs: CustomFieldDefs
): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  for (const key of selectedKeys) {
    if (PROJECTABLE_FIELD_SET.has(key) || key in customFieldDefs) continue;
    if (isPresent(rawFields[key])) extras[key] = rawFields[key];
  }
  return extras;
}

async function resolveProjectionContext(
  client: JiraClient,
  friendlyKeys: readonly string[],
  customFieldDefs: CustomFieldDefs
): Promise<ProjectionContext> {
  const sprintFieldId = friendlyKeys.includes('sprint')
    ? customFieldDefs.sprint?.id ?? (await client.detectSprintFieldId())
    : undefined;
  const storyPointsFieldId = friendlyKeys.includes('storyPoints')
    ? customFieldDefs.storyPoints?.id ?? (await client.detectStoryPointsFieldId())
    : undefined;
  return { sprintFieldId, storyPointsFieldId, customFieldDefs };
}

function withDiscoveredIds(jiraFieldIds: readonly string[], ctx: ProjectionContext): string[] {
  const extra = [ctx.sprintFieldId, ctx.storyPointsFieldId].filter(
    (id): id is string => Boolean(id)
  );
  if (extra.length === 0) return [...jiraFieldIds];
  return [...new Set([...jiraFieldIds, ...extra])];
}

function buildRow(
  issue: { key: string; fields: Record<string, unknown> },
  friendlyKeys: readonly string[],
  ctx: ProjectionContext
): SearchRow {
  const row: SearchRow = {
    key: issue.key,
    summary: (issue.fields.summary as string | undefined) ?? '',
    ...projectIssueFields(issue.fields, friendlyKeys, ctx),
    ...passThroughRawFields(issue.fields, friendlyKeys, ctx.customFieldDefs ?? {}),
  };
  if (friendlyKeys.includes('status') && row.status === undefined) row.status = 'Unknown';
  return row;
}

export async function runSearch(opts: SearchOptions): Promise<void> {
  const profile = await loadOrgProfile({ org: opts.org });
  const client = new JiraClient(profile.config, profile.apiToken);

  const customFieldDefs = profile.org.export?.customFieldDefs ?? {};
  const selector = opts.fields ? parseFieldsFlag(opts.fields) : undefined;
  const resolved = resolveFieldSet(selector, customFieldDefs, {
    alwaysFetch: SEARCH_ALWAYS_FETCH,
    defaultKeys: SEARCH_DEFAULT_KEYS,
    passThroughUnknown: true,
  });

  const ctx = await resolveProjectionContext(client, resolved.friendlyKeys, customFieldDefs);
  const limit = opts.limit ? parseInt(opts.limit, 10) : 50;

  const page = await client.searchIssues(opts.jql, {
    fields: withDiscoveredIds(resolved.jiraFieldIds, ctx),
    limit,
    nextPageToken: opts.nextPageToken || opts.cursor,
  });

  const rows = page.issues.map((issue) =>
    buildRow(
      { key: issue.key, fields: issue.fields as Record<string, unknown> },
      resolved.friendlyKeys,
      ctx
    )
  );

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
    console.log(`  ${r.key}  ${r.summary}  (${r.status ?? 'Unknown'})${assignee}`);
  }
  if (!page.isLast && page.nextPageToken) {
    console.log(`\nMore results — pass --cursor ${page.nextPageToken}`);
  }
}
