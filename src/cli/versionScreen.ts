import {
  VERSION_FIELDS,
  findVersionFieldProblems,
  hasRequestedVersions,
} from '../lib/versionFieldCheck.js';
import type { RequestedVersions, ScreenContext, ScreenField } from '../lib/versionFieldCheck.js';

type ScreenCheck = {
  load: () => Promise<ScreenField[]>;
  context: ScreenContext;
  remedy: string;
};

const requestedFlags = (requested: RequestedVersions) =>
  Object.entries(VERSION_FIELDS)
    .filter(([id]) => requested[id as keyof RequestedVersions] !== undefined)
    .map(([, meta]) => meta.flag)
    .join(' / ');

/**
 * Abort before any write when Jira would reject a version flag: the field is not on the
 * screen for this operation, or a name is not one of its allowed values. If the screen
 * metadata can't be read (e.g. permissions), warn and proceed — the write may still work.
 */
export async function assertVersionsSettable(
  requested: RequestedVersions,
  { load, context, remedy }: ScreenCheck
): Promise<void> {
  if (!hasRequestedVersions(requested)) return;
  let fields: ScreenField[];
  try {
    fields = await load();
  } catch (err) {
    const reason = err instanceof Error ? err.message.split('\n')[0] : String(err);
    console.warn(
      `Warning: could not read the ${context.screen} (${reason}) — proceeding without checking ${requestedFlags(requested)}.`
    );
    return;
  }
  const problems = findVersionFieldProblems(requested, fields, context);
  if (problems.length === 0) return;
  throw new Error([...problems, remedy].join('\n'));
}

export function nonEmptyOrUndefined(names: string[] | undefined): string[] | undefined {
  return names?.length ? names : undefined;
}
