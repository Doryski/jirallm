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
import type { CustomFieldDefs, FieldSelector, PresetName } from '../../lib/exportFields.js';
import {
  COMMON_EPIC_FIELDS,
  PROJECTABLE_FIELDS,
  projectIssueFields,
} from '../../lib/fieldProjection.js';
import type { ProjectionContext } from '../../lib/fieldProjection.js';
import { convertADFToMarkdown } from '../../lib/adfToMarkdown.js';
import type { JiraADFContent, JiraADFDocument } from '../../lib/adfToMarkdown.js';
import { parseDescriptionFormat } from '../../lib/descriptionFormat.js';
import type { DescriptionFormat } from '../../lib/descriptionFormat.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type SearchOptions = {
  jql: string;
  org?: string;
  limit?: string;
  cursor?: string;
  nextPageToken?: string;
  fields?: string;
  descriptionFormat?: string;
  json?: boolean;
};

export type SearchRow = Partial<Omit<JiraTaskData, 'key' | 'title'>> & {
  key: string;
  summary: string;
  descriptionAdf?: JiraADFDocument;
} & Record<string, unknown>;

const PROJECTABLE_FIELD_SET: ReadonlySet<string> = new Set(PROJECTABLE_FIELDS);

const DESCRIPTION_KEY = 'description';
const DESCRIPTION_ADF_KEY = 'descriptionAdf';
const DESCRIPTION_ROW_KEYS: ReadonlySet<string> = new Set([DESCRIPTION_KEY, DESCRIPTION_ADF_KEY]);

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
    if (DESCRIPTION_ROW_KEYS.has(key)) continue;
    if (PROJECTABLE_FIELD_SET.has(key) || key in customFieldDefs) continue;
    if (isPresent(rawFields[key])) extras[key] = rawFields[key];
  }
  return extras;
}

const ATTACHMENT_FIELD_ID = 'attachment';

type AttachmentMeta = { id: string; filename: string; url?: string };
type RawAttachment = { id: string; filename: string } & Record<string, unknown>;

const isRawAttachment = (value: unknown): value is RawAttachment => {
  if (typeof value !== 'object' || value === null) return false;
  if (!('id' in value) || typeof value.id !== 'string') return false;
  return 'filename' in value && typeof value.filename === 'string';
};

const toAttachmentMeta = ({ id, filename, content }: RawAttachment): AttachmentMeta => ({
  id,
  filename,
  url: typeof content === 'string' ? content : undefined,
});

function attachmentMetadata(rawFields: Record<string, unknown>): AttachmentMeta[] {
  const raw = rawFields[ATTACHMENT_FIELD_ID];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRawAttachment).map(toAttachmentMeta);
}

type AdfLike = { content: JiraADFContent[] };

const isAdfLike = (value: unknown): value is AdfLike =>
  typeof value === 'object' && value !== null && 'content' in value && Array.isArray(value.content);

const isAdfDocument = (value: unknown): value is JiraADFDocument => {
  if (!isAdfLike(value)) return false;
  if (!('type' in value) || value.type !== 'doc') return false;
  return 'version' in value && typeof value.version === 'number';
};

const renderAdf = (value: AdfLike, attachments: AttachmentMeta[]) =>
  convertADFToMarkdown({ version: 1, type: 'doc', ...value }, attachments);

function adfEntries(
  raw: AdfLike,
  format: DescriptionFormat,
  attachments: AttachmentMeta[]
): Partial<SearchRow> {
  if (!isAdfDocument(raw)) return { description: renderAdf(raw, attachments) };
  if (format === 'adf') return { descriptionAdf: raw };
  const description = renderAdf(raw, attachments);
  if (format === 'both') return { description, descriptionAdf: raw };
  return { description };
}

function descriptionEntries(
  raw: unknown,
  format: DescriptionFormat,
  attachments: AttachmentMeta[]
): Partial<SearchRow> {
  if (!isPresent(raw)) return {};
  if (typeof raw === 'string') return { description: raw };
  if (isAdfLike(raw)) return adfEntries(raw, format, attachments);
  return { description: '' };
}

function formatDescriptionFormatUnusedError(): string {
  return (
    'Unused `--description-format`: the resolved field set has no `description`. `description` is ' +
    'opt-in for `search` — name it explicitly, e.g. `--fields +description`, or drop ' +
    '`--description-format`.'
  );
}

