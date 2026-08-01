import type { CustomFieldDefs } from './exportFields.js';
import type { IssueLinkSummary, JiraTaskData, TimeTrackingSummary } from './jiraClient.js';

export const COMMON_EPIC_FIELDS = [
  'customfield_10014',
  'customfield_10008',
  'customfield_10001',
  'customfield_10011',
] as const;

export const PROJECTABLE_FIELDS = [
  'status',
  'issueType',
  'priority',
  'resolution',
  'assignee',
  'reporter',
  'creator',
  'createdAt',
  'updatedAt',
  'dueDate',
  'resolutionDate',
  'components',
  'labels',
  'fixVersions',
  'versions',
  'sprint',
  'storyPoints',
  'timetracking',
  'issueLinks',
  'parent',
  'epic',
] as const;

export type ProjectableField = (typeof PROJECTABLE_FIELDS)[number];

export type ProjectionContext = {
  sprintFieldId?: string;
  storyPointsFieldId?: string;
  customFieldDefs?: CustomFieldDefs;
};

type RawFields = Record<string, unknown>;

export function extractActiveSprintName(raw: unknown): string | undefined {
  if (!raw) return undefined;
  const arr = Array.isArray(raw) ? raw : [raw];
  type SprintLike = { name?: string; state?: string };
  const items: SprintLike[] = arr
    .map((entry): SprintLike | undefined => {
      if (entry && typeof entry === 'object') return entry as SprintLike;
      if (typeof entry === 'string') {
        const nameMatch = entry.match(/name=([^,\]]+)/);
        const stateMatch = entry.match(/state=([^,\]]+)/);
        return {
          name: nameMatch?.[1],
          state: stateMatch?.[1],
        };
      }
      return undefined;
    })
    .filter((x): x is SprintLike => Boolean(x));
  const active = items.find((s) => s.state?.toLowerCase() === 'active');
  return (active ?? items[items.length - 1])?.name;
}

export function extractCustomFieldValue(raw: unknown, type: string): unknown {
  if (raw === null || raw === undefined) return undefined;
  switch (type) {
    case 'scalar':
      return typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'
        ? raw
        : undefined;
    case 'number':
      return typeof raw === 'number' ? raw : undefined;
    case 'select':
      if (typeof raw === 'object' && raw !== null && 'value' in raw) {
        return (raw as { value: unknown }).value;
      }
      return undefined;
    case 'user':
      if (typeof raw === 'object' && raw !== null && 'displayName' in raw) {
        return (raw as { displayName: unknown }).displayName;
      }
      return undefined;
    case 'sprint':
      return extractActiveSprintName(raw);
    case 'array':
      if (!Array.isArray(raw)) return undefined;
      return raw
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && 'value' in item) {
            return (item as { value: unknown }).value;
          }
          if (item && typeof item === 'object' && 'name' in item) {
            return (item as { name: unknown }).name;
          }
          return undefined;
        })
        .filter((x) => x !== undefined);
    default:
      return undefined;
  }
}

export function extractEpicFromFields(
  fields: RawFields
): { key: string; title: string } | undefined {
  for (const fieldId of COMMON_EPIC_FIELDS) {
    const epicField = fields[fieldId] as { key: string; fields: { summary: string } } | undefined;
    if (epicField?.key && epicField.fields?.summary) {
      return { key: epicField.key, title: epicField.fields.summary };
    }
  }
  return undefined;
}

const nameOf = (raw: unknown) => (raw as { name?: string } | undefined)?.name || undefined;

const displayNameOf = (raw: unknown) =>
  (raw as { displayName?: string } | undefined)?.displayName || undefined;

const namedList = (raw: unknown) => {
  const list = raw as Array<{ name: string }> | undefined;
  if (!list?.length) return undefined;
  return list.map((item) => item.name);
};

const isoString = (raw: unknown) => (typeof raw === 'string' ? raw : undefined);

const nonEmptyString = (raw: unknown) => (typeof raw === 'string' && raw ? raw : undefined);

const extractParent = (raw: unknown) => {
  const parent = raw as
    | { key: string; fields: { summary: string; status?: { name: string } } }
    | undefined;
  if (!parent) return undefined;
  return { key: parent.key, title: parent.fields.summary, status: parent.fields.status?.name };
};

