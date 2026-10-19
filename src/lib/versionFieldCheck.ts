export const VERSION_FIELDS = {
  fixVersions: { label: 'Fix versions', noun: 'fix version', flag: '--fix-versions' },
  versions: { label: 'Affects versions', noun: 'affects version', flag: '--affects-versions' },
} as const;

export type VersionFieldId = keyof typeof VERSION_FIELDS;
export type RequestedVersions = Partial<Record<VersionFieldId, string[]>>;
export type ScreenField = { fieldId: string; allowedValues?: string[] };
export type ScreenContext = { screen: string; target: string };

const VERSION_FIELD_IDS = Object.keys(VERSION_FIELDS) as VersionFieldId[];

export function hasRequestedVersions(requested: RequestedVersions): boolean {
  return VERSION_FIELD_IDS.some((id) => requested[id] !== undefined);
}

function unknownNameProblems(id: VersionFieldId, names: string[], allowed: string[], target: string): string[] {
  const { noun } = VERSION_FIELDS[id];
  const unknown = names.filter((name) => !allowed.includes(name));
  if (unknown.length === 0) return [];
  const lines = unknown.map((name) => {
    const suggestion = allowed.find((a) => a.toLowerCase() === name.toLowerCase());
    const hint = suggestion ? ` — did you mean "${suggestion}"?` : '';
    return `Unknown ${noun} "${name}" ${target}${hint}`;
  });
  const valid = allowed.length > 0 ? allowed.join(', ') : '(none)';
  return [...lines, `Valid ${noun}s ${target}: ${valid}.`];
}

function fieldProblems(
  id: VersionFieldId,
  names: string[],
  screenFields: ScreenField[],
  context: ScreenContext
): string[] {
  const { label, flag } = VERSION_FIELDS[id];
  const field = screenFields.find((f) => f.fieldId === id);
  if (!field) return [`${label} isn't on the ${context.screen}, so Jira would reject ${flag}.`];
  if (names.length === 0 || !field.allowedValues) return [];
  return unknownNameProblems(id, names, field.allowedValues, context.target);
}

/**
 * Which requested version writes Jira would reject, judged from a screen's field metadata
 * (`editmeta` / `createmeta`): the field missing from the screen, or a name that is not one
 * of the screen's allowed values (exact match, as Jira stores it). Query only.
 */
export function findVersionFieldProblems(
  requested: RequestedVersions,
  screenFields: ScreenField[],
  context: ScreenContext
): string[] {
  return VERSION_FIELD_IDS.flatMap((id) => {
    const names = requested[id];
    if (names === undefined) return [];
    return fieldProblems(id, names, screenFields, context);
  });
}
