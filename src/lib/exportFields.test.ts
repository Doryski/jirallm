import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_FIELDS,
  BUILT_IN_FIELD_TO_JIRA_ID,
  JIRA_ID_TO_BUILT_IN_FIELD,
  PRESETS,
  SEARCH_ALWAYS_FETCH,
  SEARCH_DEFAULT_KEYS,
  deriveSelectorMode,
  findUnknownFieldNames,
  formatUnknownFieldNamesError,
  hasSprintRequested,
  hasStoryPointsRequested,
  normalizeFieldName,
  parseFieldsFlag,
  resolveFieldSet,
  type CustomFieldDefs,
} from './exportFields.js';

describe('normalizeFieldName', () => {
  it('returns a friendly built-in name unchanged', () => {
    expect(normalizeFieldName('issueType')).toBe('issueType');
    expect(normalizeFieldName('status')).toBe('status');
  });

  it('maps a raw Jira ID to its friendly name', () => {
    expect(normalizeFieldName('issuetype')).toBe('issueType');
    expect(normalizeFieldName('duedate')).toBe('dueDate');
    expect(normalizeFieldName('resolutiondate')).toBe('resolutionDate');
    expect(normalizeFieldName('issuelinks')).toBe('issueLinks');
    expect(normalizeFieldName('created')).toBe('createdAt');
    expect(normalizeFieldName('updated')).toBe('updatedAt');
  });

  it('matches raw Jira IDs case-insensitively', () => {
    expect(normalizeFieldName('IssueType')).toBe('issueType');
    expect(normalizeFieldName('DUEDATE')).toBe('dueDate');
  });

  it('passes custom field keys through untouched', () => {
    expect(normalizeFieldName('customfield_10020')).toBe('customfield_10020');
    expect(normalizeFieldName('severity')).toBe('severity');
  });

  it('passes unknown tokens through untouched', () => {
    expect(normalizeFieldName('totallyUnknown')).toBe('totallyUnknown');
  });

  it('derives the reverse lookup without pseudo IDs or null mappings', () => {
    expect(Object.keys(JIRA_ID_TO_BUILT_IN_FIELD).some((id) => id.startsWith('__'))).toBe(false);
    expect(Object.values(JIRA_ID_TO_BUILT_IN_FIELD)).not.toContain('key');
  });
});

describe('parseFieldsFlag', () => {
  it('returns raw tokens in bare position, leaving normalization to resolveFieldSet', () => {
    expect(parseFieldsFlag('key,issuetype,duedate')).toEqual({
      preset: undefined,
      include: ['key', 'issuetype', 'duedate'],
      exclude: [],
      mode: 'replace',
    });
  });

  it('returns raw tokens in + and - positions', () => {
    expect(parseFieldsFlag('all,+issuelinks,-resolutiondate')).toEqual({
      preset: 'all',
      include: ['issuelinks'],
      exclude: ['resolutiondate'],
      mode: 'merge',
    });
  });

  it('keeps preset tokens as presets rather than normalizing them', () => {
    expect(parseFieldsFlag('default')).toEqual({
      preset: 'default',
      include: [],
      exclude: [],
      mode: 'merge',
    });
  });

  it('parses a preset name alone', () => {
    expect(parseFieldsFlag('all')).toEqual({
      preset: 'all',
      include: [],
      exclude: [],
      mode: 'merge',
    });
    expect(parseFieldsFlag('minimal')).toEqual({
      preset: 'minimal',
      include: [],
      exclude: [],
      mode: 'merge',
    });
    expect(parseFieldsFlag('default')).toEqual({
      preset: 'default',
      include: [],
      exclude: [],
      mode: 'merge',
    });
  });

  it('parses +/- additive operators on top of default', () => {
    expect(parseFieldsFlag('+sprint,+storyPoints,-creator')).toEqual({
      preset: undefined,
      include: ['sprint', 'storyPoints'],
      exclude: ['creator'],
      mode: 'merge',
    });
  });

  it('parses bare names as an exact custom list', () => {
    expect(parseFieldsFlag('key,status,labels')).toEqual({
      preset: undefined,
      include: ['key', 'status', 'labels'],
      exclude: [],
      mode: 'replace',
    });
  });

  it('combines a preset with adjustments', () => {
    expect(parseFieldsFlag('all,-creator,+severity')).toEqual({
      preset: 'all',
      include: ['severity'],
      exclude: ['creator'],
      mode: 'merge',
    });
  });

  it('handles whitespace and empty tokens', () => {
    expect(parseFieldsFlag(' all , +x , , -y ')).toEqual({
      preset: 'all',
      include: ['x'],
      exclude: ['y'],
      mode: 'merge',
    });
  });

  it('marks a lone + token as merge mode (issue #23)', () => {
    expect(parseFieldsFlag('+priority')).toEqual({
      preset: undefined,
      include: ['priority'],
      exclude: [],
      mode: 'merge',
    });
  });

  it('drops a bare + token while still counting it as additive (issue #23)', () => {
    expect(parseFieldsFlag('+')).toEqual({
      preset: undefined,
      include: [],
      exclude: [],
      mode: 'merge',
    });
  });

  it('drops a bare - token while still counting it as additive (issue #23)', () => {
    expect(parseFieldsFlag('-')).toEqual({
      preset: undefined,
      include: [],
      exclude: [],
      mode: 'merge',
    });
  });

  it('drops a bare + token but keeps its siblings (issue #23)', () => {
    expect(parseFieldsFlag('+,+labels')).toEqual({
      preset: undefined,
      include: ['labels'],
      exclude: [],
      mode: 'merge',
    });
  });

  it('strips only one +/- prefix so a doubled prefix stays an unknown name (issue #23)', () => {
    expect(parseFieldsFlag('++labels')).toEqual({
      preset: undefined,
      include: ['+labels'],
      exclude: [],
      mode: 'merge',
    });
    expect(findUnknownFieldNames(parseFieldsFlag('++labels'))).toEqual(['+labels']);
  });
});