const extractTimeTracking = (raw: unknown): TimeTrackingSummary | undefined => {
  const tt = raw as TimeTrackingSummary | undefined;
  if (!tt) return undefined;
  if (!tt.originalEstimate && !tt.remainingEstimate && !tt.timeSpent) return undefined;
  return {
    originalEstimate: tt.originalEstimate,
    remainingEstimate: tt.remainingEstimate,
    timeSpent: tt.timeSpent,
  };
};

type RawIssueLink = {
  id: string;
  type: { inward?: string; outward?: string; name?: string };
  inwardIssue?: { key: string; fields: { summary: string; status?: { name: string } } };
  outwardIssue?: { key: string; fields: { summary: string; status?: { name: string } } };
};

const extractIssueLinks = (raw: unknown): IssueLinkSummary[] | undefined => {
  const links = raw as RawIssueLink[] | undefined;
  if (!links?.length) return undefined;

  const mapped: IssueLinkSummary[] = [];
  for (const link of links) {
    const issue = link.inwardIssue ?? link.outwardIssue;
    if (!issue) continue;
    const direction = link.inwardIssue ? link.type.inward : link.type.outward;
    mapped.push({
      id: link.id,
      type: direction ?? link.type.name ?? 'relates to',
      key: issue.key,
      title: issue.fields.summary,
      status: issue.fields.status?.name,
    });
  }
  return mapped.length ? mapped : undefined;
};

type FieldExtractor = (fields: RawFields, ctx: ProjectionContext) => unknown;

const EXTRACTORS = {
  status: (f) => nameOf(f.status),
  issueType: (f) => nameOf(f.issuetype),
  priority: (f) => nameOf(f.priority),
  resolution: (f) => nameOf(f.resolution),
  assignee: (f) => displayNameOf(f.assignee),
  reporter: (f) => displayNameOf(f.reporter),
  creator: (f) => displayNameOf(f.creator),
  createdAt: (f) => isoString(f.created),
  updatedAt: (f) => isoString(f.updated),
  dueDate: (f) => nonEmptyString(f.duedate),
  resolutionDate: (f) => nonEmptyString(f.resolutiondate),
  components: (f) => namedList(f.components),
  labels: (f) => {
    const labels = f.labels as string[] | undefined;
    return labels?.length ? labels : undefined;
  },
  fixVersions: (f) => namedList(f.fixVersions),
  versions: (f) => namedList(f.versions),
  sprint: (f, ctx) =>
    ctx.sprintFieldId ? nonEmptyString(extractActiveSprintName(f[ctx.sprintFieldId])) : undefined,
  storyPoints: (f, ctx) => {
    if (!ctx.storyPointsFieldId) return undefined;
    const points = f[ctx.storyPointsFieldId];
    return typeof points === 'number' ? points : undefined;
  },
  timetracking: (f) => extractTimeTracking(f.timetracking),
  issueLinks: (f) => extractIssueLinks(f.issuelinks),
  parent: (f) => extractParent(f.parent),
  epic: (f) => extractEpicFromFields(f),
} as const satisfies Record<ProjectableField, FieldExtractor>;

function projectCustomFields(
  rawFields: RawFields,
  selected: ReadonlySet<string>,
  customFieldDefs: CustomFieldDefs
): Record<string, unknown> | undefined {
  const projected: Record<string, unknown> = {};
  for (const [friendly, def] of Object.entries(customFieldDefs)) {
    if (friendly === 'sprint' || friendly === 'storyPoints') continue;
    if (!selected.has(friendly)) continue;
    const value = extractCustomFieldValue(rawFields[def.id], def.type);
    if (value !== undefined && value !== null && value !== '') projected[friendly] = value;
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
}

export function projectIssueFields(
  rawFields: RawFields,
  selectedKeys: readonly string[],
  ctx: ProjectionContext = {}
): Partial<JiraTaskData> {
  const selected = new Set(selectedKeys);
  const projected: Record<string, unknown> = {};

  for (const key of PROJECTABLE_FIELDS) {
    if (!selected.has(key)) continue;
    const value = EXTRACTORS[key](rawFields, ctx);
    if (value !== undefined) projected[key] = value;
  }

  const customFields = projectCustomFields(rawFields, selected, ctx.customFieldDefs ?? {});
  if (customFields) projected.customFields = customFields;

  return projected as Partial<JiraTaskData>;
}
