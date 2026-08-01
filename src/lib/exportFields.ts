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

export const JIRA_ID_TO_BUILT_IN_FIELD: Record<string, BuiltInField> = Object.fromEntries(
  Object.entries(BUILT_IN_FIELD_TO_JIRA_ID)
    .filter(([, id]) => id && !id.startsWith('__'))
    .map(([key, id]) => [(id as string).toLowerCase(), key as BuiltInField])
);

const BUILT_IN_FIELD_SET = new Set<string>(BUILT_IN_FIELDS);

const CANONICAL_FIELD_BY_LOWERCASE: Record<string, BuiltInField> = {
  ...JIRA_ID_TO_BUILT_IN_FIELD,
  ...Object.fromEntries(BUILT_IN_FIELDS.map((name) => [name.toLowerCase(), name])),
};

export function normalizeFieldName(token: string): string {
  return CANONICAL_FIELD_BY_LOWERCASE[token.trim().toLowerCase()] ?? token;
}

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

export const FIELD_SELECTOR_MODES = ['replace', 'merge'] as const;
export type FieldSelectorMode = (typeof FIELD_SELECTOR_MODES)[number];

export type FieldSelector = {
  preset?: PresetName;
  include?: string[];
  exclude?: string[];
  mode?: FieldSelectorMode;
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

export const SEARCH_ALWAYS_FETCH = ['summary', 'status'] as const;
export type SearchAlwaysFetchId = (typeof SEARCH_ALWAYS_FETCH)[number];

export const SEARCH_DEFAULT_KEYS = ['key', 'status', 'assignee', 'issueType', 'parent'] as const;
export type SearchDefaultKey = (typeof SEARCH_DEFAULT_KEYS)[number];

export type ResolveFieldSetOptions = {
  alwaysFetch?: readonly string[];
  defaultKeys?: readonly string[];
  passThroughUnknown?: boolean;
};

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
      const name = tok.slice(1).trim();
      if (name) include.push(name);
      continue;
    }
    if (tok.startsWith('-')) {
      const name = tok.slice(1).trim();
      if (name) exclude.push(name);
      continue;
    }
    // bare name → replacement mode (no preset implied unless above)
    include.push(tok);
  }

  // Only bare names (no preset, no +/-) mean "exactly this list"; anything else merges.
  const hasAdditive = tokens.some((t) => t.startsWith('+') || t.startsWith('-'));
  const isReplace = !preset && !hasAdditive && include.length > 0;

  return { preset, include, exclude, mode: isReplace ? 'replace' : 'merge' };
}

function normalizeSelectorTokens(
  tokens: string[] | undefined,
  customFieldDefs: CustomFieldDefs
): string[] | undefined {
  if (!tokens) return undefined;
  return tokens.map((t) => (Object.hasOwn(customFieldDefs, t) ? t : normalizeFieldName(t)));
}

export function deriveSelectorMode(selector: FieldSelector | undefined): FieldSelectorMode {
  if (selector?.mode) return selector.mode;
  const include = selector?.include ?? [];
  const exclude = selector?.exclude ?? [];
  if (include.length > 0 && exclude.length === 0) return 'replace';
  return 'merge';
}

export function resolveFieldSet(
  selector: FieldSelector | undefined,
  customFieldDefs: CustomFieldDefs = {},
  options: ResolveFieldSetOptions = {}
): ResolvedFieldSet {
  const customKeys = Object.keys(customFieldDefs);
  const alwaysFetch = options.alwaysFetch ?? ALWAYS_FETCH;
  const defaultKeys = options.defaultKeys ?? PRESETS.default;
  const include = normalizeSelectorTokens(selector?.include, customFieldDefs);
  const exclude = normalizeSelectorTokens(selector?.exclude, customFieldDefs);

  const effectiveMode = deriveSelectorMode(selector);

  let base: string[];
  if (!selector || (!selector.preset && !include && !exclude)) {
    base = [...defaultKeys];
  } else if (selector.preset) {
    base = [...PRESETS[selector.preset]];
  } else if (effectiveMode === 'replace' && include && include.length > 0) {
    // bare-name mode: exact set from include
    base = [...include];
  } else {
    base = [...defaultKeys];
  }

  const set = new Set(base);
  if (include) {
    for (const k of include) set.add(k);
  }
  if (exclude) {
    for (const k of exclude) set.delete(k);
  }

  // Custom field keys are always included if defined and not explicitly excluded.
  for (const k of customKeys) {
    if (!exclude?.includes(k)) set.add(k);
  }

  const friendlyKeys = [...set];

  const jiraIds = new Set<string>(alwaysFetch);
  for (const key of friendlyKeys) {
    if (key in BUILT_IN_FIELD_TO_JIRA_ID) {
      const id = BUILT_IN_FIELD_TO_JIRA_ID[key as BuiltInField];
      if (id && !id.startsWith('__')) jiraIds.add(id);
      continue;
    }
    const def = customFieldDefs[key];
    if (def) {
      jiraIds.add(def.id);
      continue;
    }
    if (options.passThroughUnknown && !key.startsWith('__')) jiraIds.add(key);
  }

  return {
    friendlyKeys,
    jiraFieldIds: [...jiraIds],
  };
}