describe('resolveFieldSet', () => {
  it('defaults to the default preset when selector is undefined', () => {
    const r = resolveFieldSet(undefined);
    expect(r.friendlyKeys.sort()).toEqual([...PRESETS.default].sort());
  });

  it('expands the all preset', () => {
    const r = resolveFieldSet({ preset: 'all' });
    expect(r.friendlyKeys).toContain('sprint');
    expect(r.friendlyKeys).toContain('storyPoints');
    expect(r.friendlyKeys).toContain('issueLinks');
  });

  it('expands minimal preset to the legacy field set', () => {
    const r = resolveFieldSet({ preset: 'minimal' });
    expect(new Set(r.friendlyKeys)).toEqual(new Set(PRESETS.minimal));
  });

  it('applies include and exclude on top of preset', () => {
    const r = resolveFieldSet({ preset: 'minimal', include: ['labels'], exclude: ['subtasks'] });
    expect(r.friendlyKeys).toContain('labels');
    expect(r.friendlyKeys).not.toContain('subtasks');
  });

  it('treats bare-name selectors as an exact list', () => {
    const r = resolveFieldSet({ include: ['key', 'status', 'priority'], exclude: [] });
    expect(new Set(r.friendlyKeys)).toEqual(new Set(['key', 'status', 'priority']));
  });

  it('includes Jira API IDs for the always-fetch base set', () => {
    const r = resolveFieldSet({ preset: 'minimal' });
    for (const must of ['summary', 'description', 'status', 'parent', 'attachment', 'issuetype']) {
      expect(r.jiraFieldIds).toContain(must);
    }
  });

  it('maps friendly keys to standard Jira field IDs', () => {
    const r = resolveFieldSet({ preset: 'all' });
    expect(r.jiraFieldIds).toContain('priority');
    expect(r.jiraFieldIds).toContain('duedate');
    expect(r.jiraFieldIds).toContain('resolutiondate');
    expect(r.jiraFieldIds).toContain('components');
    expect(r.jiraFieldIds).toContain('labels');
    expect(r.jiraFieldIds).toContain('fixVersions');
    expect(r.jiraFieldIds).toContain('issuelinks');
  });

  it('adds custom field keys and their Jira IDs', () => {
    const defs: CustomFieldDefs = {
      severity: { id: 'customfield_99999', type: 'select' },
      team: { id: 'customfield_88888', type: 'scalar' },
    };
    const r = resolveFieldSet({ preset: 'minimal' }, defs);
    expect(r.friendlyKeys).toContain('severity');
    expect(r.friendlyKeys).toContain('team');
    expect(r.jiraFieldIds).toContain('customfield_99999');
    expect(r.jiraFieldIds).toContain('customfield_88888');
  });

  it('allows excluding a custom field', () => {
    const defs: CustomFieldDefs = {
      severity: { id: 'customfield_99999', type: 'select' },
    };
    const r = resolveFieldSet({ preset: 'minimal', exclude: ['severity'] }, defs);
    expect(r.friendlyKeys).not.toContain('severity');
  });

  it('treats empty selector as default preset', () => {
    const r1 = resolveFieldSet({});
    const r2 = resolveFieldSet({ preset: undefined, include: [], exclude: [] });
    expect(r1.friendlyKeys.sort()).toEqual([...PRESETS.default].sort());
    expect(r2.friendlyKeys.sort()).toEqual([...PRESETS.default].sort());
  });

  it('does not emit pseudo IDs like __sprint__ or __subtasks__', () => {
    const r = resolveFieldSet({ preset: 'all' });
    expect(r.jiraFieldIds.some((id) => id.startsWith('__'))).toBe(false);
  });

  it('passes through preset with only exclude (no include)', () => {
    const r = resolveFieldSet({ preset: 'default', exclude: ['priority'] });
    expect(r.friendlyKeys).not.toContain('priority');
  });
});

