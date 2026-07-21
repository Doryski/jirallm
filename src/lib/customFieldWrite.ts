import { CUSTOM_FIELD_TYPES } from './exportFields.js';
import type { CustomFieldDefs, CustomFieldType } from './exportFields.js';

/**
 * Shape a raw string value into the payload Jira expects for a write, per field type.
 * Inverse of `extractCustomFieldValue` (read side) in jiraClient.ts.
 */
export function formatCustomFieldWrite(type: CustomFieldType, raw: string): unknown {
  switch (type) {
    case 'scalar':
      return raw;
    case 'number': {
      const n = Number(raw);
      if (Number.isNaN(n)) throw new Error(`Expected a number for custom field, got "${raw}".`);
      return n;
    }
    case 'select':
      return { value: raw };
    case 'array':
      return raw
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .map((value) => ({ value }));
    case 'user':
      return { accountId: raw };
    case 'sprint': {
      const n = Number(raw);
      if (Number.isNaN(n)) throw new Error(`Expected a sprint id (number), got "${raw}".`);
      return n;
    }
    default:
      return raw;
  }
}

const CUSTOM_FIELD_ID_RE = /^customfield_\d+$/;

function isCustomFieldType(value: string): value is CustomFieldType {
  return (CUSTOM_FIELD_TYPES as readonly string[]).includes(value);
}

export type ParsedField = { jiraId: string; shaped: unknown };

/**
 * Resolve a single `--field key=value` token to a Jira field id and its shaped write value.
 * Key resolution:
 *  1. Friendly name configured in customFieldDefs → use its {id, type}.
 *  2. Raw `customfield_NNNNN[:type]` → inline type, or default to `scalar`.
 *  3. Anything else → error listing configured friendly names.
 */
export function parseFieldFlag(token: string, customFieldDefs: CustomFieldDefs = {}): ParsedField {
  const eq = token.indexOf('=');
  if (eq === -1) {
    throw new Error(`Invalid --field "${token}". Expected key=value.`);
  }
  const key = token.slice(0, eq).trim();
  const value = token.slice(eq + 1);

  const def = customFieldDefs[key];
  if (def) {
    return { jiraId: def.id, shaped: formatCustomFieldWrite(def.type, value) };
  }

  const [rawId, inlineType] = key.split(':');
  if (CUSTOM_FIELD_ID_RE.test(rawId)) {
    const type = inlineType ?? 'scalar';
    if (!isCustomFieldType(type)) {
      throw new Error(
        `Unknown custom field type "${type}" in "${token}". Expected one of: ${CUSTOM_FIELD_TYPES.join(', ')}.`
      );
    }
    return { jiraId: rawId, shaped: formatCustomFieldWrite(type, value) };
  }

  const known = Object.keys(customFieldDefs);
  const hint = known.length
    ? ` Configured custom fields: ${known.join(', ')}.`
    : ' No custom fields configured; use customfield_NNNNN[:type]=value.';
  throw new Error(`Unknown custom field "${key}".${hint}`);
}

/**
 * Which of the given custom-field ids are NOT on the create screen.
 *
 * Jira's create endpoint silently drops (and applies field defaults to) custom
 * fields absent from a project + issue-type create screen, whereas the edit
 * endpoint's screen includes them — so `create --field` needs this guard where
 * `edit --field` does not. Query only: the caller decides how to react.
 */
export function findFieldsOffCreateScreen(
  jiraIds: string[],
  createScreenFieldIds: Iterable<string>
): string[] {
  const onScreen = new Set(createScreenFieldIds);
  return jiraIds.filter((id) => !onScreen.has(id));
}

/** Reduce a list of `--field` tokens to a merge-ready { jiraId: shapedValue } map. */
export function parseFieldFlags(
  tokens: string[] | undefined,
  customFieldDefs: CustomFieldDefs = {}
): Record<string, unknown> | undefined {
  if (!tokens || tokens.length === 0) return undefined;
  const out: Record<string, unknown> = {};
  for (const token of tokens) {
    const { jiraId, shaped } = parseFieldFlag(token, customFieldDefs);
    out[jiraId] = shaped;
  }
  return out;
}
