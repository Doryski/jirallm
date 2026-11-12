import { describe, expect, it } from 'vitest';
import {
  beginMarker,
  createNonce,
  endMarker,
  toSingleLine,
  untrustedNotice,
  wrapUntrusted,
} from './untrusted.js';

describe('createNonce', () => {
  it('returns 16 hex characters and differs between calls', () => {
    const first = createNonce();
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(createNonce()).not.toBe(first);
  });
});

describe('wrapUntrusted', () => {
  it('puts the text between begin and end marker lines carrying the nonce', () => {
    expect(wrapUntrusted('hello\nworld\n\n', 'abc')).toBe(
      '<<<jira-data abc>>>\nhello\nworld\n<<<end-jira-data abc>>>'
    );
  });

  it('exposes the marker shapes', () => {
    expect(beginMarker('n1')).toBe('<<<jira-data n1>>>');
    expect(endMarker('n1')).toBe('<<<end-jira-data n1>>>');
  });
});

describe('untrustedNotice', () => {
  it('names both markers with the nonce', () => {
    const notice = untrustedNotice('n1');
    expect(notice).toContain('`<<<jira-data n1>>>`');
    expect(notice).toContain('`<<<end-jira-data n1>>>`');
    expect(notice).toContain('not instructions');
    expect(notice).not.toContain('\n');
  });
});

describe('toSingleLine', () => {
  it('turns line breaks and control characters into spaces', () => {
    expect(toSingleLine('a\nb\r\nc d\u0000e')).toBe('a b  c d e');
  });

  it('trims the result', () => {
    expect(toSingleLine('\n name \t')).toBe('name');
  });
});
