import { loadOrgProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import type { JiraTaskData } from '../../lib/jiraClient.js';
import {
  BUILT_IN_FIELDS,
  findUnknownFieldNames,
  formatUnresolvedFieldNamesError,
  parseFieldsFlag,
  resolveFieldSet,
  SEARCH_ALWAYS_FETCH,
  SEARCH_DEFAULT_KEYS,
} from '../../lib/exportFields.js';
import type { CustomFieldDefs, FieldSelector } from '../../lib/exportFields.js';
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

const parentSuffix = (parent: SearchRow['parent']) => (parent?.key ? ` parent: ${parent.key}` : '');

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

type FieldCatalogEntry = { id: string; name?: string };
type FieldAlias = { token: string; ids: string[] };
type CatalogRead = { entries: FieldCatalogEntry[]; problem?: string };

const WILDCARD_FIELD_IDS = ['*all', '*navigable'] as const;
const WILDCARD_FIELD_ID_SET: ReadonlySet<string> = new Set(WILDCARD_FIELD_IDS);

const includeOnly = (selector: FieldSelector | undefined) =>
  selector ? { ...selector, exclude: [] } : undefined;

const isCatalogEntry = (value: unknown): value is FieldCatalogEntry => {
  if (typeof value !== 'object' || value === null) return false;
  return 'id' in value && typeof value.id === 'string';
};

async function readFieldCatalog(client: JiraClient): Promise<CatalogRead> {
  try {
    const response: unknown = await client.listFields();
    if (!Array.isArray(response)) return { entries: [], problem: 'unexpected response shape' };
    const entries = response.filter(isCatalogEntry);
    if (entries.length === 0) return { entries, problem: 'it listed no usable fields' };
    return { entries };
  } catch (err) {
    return { entries: [], problem: err instanceof Error ? err.message : String(err) };
  }
}

const isFriendlyFieldName = (token: string, customFieldDefs: CustomFieldDefs) => {
  const lowered = token.toLowerCase();
  const names = [...BUILT_IN_FIELDS, ...Object.keys(customFieldDefs)];
  return names.some((name) => name.toLowerCase() === lowered);
};

const findIdsForAlias = (token: string, catalog: readonly FieldCatalogEntry[]) => {
  const lowered = token.toLowerCase();
  const byId = catalog.filter((field) => field.id.toLowerCase() === lowered);
  const matches = byId.length > 0 ? byId : catalog.filter((f) => f.name?.toLowerCase() === lowered);
  return matches.map((field) => field.id);
};

function formatAlias({ token, ids }: FieldAlias): string {
  if (ids.length === 1) return `"${token}" → "${ids[0]}"`;
  const quoted = ids.map((id) => `"${id}"`).join(', ');
  return `"${token}" → ${quoted} (${ids.length} fields share that name — pick one)`;
}

function formatFieldNamesNotIdsError(aliases: readonly FieldAlias[]): string {
  const label = aliases.length > 1 ? 'fields' : 'field';
  const quoted = aliases.map(({ token }) => `"${token}"`).join(', ');
  const listed = aliases.map(formatAlias).join(', ');
  return (
    `Unknown ${label} ${quoted}. \`search\` matches raw Jira field IDs, not display names — ` +
    `pass the id instead: ${listed}.`
  );
}

async function assertFieldsKnownToJira(
  client: JiraClient,
  selector: FieldSelector | undefined,
  customFieldDefs: CustomFieldDefs
): Promise<void> {
  const unknown = findUnknownFieldNames(includeOnly(selector), customFieldDefs).filter(
    (name) => !WILDCARD_FIELD_ID_SET.has(name.toLowerCase())
  );
  if (unknown.length === 0) return;

  const { entries, problem } = await readFieldCatalog(client);
  if (problem) {
    console.warn(
      `Warning: could not verify --fields against this Jira instance (${problem}) — ` +
        'proceeding without checking the requested field names.'
    );
    return;
  }

  const catalogIds = entries.map((field) => field.id);
  const unresolved = unknown.filter((name) => !catalogIds.includes(name));
  if (unresolved.length === 0) return;

  const aliases = unresolved
    .filter((token) => !isFriendlyFieldName(token, customFieldDefs))
    .map((token) => ({ token, ids: findIdsForAlias(token, entries) }))
    .filter(({ ids }) => ids.length > 0);
  const aliased = new Set(aliases.map(({ token }) => token));
  const unmatched = unresolved.filter((name) => !aliased.has(name));

  const messages = [
    aliases.length > 0 ? formatFieldNamesNotIdsError(aliases) : '',
    unmatched.length > 0
      ? formatUnresolvedFieldNamesError(unmatched, catalogIds, customFieldDefs)
      : '',
  ].filter(Boolean);
  throw new Error(messages.join('\n'));
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

  await assertFieldsKnownToJira(client, selector, customFieldDefs);

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
    console.log(
      `  ${r.key}  ${r.summary}  (${r.status ?? 'Unknown'})${assignee}${parentSuffix(r.parent)}`
    );
  }
  if (!page.isLast && page.nextPageToken) {
    console.log(`\nMore results — pass --cursor ${page.nextPageToken}`);
  }
}