function formatDescriptionOverriddenError(): string {
  return (
    'Conflicting field `description`: this org config maps a custom field to the key ' +
    '`description` (`[orgs.<org>.export.custom_fields]`), which shadows the built-in issue ' +
    'description, so `search` cannot render it. Rename that custom-field key in the org config ' +
    '(e.g. to `descriptionText`), then re-run.'
  );
}

function formatDescriptionOverriddenWarning(): string {
  return (
    'Warning: this org config maps a custom field to the key `description`, which shadows the ' +
    'built-in issue description — rows carry that custom field under `customFields.description` ' +
    'and no rendered description. Rename that custom-field key in the org config to free the name.'
  );
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
    (name) => !WILDCARD_FIELD_ID_SET.has(name.toLowerCase()) && name !== DESCRIPTION_KEY
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

const SUBTASKS_KEY = 'subtasks';

const isSubtasksToken = (token: string) => token.trim().toLowerCase() === SUBTASKS_KEY;

const isDescriptionToken = (token: string) => token.trim().toLowerCase() === DESCRIPTION_KEY;

const isExplicitlyIncluded = (
  selector: FieldSelector | undefined,
  matches: (token: string) => boolean
) => Boolean(includeOnly(selector)?.include?.some(matches));

const hasCustomOverride = (customFieldDefs: CustomFieldDefs, name: string) =>
  Object.hasOwn(customFieldDefs, name);

function formatSubtasksUnsupportedError(): string {
  return (
    'Unsupported field `subtasks`. `search` cannot project it — a Jira search page carries no ' +
    'subtask data, and reading it would cost one extra request per row. Drop `subtasks` from ' +
    '`--fields`, or run `jirallm fetch <KEY> --with-subtasks` for a single issue.'
  );
}

function formatSubtasksDroppedWarning(preset: PresetName | undefined): string {
  const source = preset ? `the \`${preset}\` preset lists` : 'the requested fields include';
  return (
    `Warning: ${source} \`subtasks\`, which \`search\` cannot project — ` +
    'a Jira search page carries no subtask data, so the key is omitted from the rows. Run ' +
    '`jirallm fetch <KEY> --with-subtasks` for a single issue.'
  );
}

function assertSubtasksNotRequested(
  selector: FieldSelector | undefined,
  customFieldDefs: CustomFieldDefs
): void {
  if (hasCustomOverride(customFieldDefs, SUBTASKS_KEY)) return;
  if (!isExplicitlyIncluded(selector, isSubtasksToken)) return;
  throw new Error(formatSubtasksUnsupportedError());
}

const descriptionIsOverridden = (customFieldDefs: CustomFieldDefs) =>
  hasCustomOverride(customFieldDefs, DESCRIPTION_KEY);

const descriptionExplicitlyRequested = (
  selector: FieldSelector | undefined,
  descriptionFormat: string | undefined
) => descriptionFormat !== undefined || isExplicitlyIncluded(selector, isDescriptionToken);

function assertDescriptionNotOverridden(
  selector: FieldSelector | undefined,
  customFieldDefs: CustomFieldDefs,
  descriptionFormat: string | undefined
): void {
  if (!descriptionIsOverridden(customFieldDefs)) return;
  if (!descriptionExplicitlyRequested(selector, descriptionFormat)) return;
  throw new Error(formatDescriptionOverriddenError());
}

function assertDescriptionRequested(
  descriptionFormat: string | undefined,
  friendlyKeys: readonly string[],
  selector: FieldSelector | undefined
): void {
  if (descriptionFormat === undefined) return;
  if (friendlyKeys.includes(DESCRIPTION_KEY)) return;
  if (isExplicitlyIncluded(selector, isDescriptionToken)) return;
  throw new Error(formatDescriptionFormatUnusedError());
}

const leaksSubtasks = (names: readonly string[], customFieldDefs: CustomFieldDefs) =>
  !hasCustomOverride(customFieldDefs, SUBTASKS_KEY) && names.some(isSubtasksToken);

const withoutSubtasks = (names: readonly string[], customFieldDefs: CustomFieldDefs) =>
  hasCustomOverride(customFieldDefs, SUBTASKS_KEY)
    ? [...names]
    : names.filter((name) => !isSubtasksToken(name));

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
  const epicFieldId = friendlyKeys.includes('epic')
    ? customFieldDefs.epic?.id ?? (await client.detectEpicLinkFieldId())
    : undefined;
  return { sprintFieldId, storyPointsFieldId, epicFieldId, customFieldDefs };
}

