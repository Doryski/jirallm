import { describe, expect, it } from 'vitest';
import { formatCustomFieldWrite, parseFieldFlag, parseFieldFlags } from './customFieldWrite.js';
import type { CustomFieldDefs } from './exportFields.js';

describe('formatCustomFieldWrite', () => {
  it('returns raw string for scalar', () => {
    expect(formatCustomFieldWrite('scalar', 'Chrome')).toBe('Chrome');
  });

  it('wraps select in { value }', () => {
    expect(formatCustomFieldWrite('select', 'High')).toEqual({ value: 'High' });
  });

  it('coerces number', () => {
    expect(formatCustomFieldWrite('number', '5')).toBe(5);
  });

  it('throws on non-numeric number', () => {
    expect(() => formatCustomFieldWrite('number', 'abc')).toThrow(/number/);
  });

  it('splits array into [{ value }]', () => {
    expect(formatCustomFieldWrite('array', 'a, b ,c')).toEqual([
      { value: 'a' },
      { value: 'b' },
      { value: 'c' },
    ]);
  });

  it('wraps user in { accountId }', () => {
    expect(formatCustomFieldWrite('user', 'acc-1')).toEqual({ accountId: 'acc-1' });
  });

  it('coerces sprint id to number', () => {
    expect(formatCustomFieldWrite('sprint', '42')).toBe(42);
  });
});

const DEFS: CustomFieldDefs = {
  severity: { id: 'customfield_10050', type: 'select' },
  storyPoints: { id: 'customfield_10016', type: 'number' },
};

describe('parseFieldFlag', () => {
  it('resolves a configured friendly name to id + shaped value', () => {
    expect(parseFieldFlag('severity=High', DEFS)).toEqual({
      jiraId: 'customfield_10050',
      shaped: { value: 'High' },
    });
  });

  it('uses the configured type (number) for friendly names', () => {
    expect(parseFieldFlag('storyPoints=8', DEFS)).toEqual({
      jiraId: 'customfield_10016',
      shaped: 8,
    });
  });

  it('accepts a raw customfield id with inline type', () => {
    expect(parseFieldFlag('customfield_10099:select=PROD', {})).toEqual({
      jiraId: 'customfield_10099',
      shaped: { value: 'PROD' },
    });
  });

  it('defaults raw customfield ids to scalar when no type given', () => {
    expect(parseFieldFlag('customfield_10099=plain', {})).toEqual({
      jiraId: 'customfield_10099',
      shaped: 'plain',
    });
  });

  it('keeps = signs in the value (splits on first =)', () => {
    expect(parseFieldFlag('customfield_10099=a=b', {})).toEqual({
      jiraId: 'customfield_10099',
      shaped: 'a=b',
    });
  });

  it('throws on a token without =', () => {
    expect(() => parseFieldFlag('severity', DEFS)).toThrow(/key=value/);
  });

  it('throws on an unknown bare name, listing configured fields', () => {
    expect(() => parseFieldFlag('unknown=x', DEFS)).toThrow(/severity/);
  });

  it('throws on an invalid inline type', () => {
    expect(() => parseFieldFlag('customfield_10099:bogus=x', {})).toThrow(/type/);
  });
});

describe('parseFieldFlags', () => {
  it('returns undefined for empty input', () => {
    expect(parseFieldFlags(undefined, DEFS)).toBeUndefined();
    expect(parseFieldFlags([], DEFS)).toBeUndefined();
  });

  it('reduces multiple tokens into a single id→value map', () => {
    expect(parseFieldFlags(['severity=High', 'customfield_10099:select=PROD'], DEFS)).toEqual({
      customfield_10050: { value: 'High' },
      customfield_10099: { value: 'PROD' },
    });
  });
});
