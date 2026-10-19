import { describe, expect, it } from 'vitest';
import { findVersionFieldProblems, hasRequestedVersions } from './versionFieldCheck.js';

const CONTEXT = { screen: 'edit screen of CN-1', target: 'for CN-1' };
const SCREEN = [
  { fieldId: 'summary' },
  { fieldId: 'fixVersions', allowedValues: ['W43/26', 'W44/26'] },
];

describe('hasRequestedVersions', () => {
  it('is false when no version flag was given', () => {
    expect(hasRequestedVersions({})).toBe(false);
    expect(hasRequestedVersions({ fixVersions: undefined })).toBe(false);
  });

  it('is true for a clear (empty list)', () => {
    expect(hasRequestedVersions({ versions: [] })).toBe(true);
  });
});

describe('findVersionFieldProblems', () => {
  it('returns nothing when every name is allowed', () => {
    expect(findVersionFieldProblems({ fixVersions: ['W44/26'] }, SCREEN, CONTEXT)).toEqual([]);
  });

  it('reports a field missing from the screen, naming the flag', () => {
    expect(findVersionFieldProblems({ versions: ['W43/26'] }, SCREEN, CONTEXT)).toEqual([
      "Affects versions isn't on the edit screen of CN-1, so Jira would reject --affects-versions.",
    ]);
  });

  it('reports an off-screen field even for a clear', () => {
    expect(findVersionFieldProblems({ versions: [] }, SCREEN, CONTEXT)).toHaveLength(1);
  });

  it('accepts a clear when the field is on the screen', () => {
    expect(findVersionFieldProblems({ fixVersions: [] }, SCREEN, CONTEXT)).toEqual([]);
  });

  it('lists unknown names with the valid ones', () => {
    expect(findVersionFieldProblems({ fixVersions: ['9.9.9', 'W43/26'] }, SCREEN, CONTEXT)).toEqual([
      'Unknown fix version "9.9.9" for CN-1',
      'Valid fix versions for CN-1: W43/26, W44/26.',
    ]);
  });

  it('suggests the exact spelling for a case-only mismatch', () => {
    expect(findVersionFieldProblems({ fixVersions: ['w43/26'] }, SCREEN, CONTEXT)[0]).toBe(
      'Unknown fix version "w43/26" for CN-1 — did you mean "W43/26"?'
    );
  });

  it('says (none) when the project has no versions', () => {
    const screen = [{ fieldId: 'fixVersions', allowedValues: [] }];
    expect(findVersionFieldProblems({ fixVersions: ['1.0'] }, screen, CONTEXT)).toContain(
      'Valid fix versions for CN-1: (none).'
    );
  });

  it('skips the name check when the screen exposes no allowed values', () => {
    const screen = [{ fieldId: 'fixVersions' }];
    expect(findVersionFieldProblems({ fixVersions: ['anything'] }, screen, CONTEXT)).toEqual([]);
  });

  it('ignores fields that were not requested', () => {
    expect(findVersionFieldProblems({}, [], CONTEXT)).toEqual([]);
  });
});