function epicFallbackIds(friendlyKeys: readonly string[], ctx: ProjectionContext) {
  if (ctx.epicFieldId) return [];
  if (!friendlyKeys.includes('epic')) return [];
  return [...COMMON_EPIC_FIELDS];
}

function withDiscoveredIds(
  jiraFieldIds: readonly string[],
  friendlyKeys: readonly string[],
  ctx: ProjectionContext
): string[] {
  const extra = [
    ...[ctx.sprintFieldId, ctx.storyPointsFieldId, ctx.epicFieldId].filter(
      (id): id is string => Boolean(id)
    ),
    ...epicFallbackIds(friendlyKeys, ctx),
  ];
  if (extra.length === 0) return [...jiraFieldIds];
  return [...new Set([...jiraFieldIds, ...extra])];
}

const withAttachmentField = (jiraFieldIds: readonly string[], rendersDescription: boolean) =>
  rendersDescription ? [...new Set([...jiraFieldIds, ATTACHMENT_FIELD_ID])] : [...jiraFieldIds];

type RowContext = {
  friendlyKeys: readonly string[];
  ctx: ProjectionContext;
  descriptionFormat: DescriptionFormat;
  rendersDescription: boolean;
};

function buildRow(
  issue: { key: string; fields: Record<string, unknown> },
  { friendlyKeys, ctx, descriptionFormat, rendersDescription }: RowContext
): SearchRow {
  const description = rendersDescription
    ? descriptionEntries(
        issue.fields.description,
        descriptionFormat,
        attachmentMetadata(issue.fields)
      )
    : {};
  const row: SearchRow = {
    key: issue.key,
    summary: (issue.fields.summary as string | undefined) ?? '',
    ...projectIssueFields(issue.fields, friendlyKeys, ctx),
    ...passThroughRawFields(issue.fields, friendlyKeys, ctx.customFieldDefs ?? {}),
    ...description,
  };
  if (friendlyKeys.includes('status') && row.status === undefined) row.status = 'Unknown';
  return row;
}

export async function runSearch(opts: SearchOptions): Promise<void> {
  const descriptionFormat = parseDescriptionFormat(opts.descriptionFormat);
  const profile = await loadOrgProfile({ org: opts.org });
  const client = new JiraClient(profile.config, profile.apiToken);

  const customFieldDefs = profile.org.export?.customFieldDefs ?? {};
  const selector = opts.fields ? parseFieldsFlag(opts.fields) : undefined;
  const resolved = resolveFieldSet(selector, customFieldDefs, {
    alwaysFetch: SEARCH_ALWAYS_FETCH,
    defaultKeys: SEARCH_DEFAULT_KEYS,
    passThroughUnknown: true,
  });

  assertSubtasksNotRequested(selector, customFieldDefs);

  if (leaksSubtasks(resolved.friendlyKeys, customFieldDefs)) {
    console.warn(formatSubtasksDroppedWarning(selector?.preset));
  }
  const friendlyKeys = withoutSubtasks(resolved.friendlyKeys, customFieldDefs);
  const jiraFieldIds = withoutSubtasks(resolved.jiraFieldIds, customFieldDefs);

  assertDescriptionNotOverridden(selector, customFieldDefs, opts.descriptionFormat);
  if (descriptionIsOverridden(customFieldDefs)) {
    console.warn(formatDescriptionOverriddenWarning());
  }

  assertDescriptionRequested(opts.descriptionFormat, friendlyKeys, selector);

  await assertFieldsKnownToJira(client, selector, customFieldDefs);

  const rendersDescription =
    friendlyKeys.includes(DESCRIPTION_KEY) && !descriptionIsOverridden(customFieldDefs);
  const ctx = await resolveProjectionContext(client, friendlyKeys, customFieldDefs);
  const limit = opts.limit ? parseInt(opts.limit, 10) : 50;

  const page = await client.searchIssues(opts.jql, {
    fields: withAttachmentField(
      withDiscoveredIds(jiraFieldIds, friendlyKeys, ctx),
      rendersDescription
    ),
    limit,
    nextPageToken: opts.nextPageToken || opts.cursor,
  });

  const rows = page.issues.map((issue) =>
    buildRow(
      { key: issue.key, fields: issue.fields as Record<string, unknown> },
      { friendlyKeys, ctx, descriptionFormat, rendersDescription }
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
