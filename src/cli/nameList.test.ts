import { describe, expect, it } from 'vitest';
import { normalizeNameList } from './nameList.js';

describe('normalizeNameList', () => {
  it('returns undefined when the flag was not given', () => {
    expect(normalizeNameList(undefined)).toBeUndefined();
  });

  it('turns an empty value into an empty list (clear)', () => {
    expect(normalizeNameList([''])).toEqual([]);
    expect(normalizeNameList(['  '])).toEqual([]);
  });

  it('trims each name', () => {
    expect(normalizeNameList([' Web ', 'API'])).toEqual(['Web', 'API']);
  });

  it('de-dupes exact matches, keeping first-occurrence order', () => {
    expect(normalizeNameList(['API', 'Web', 'API', ' Web'])).toEqual(['API', 'Web']);
  });

  it('keeps names that differ only in case', () => {
    expect(normalizeNameList(['web', 'Web'])).toEqual(['web', 'Web']);
  });

  it('never splits a name containing a comma', () => {
    expect(normalizeNameList(['Frontend, Web & API'])).toEqual(['Frontend, Web & API']);
  });
});
