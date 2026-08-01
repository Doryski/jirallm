import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_FIELDS,
  BUILT_IN_FIELD_TO_JIRA_ID,
  JIRA_ID_TO_BUILT_IN_FIELD,
  PRESETS,
  SEARCH_ALWAYS_FETCH,
  SEARCH_DEFAULT_KEYS,
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
      include: ['key', 'issuetype', 'duedate'],
      exclude: [],
    });
  });

  it('returns raw tokens in + and - positions', () => {
    expect(parseFieldsFlag('all,+issuelinks,-resolutiondate')).toEqual({
      preset: 'all',
      include: ['issuelinks'],
      exclude: ['resolutiondate'],
    });
  });

  it('keeps preset tokens as presets rather than normalizing them', () => {
    expect(parseFieldsFlag('default')).toEqual({ preset: 'default', include: [], exclude: [] });
  });

  it('parses a preset name alone', () => {
    expect(parseFieldsFlag('all')).toEqual({ preset: 'all', include: [], exclude: [] });
    expect(parseFieldsFlag('minimal')).toEqual({ preset: 'minimal', include: [], exclude: [] });
    expect(parseFieldsFlag('default')).toEqual({ preset: 'default', include: [], exclude: [] });
  });

  it('parses +/- additive operators on top of default', () => {
    expect(parseFieldsFlag('+sprint,+storyPoints,-creator')).toEqual({
      preset: undefined,
      include: ['sprint', 'storyPoints'],
      exclude: ['creator'],
    });
  });

  it('parses bare names as an exact custom list', () => {
    expect(parseFieldsFlag('key,status,labels')).toEqual({
      include: ['key', 'status', 'labels'],
      exclude: [],
    });
  });

  it('combines a preset with adjustments', () => {
    expect(parseFieldsFlag('all,-creator,+severity')).toEqual({
      preset: 'all',
      include: ['severity'],
      exclude: ['creator'],
    });
  });

  it('handles whitespace and empty tokens', () => {
    expect(parseFieldsFlag(' all , +x , , -y ')).toEqual({
      preset: 'all',
      include: ['x'],
      exclude: ['y'],
    });
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
