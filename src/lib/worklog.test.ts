import { describe, expect, it } from 'vitest';
import {
  parseDuration,
  validateWorklog,
  validateAll,
  formatStartedForJira,
  formatDurationHuman,
} from './worklog.js';

describe('parseDuration', () => {
  it.each([
    [3600, 3600],
    ['3600', 3600],
    ['1h', 3600],
    ['30m', 1800],
    ['1h 30m', 5400],
    ['1h30m', 5400],
    ['2h 15m 30s', 8130],
    ['1d', 86400],
    ['PT1H', 3600],
    ['PT1H30M', 5400],
    ['PT45M', 2700],
    ['PT1H30M15S', 5415],
  ])('parses %j as %i seconds', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['', '0', 'abc', '-1h', 'PT0H'])('rejects %j', (bad) => {
    expect(() => parseDuration(bad)).toThrow();
  });

  it('rejects non-positive numbers', () => {
    expect(() => parseDuration(0)).toThrow();
    expect(() => parseDuration(-5)).toThrow();
  });
});

describe('validateWorklog', () => {
  const base = { issueKey: 'PROJ-1' };

  it('accepts start + duration', () => {
    const v = validateWorklog(
      { ...base, startTime: '2026-05-23T09:00:00Z', duration: '1h' },
      0
    );
    expect(v.issueKey).toBe('PROJ-1');
    expect(v.projectKey).toBe('PROJ');
    expect(v.durationSeconds).toBe(3600);
  });

  it('accepts start + end and derives duration', () => {
    const v = validateWorklog(
      { ...base, startTime: '2026-05-23T09:00:00Z', endTime: '2026-05-23T10:30:00Z' },
      0
    );
    expect(v.durationSeconds).toBe(5400);
  });

  it('accepts end + duration and derives start', () => {
    const v = validateWorklog(
      { ...base, endTime: '2026-05-23T10:30:00Z', duration: '90m' },
      0
    );
    expect(v.durationSeconds).toBe(5400);
    expect(v.started.toISOString()).toBe('2026-05-23T09:00:00.000Z');
  });

  it('accepts all three when consistent', () => {
    const v = validateWorklog(
      {
        ...base,
        startTime: '2026-05-23T09:00:00Z',
        endTime: '2026-05-23T10:00:00Z',
        duration: 3600,
      },
      0
    );
    expect(v.durationSeconds).toBe(3600);
  });

  it('rejects inconsistent all-three', () => {
    expect(() =>
      validateWorklog(
        {
          ...base,
          startTime: '2026-05-23T09:00:00Z',
          endTime: '2026-05-23T10:00:00Z',
          duration: '2h',
        },
        0
      )
    ).toThrow(/inconsistent/i);
  });

  it('rejects only one time field', () => {
    expect(() =>
      validateWorklog({ ...base, startTime: '2026-05-23T09:00:00Z' }, 0)
    ).toThrow(/at least 2/i);
  });

  it('rejects malformed issueKey', () => {
    expect(() => validateWorklog({ issueKey: 'not-a-key!', duration: '1h', startTime: '2026-05-23T09:00:00Z' }, 0)).toThrow();
  });

  it('rejects bad ISO date', () => {
    expect(() =>
      validateWorklog({ ...base, startTime: 'yesterday', duration: '1h' }, 0)
    ).toThrow(/startTime/);
  });

  it('rejects endTime before startTime', () => {
    expect(() =>
      validateWorklog(
        { ...base, startTime: '2026-05-23T10:00:00Z', endTime: '2026-05-23T09:00:00Z' },
        0
      )
    ).toThrow(/after startTime/);
  });

  it('extracts org prefix from issueKey', () => {
    const v = validateWorklog(
      { issueKey: 'acme/PROJ-1', startTime: '2026-05-23T09:00:00Z', duration: '1h' },
      0
    );
    expect(v.org).toBe('acme');
    expect(v.issueKey).toBe('PROJ-1');
  });

  it('honors explicit org field', () => {
    const v = validateWorklog(
      { issueKey: 'PROJ-1', org: 'foo', startTime: '2026-05-23T09:00:00Z', duration: '1h' },
      0
    );
    expect(v.org).toBe('foo');
  });

  it('validates visibility shape', () => {
    expect(() =>
      validateWorklog(
        { ...base, startTime: '2026-05-23T09:00:00Z', duration: '1h', visibility: { type: 'bad', value: 'x' } },
        0
      )
    ).toThrow(/visibility/);
  });
});

describe('validateAll', () => {
  it('collects errors with their index', () => {
    const { valid, errors } = validateAll([
      { issueKey: 'PROJ-1', startTime: '2026-05-23T09:00:00Z', duration: '1h' },
      { issueKey: 'bad', duration: '1h' },
      { issueKey: 'PROJ-2', startTime: 'nope', duration: '30m' },
    ]);
    expect(valid).toHaveLength(1);
    expect(errors).toHaveLength(2);
    expect(errors[0].index).toBe(1);
    expect(errors[1].index).toBe(2);
  });
});

describe('formatStartedForJira', () => {
  it('emits yyyy-MM-ddTHH:mm:ss.SSS+HHmm (no colon in offset)', () => {
    const d = new Date('2026-05-23T09:00:00Z');
    const out = formatStartedForJira(d);
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/);
  });
});

describe('formatDurationHuman', () => {
  it.each([
    [3600, '1h'],
    [5400, '1h 30m'],
    [1800, '30m'],
    [90, '1m 30s'],
    [3, '3s'],
  ])('formats %i as %j', (sec, expected) => {
    expect(formatDurationHuman(sec)).toBe(expected);
  });
});