describe('resolveFieldSet options', () => {
  it('replaces the always-fetch seed so heavy fields do not leak in', () => {
    const r = resolveFieldSet({ preset: 'minimal' }, {}, { alwaysFetch: SEARCH_ALWAYS_FETCH });
    expect(r.jiraFieldIds).toContain('summary');
    expect(r.jiraFieldIds).toContain('status');
    expect(r.jiraFieldIds).not.toContain('description');
    expect(r.jiraFieldIds).not.toContain('attachment');
  });

  it('uses defaultKeys as the base for an absent or empty selector', () => {
    const withUndefined = resolveFieldSet(undefined, {}, { defaultKeys: SEARCH_DEFAULT_KEYS });
    const withEmpty = resolveFieldSet({}, {}, { defaultKeys: SEARCH_DEFAULT_KEYS });
    expect(new Set(withUndefined.friendlyKeys)).toEqual(new Set(SEARCH_DEFAULT_KEYS));
    expect(new Set(withEmpty.friendlyKeys)).toEqual(new Set(SEARCH_DEFAULT_KEYS));
  });

  it('still resolves the literal default preset token to PRESETS.default', () => {
    const r = resolveFieldSet({ preset: 'default' }, {}, { defaultKeys: SEARCH_DEFAULT_KEYS });
    expect(new Set(r.friendlyKeys)).toEqual(new Set(PRESETS.default));
  });

  it('widens beyond defaultKeys when a selector names the "default" preset explicitly', () => {
    const r = resolveFieldSet(parseFieldsFlag('default,-parent'), {}, {
      alwaysFetch: SEARCH_ALWAYS_FETCH,
      defaultKeys: SEARCH_DEFAULT_KEYS,
    });
    expect(new Set(r.friendlyKeys)).toEqual(
      new Set(PRESETS.default.filter((key) => key !== 'parent'))
    );
    expect(r.friendlyKeys.length).toBeGreaterThan(SEARCH_DEFAULT_KEYS.length);
  });

  it('subtracts from defaultKeys for a bare exclude-only selector', () => {
    const r = resolveFieldSet(parseFieldsFlag('-parent'), {}, {
      alwaysFetch: SEARCH_ALWAYS_FETCH,
      defaultKeys: SEARCH_DEFAULT_KEYS,
    });
    expect(new Set(r.friendlyKeys)).toEqual(
      new Set(SEARCH_DEFAULT_KEYS.filter((key) => key !== 'parent'))
    );
  });

  it('keeps custom-field and pseudo-ID semantics with options supplied', () => {
    const defs: CustomFieldDefs = { severity: { id: 'customfield_99999', type: 'select' } };
    const r = resolveFieldSet(
      { preset: 'all' },
      defs,
      { alwaysFetch: SEARCH_ALWAYS_FETCH, defaultKeys: SEARCH_DEFAULT_KEYS }
    );
    expect(r.friendlyKeys).toContain('severity');
    expect(r.jiraFieldIds).toContain('customfield_99999');
    expect(r.jiraFieldIds.some((id) => id.startsWith('__'))).toBe(false);
  });
});

