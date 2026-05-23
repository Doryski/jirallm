export const BUILT_IN_FIELDS = [
  'key',
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
  'subtasks',
] as const;

export type BuiltInField = (typeof BUILT_IN_FIELDS)[number];

export const BUILT_IN_FIELD_TO_JIRA_ID: Record<BuiltInField, string | null> = {
  key: null,
  status: 'status',
  issueType: 'issuetype',
  priority: 'priority',
  resolution: 'resolution',
  assignee: 'assignee',
  reporter: 'reporter',
  creator: 'creator',
  createdAt: 'created',
  updatedAt: 'updated',
  dueDate: 'duedate',
  resolutionDate: 'resolutiondate',
  components: 'components',
  labels: 'labels',
  fixVersions: 'fixVersions',
  versions: 'versions',
  sprint: '__sprint__',
  storyPoints: '__storyPoints__',
  timetracking: 'timetracking',
  issueLinks: 'issuelinks',
  parent: 'parent',
  epic: '__epic__',
  subtasks: '__subtasks__',
};

export const PRESETS = {
  minimal: ['key', 'status', 'issueType', 'parent', 'epic', 'subtasks'],
  default: [
    'key',
    'status',
    'issueType',
    'priority',
    'assignee',
    'reporter',
    'createdAt',
    'updatedAt',
    'dueDate',
    'components',
    'labels',
    'fixVersions',
    'sprint',
    'storyPoints',
    'parent',
    'epic',
    'subtasks',
    'issueLinks',
  ],
  all: [...BUILT_IN_FIELDS],
} as const;

export type PresetName = keyof typeof PRESETS;

export type FieldSelector = {
  preset?: PresetName;
  include?: string[];
  exclude?: string[];
};

export const CUSTOM_FIELD_TYPES = ['scalar', 'select', 'user', 'sprint', 'number', 'array'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export type CustomFieldDef = {
  id: string;
  type: CustomFieldType;
};

export type CustomFieldDefs = Record<string, CustomFieldDef>;

export type ResolvedFieldSet = {
  friendlyKeys: string[];
  jiraFieldIds: string[];
};

const ALWAYS_FETCH = ['summary', 'description', 'status', 'parent', 'attachment', 'issuetype'];

export function parseFieldsFlag(raw: string): FieldSelector {
  const tokens = raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const include: string[] = [];
  const exclude: string[] = [];
  let preset: PresetName | undefined;

  for (const tok of tokens) {
    if (tok === 'all' || tok === 'default' || tok === 'minimal') {
      preset = tok;
      continue;
    }
    if (tok.startsWith('+')) {
      include.push(tok.slice(1));
      continue;
    }
    if (tok.startsWith('-')) {
      exclude.push(tok.slice(1));
      continue;
    }
    // bare name → replacement mode (no preset implied unless above)
    include.push(tok);
  }

  // If no preset and only bare names (no +/-), treat as custom list (preset=undefined, include=names).
  // The resolver will treat preset=undefined as "exactly the include list".
  const hasAdditive = tokens.some((t) => t.startsWith('+') || t.startsWith('-'));
  if (!preset && !hasAdditive && include.length > 0) {
    return { include, exclude: [] };
  }

  return { preset, include, exclude };
}

export function resolveFieldSet(
  selector: FieldSelector | undefined,
  customFieldDefs: CustomFieldDefs = {}
): ResolvedFieldSet {
  const customKeys = Object.keys(customFieldDefs);

  let base: string[];
  if (!selector || (!selector.preset && !selector.include && !selector.exclude)) {
    base = [...PRESETS.default];
  } else if (selector.preset) {
    base = [...PRESETS[selector.preset]];
  } else if (selector.include && selector.include.length > 0 && !selector.exclude?.length) {
    // bare-name mode: exact set from include
    base = [...selector.include];
  } else {
    base = [...PRESETS.default];
  }

  const set = new Set(base);
  if (selector?.include) {
    for (const k of selector.include) set.add(k);
  }
  if (selector?.exclude) {
    for (const k of selector.exclude) set.delete(k);
  }

  // Custom field keys are always included if defined and not explicitly excluded.
  for (const k of customKeys) {
    if (!selector?.exclude?.includes(k)) set.add(k);
  }

  const friendlyKeys = [...set];

  const jiraIds = new Set<string>(ALWAYS_FETCH);
  for (const key of friendlyKeys) {
    if (key in BUILT_IN_FIELD_TO_JIRA_ID) {
      const id = BUILT_IN_FIELD_TO_JIRA_ID[key as BuiltInField];
      if (id && !id.startsWith('__')) jiraIds.add(id);
    } else {
      const def = customFieldDefs[key];
      if (def) jiraIds.add(def.id);
    }
  }

  return {
    friendlyKeys,
    jiraFieldIds: [...jiraIds],
  };
}

export function hasSprintRequested(friendlyKeys: string[], customFieldDefs: CustomFieldDefs): boolean {
  if (!friendlyKeys.includes('sprint')) return false;
  // If user provided a "sprint" custom field override, no autodetection needed.
  return !customFieldDefs.sprint;
}

export function hasStoryPointsRequested(
  friendlyKeys: string[],
  customFieldDefs: CustomFieldDefs
): boolean {
  if (!friendlyKeys.includes('storyPoints')) return false;
  return !customFieldDefs.storyPoints;
}