function isKnownFieldName(name: string, customFieldDefs: CustomFieldDefs): boolean {
  if (BUILT_IN_FIELD_SET.has(name)) return true;
  if (Object.hasOwn(customFieldDefs, name)) return true;
  return name.startsWith('__');
}

export function findUnknownFieldNames(
  selector: FieldSelector | undefined,
  customFieldDefs: CustomFieldDefs = {}
): string[] {
  if (!selector) return [];
  const names = [
    ...(normalizeSelectorTokens(selector.include, customFieldDefs) ?? []),
    ...(normalizeSelectorTokens(selector.exclude, customFieldDefs) ?? []),
  ];
  const unknown = names.filter((name) => !isKnownFieldName(name, customFieldDefs));
  return [...new Set(unknown)];
}

export function formatUnknownFieldNamesError(
  unknownNames: string[],
  customFieldDefs: CustomFieldDefs = {}
): string {
  const label = unknownNames.length > 1 ? 'fields' : 'field';
  const quoted = unknownNames.map((name) => `"${name}"`).join(', ');
  const customKeys = Object.keys(customFieldDefs);
  const custom = customKeys.length ? ` Configured custom fields: ${customKeys.join(', ')}.` : '';
  const presetNames = Object.keys(PRESETS);
  const usedPresets = unknownNames.filter((name) => presetNames.includes(name));
  const presetHint = usedPresets.length
    ? ` Preset names (${presetNames.join(', ')}) are used without a +/- prefix, e.g. --fields "${usedPresets[0]},+labels".`
    : '';
  return `Unknown ${label} ${quoted}. Valid fields: ${BUILT_IN_FIELDS.join(
    ', '
  )}.${custom}${presetHint}`;
}

const MAX_SUGGESTIONS = 3;
const MAX_SUGGESTION_LENGTH = 64;

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, substitution);
    }
    previous = row;
  }
  return previous[b.length];
}

export function closestFieldName(
  name: string,
  candidates: readonly string[]
): string | undefined {
  const target = name.toLowerCase();
  if (target.length > MAX_SUGGESTION_LENGTH) return undefined;
  const tolerance = target.length <= 4 ? 1 : 2;
  let best: { candidate: string; distance: number } | undefined;
  for (const candidate of candidates) {
    if (Math.abs(candidate.length - target.length) > tolerance) continue;
    const distance = editDistance(target, candidate.toLowerCase());
    if (distance > tolerance) continue;
    if (best && best.distance <= distance) continue;
    best = { candidate, distance };
  }
  return best?.candidate;
}

function formatSuggestionHint(pairs: readonly (readonly [string, string])[], single: boolean) {
  if (pairs.length === 0) return '';
  if (single) return ` Did you mean "${pairs[0][1]}"?`;
  const listed = pairs.map(([from, to]) => `"${from}" → "${to}"`).join(', ');
  return ` Did you mean: ${listed}?`;
}

export function formatUnresolvedFieldNamesError(
  unresolvedNames: readonly string[],
  catalogNames: readonly string[] = [],
  customFieldDefs: CustomFieldDefs = {}
): string {
  const label = unresolvedNames.length > 1 ? 'fields' : 'field';
  const subject = unresolvedNames.length > 1 ? 'They match' : 'It matches';
  const quoted = unresolvedNames.map((name) => `"${name}"`).join(', ');
  const candidates = [
    ...new Set([...BUILT_IN_FIELDS, ...Object.keys(customFieldDefs), ...catalogNames]),
  ];
  const pairs = unresolvedNames
    .map((name) => [name, closestFieldName(name, candidates)] as const)
    .filter((pair): pair is readonly [string, string] => Boolean(pair[1]))
    .slice(0, MAX_SUGGESTIONS);
  const hint = formatSuggestionHint(pairs, unresolvedNames.length === 1);
  return (
    `Unknown ${label} ${quoted}. ${subject} neither a jirallm field name nor any field ` +
    `in this Jira instance.${hint} Run \`jirallm fields\` to list this instance's custom ` +
    'fields and their ids.'
  );
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