describe('resolveFieldSet normalization', () => {
  it('normalizes raw Jira IDs from a parsed bare-name flag', () => {
    const r = resolveFieldSet(parseFieldsFlag('key,issuetype,duedate'));
    expect(new Set(r.friendlyKeys)).toEqual(new Set(['key', 'issueType', 'dueDate']));
    expect(r.jiraFieldIds).toContain('duedate');
  });

  it('normalizes raw Jira IDs from + and - tokens', () => {
    const r = resolveFieldSet(parseFieldsFlag('all,+issuelinks,-resolutiondate'));
    expect(r.friendlyKeys).toContain('issueLinks');
    expect(r.friendlyKeys).not.toContain('resolutionDate');
    expect(r.jiraFieldIds).not.toContain('resolutiondate');
  });

  it('normalizes a config-style selector passed directly', () => {
    const r = resolveFieldSet({ include: ['key', 'issuetype', 'duedate'], exclude: [] });
    expect(new Set(r.friendlyKeys)).toEqual(new Set(['key', 'issueType', 'dueDate']));
  });

  it('normalizes config-style exclude tokens', () => {
    const r = resolveFieldSet({ preset: 'default', exclude: ['issuetype'] });
    expect(r.friendlyKeys).not.toContain('issueType');
  });

  it('lets a configured custom field key win over a raw Jira ID alias', () => {
    const defs: CustomFieldDefs = { Created: { id: 'customfield_77777', type: 'scalar' } };
    const r = resolveFieldSet(parseFieldsFlag('default,-Created'), defs);
    expect(r.friendlyKeys).not.toContain('Created');
    expect(r.friendlyKeys).toContain('createdAt');
    expect(r.jiraFieldIds).toContain('created');
    expect(r.jiraFieldIds).not.toContain('customfield_77777');
  });

  it('still excludes the built-in when its friendly name is used', () => {
    const defs: CustomFieldDefs = { Created: { id: 'customfield_77777', type: 'scalar' } };
    const r = resolveFieldSet(parseFieldsFlag('default,-createdAt'), defs);
    expect(r.friendlyKeys).not.toContain('createdAt');
    expect(r.jiraFieldIds).not.toContain('created');
    expect(r.friendlyKeys).toContain('Created');
    expect(r.jiraFieldIds).toContain('customfield_77777');
  });
});

describe('resolveFieldSet passThroughUnknown', () => {
  it('drops unknown keys from jiraFieldIds by default', () => {
    const r = resolveFieldSet(parseFieldsFlag('key,customfield_10050,environment'));
    expect(r.friendlyKeys).toContain('customfield_10050');
    expect(r.friendlyKeys).toContain('environment');
    expect(r.jiraFieldIds).not.toContain('customfield_10050');
    expect(r.jiraFieldIds).not.toContain('environment');
  });

  it('passes unknown keys through as raw Jira field IDs when enabled', () => {
    const r = resolveFieldSet(
      parseFieldsFlag('key,customfield_10050,environment'),
      {},
      { alwaysFetch: SEARCH_ALWAYS_FETCH, passThroughUnknown: true }
    );
    expect(r.friendlyKeys).toContain('customfield_10050');
    expect(r.jiraFieldIds).toContain('customfield_10050');
    expect(r.jiraFieldIds).toContain('environment');
    expect(r.jiraFieldIds.some((id) => id.startsWith('__'))).toBe(false);
  });

  it('keeps built-in and custom mappings intact when enabled', () => {
    const defs: CustomFieldDefs = { severity: { id: 'customfield_99999', type: 'select' } };
    const r = resolveFieldSet({ preset: 'all' }, defs, { passThroughUnknown: true });
    expect(r.jiraFieldIds).toContain('customfield_99999');
    expect(r.jiraFieldIds).toContain('duedate');
    expect(r.jiraFieldIds).not.toContain('sprint');
    expect(r.jiraFieldIds.some((id) => id.startsWith('__'))).toBe(false);
  });
});

