import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_FIELDS,
  BUILT_IN_FIELD_TO_JIRA_ID,
  PRESETS,
  hasSprintRequested,
  hasStoryPointsRequested,
  parseFieldsFlag,
  resolveFieldSet,
  type CustomFieldDefs,
} from './exportFields.js';

describe('parseFieldsFlag', () => {
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