describe('resolveFieldSet additive merge (issue #23)', () => {
  it('merges a lone +name into the default preset instead of replacing it', () => {
    const r = resolveFieldSet(parseFieldsFlag('+priority'));
    for (const key of PRESETS.default) expect(r.friendlyKeys).toContain(key);
    expect(r.friendlyKeys).toContain('priority');
    expect(r.friendlyKeys).toHaveLength(PRESETS.default.length);
  });

  it('merges a lone +name that is not part of the default preset', () => {
    const r = resolveFieldSet(parseFieldsFlag('+resolution'));
    for (const key of PRESETS.default) expect(r.friendlyKeys).toContain(key);
    expect(r.friendlyKeys).toContain('resolution');
    expect(r.friendlyKeys).toHaveLength(PRESETS.default.length + 1);
  });

  it('still merges when +name and -name are combined', () => {
    const r = resolveFieldSet(parseFieldsFlag('+resolution,-creator'));
    expect(r.friendlyKeys).toContain('resolution');
    expect(r.friendlyKeys).not.toContain('creator');
    for (const key of PRESETS.default) expect(r.friendlyKeys).toContain(key);
  });

  it('still replaces exactly for a bare-name list', () => {
    const r = resolveFieldSet(parseFieldsFlag('key,status,labels'));
    expect(new Set(r.friendlyKeys)).toEqual(new Set(['key', 'status', 'labels']));
  });

  it('still subtracts a lone -name from the default preset', () => {
    const r = resolveFieldSet(parseFieldsFlag('-parent'));
    expect(new Set(r.friendlyKeys)).toEqual(
      new Set(PRESETS.default.filter((key) => key !== 'parent'))
    );
  });

  it('still subtracts a lone -name from supplied defaultKeys', () => {
    const r = resolveFieldSet(parseFieldsFlag('-parent'), {}, { defaultKeys: SEARCH_DEFAULT_KEYS });
    expect(new Set(r.friendlyKeys)).toEqual(
      new Set(SEARCH_DEFAULT_KEYS.filter((key) => key !== 'parent'))
    );
  });

  it('merges a lone +name into supplied defaultKeys rather than the default preset', () => {
    const r = resolveFieldSet(
      parseFieldsFlag('+resolution'),
      {},
      { defaultKeys: SEARCH_DEFAULT_KEYS }
    );
    expect(new Set(r.friendlyKeys)).toEqual(new Set([...SEARCH_DEFAULT_KEYS, 'resolution']));
  });

  it('never yields an empty-string friendly key for a bare + token (issue #23)', () => {
    const r = resolveFieldSet(parseFieldsFlag('+'));
    expect(r.friendlyKeys).not.toContain('');
    expect(new Set(r.friendlyKeys)).toEqual(new Set(PRESETS.default));
    expect(findUnknownFieldNames(parseFieldsFlag('+'))).toEqual([]);
  });

  it('treats a config-style selector without a mode as an exact replacement list', () => {
    const r = resolveFieldSet({ include: ['key', 'priority'] });
    expect(new Set(r.friendlyKeys)).toEqual(new Set(['key', 'priority']));
  });
});

describe('deriveSelectorMode (issue #23)', () => {
  it('lets an explicit mode win over the heuristic in both directions', () => {
    expect(deriveSelectorMode({ include: ['key'], mode: 'merge' })).toBe('merge');
    expect(deriveSelectorMode({ include: ['key'], exclude: ['status'], mode: 'replace' })).toBe(
      'replace'
    );
  });

  it('infers replace for an include-only selector', () => {
    expect(deriveSelectorMode({ include: ['key', 'status'], exclude: [] })).toBe('replace');
  });

  it('infers merge when include and exclude are both present', () => {
    expect(deriveSelectorMode({ include: ['key'], exclude: ['status'] })).toBe('merge');
  });

  it('infers merge for an exclude-only selector', () => {
    expect(deriveSelectorMode({ include: [], exclude: ['status'] })).toBe('merge');
  });

  it('infers merge for an empty or undefined selector', () => {
    expect(deriveSelectorMode({})).toBe('merge');
    expect(deriveSelectorMode(undefined)).toBe('merge');
  });

  it('infers replace for a config-style selector with exclude undefined', () => {
    expect(deriveSelectorMode({ include: ['key', 'priority'] })).toBe('replace');
  });
});

describe('findUnknownFieldNames (issue #23)', () => {
  it('returns an empty list for a valid selector', () => {
    expect(findUnknownFieldNames(parseFieldsFlag('key,status,labels'))).toEqual([]);
  });

  it('returns an empty list for an undefined selector', () => {
    expect(findUnknownFieldNames(undefined)).toEqual([]);
  });

  it('flags a misspelled include name', () => {
    expect(findUnknownFieldNames(parseFieldsFlag('key,issuelinkz'))).toEqual(['issuelinkz']);
  });

  it('flags a misspelled exclude name', () => {
    expect(findUnknownFieldNames(parseFieldsFlag('default,-issuelinkz'))).toEqual(['issuelinkz']);
  });

  it('does not flag raw Jira ID aliases that normalize to built-ins', () => {
    expect(findUnknownFieldNames(parseFieldsFlag('duedate,issuelinks,created'))).toEqual([]);
  });

  it('does not flag a configured custom field key', () => {
    const defs: CustomFieldDefs = { severity: { id: 'customfield_99999', type: 'select' } };
    expect(findUnknownFieldNames(parseFieldsFlag('key,+severity'), defs)).toEqual([]);
  });

  it('de-duplicates while preserving source order', () => {
    expect(findUnknownFieldNames(parseFieldsFlag('zeta,alpha,zeta,-alpha'))).toEqual([
      'zeta',
      'alpha',
    ]);
  });
});

describe('formatUnknownFieldNamesError (issue #23)', () => {
  it('quotes the unknown name and lists the valid built-ins', () => {
    const msg = formatUnknownFieldNamesError(['issuelinkz']);
    expect(msg).toContain('"issuelinkz"');
    expect(msg).toContain('issueLinks');
    expect(msg).toContain('storyPoints');
    expect(msg).not.toContain('custom fields');
  });

  it('lists configured custom field keys only when defs are supplied', () => {
    const defs: CustomFieldDefs = { severity: { id: 'customfield_99999', type: 'select' } };
    const msg = formatUnknownFieldNamesError(['issuelinkz'], defs);
    expect(msg).toContain('severity');
    expect(msg).toContain('custom fields');
  });

  it('hints that presets take no +/- prefix when the unknown name is a preset (issue #23)', () => {
    const msg = formatUnknownFieldNamesError(['all']);
    expect(msg).toContain('Preset names');
    expect(msg).toContain('minimal');
    expect(msg).toContain('without a +/- prefix');
  });

  it('omits the preset hint for a plain misspelling (issue #23)', () => {
    expect(formatUnknownFieldNamesError(['issuelinkz'])).not.toContain('Preset names');
  });
});

describe('BUILT_IN_FIELDS catalog', () => {
  it('has a Jira-ID mapping for every built-in field', () => {
    for (const key of BUILT_IN_FIELDS) {
      expect(BUILT_IN_FIELD_TO_JIRA_ID).toHaveProperty(key);
    }
  });

  it('default preset is a subset of all preset', () => {
    const all = new Set(PRESETS.all);
    for (const k of PRESETS.default) expect(all.has(k)).toBe(true);
  });

  it('minimal preset is a subset of default preset', () => {
    const def = new Set(PRESETS.default);
    for (const k of PRESETS.minimal) expect(def.has(k)).toBe(true);
  });
});

describe('hasSprintRequested / hasStoryPointsRequested', () => {
  it('returns true when key requested and no custom override defined', () => {
    expect(hasSprintRequested(['sprint'], {})).toBe(true);
    expect(hasStoryPointsRequested(['storyPoints'], {})).toBe(true);
  });

  it('returns false when key not requested', () => {
    expect(hasSprintRequested(['key', 'status'], {})).toBe(false);
    expect(hasStoryPointsRequested(['key', 'status'], {})).toBe(false);
  });

  it('returns false when user supplies a custom override', () => {
    const defs: CustomFieldDefs = {
      sprint: { id: 'customfield_10020', type: 'sprint' },
      storyPoints: { id: 'customfield_10016', type: 'number' },
    };
    expect(hasSprintRequested(['sprint'], defs)).toBe(false);
    expect(hasStoryPointsRequested(['storyPoints'], defs)).toBe(false);
  });
});
