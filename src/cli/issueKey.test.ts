import { describe, expect, it } from 'vitest';
import { parseIssueKey, parseIssueKeyArgs } from './issueKey.js';

describe('parseIssueKey', () => {
  it('parses a bare issue key', () => {
    expect(parseIssueKey('PROJ-123')).toEqual({ org: undefined, key: 'PROJ-123', projectKey: 'PROJ' });
  });

  it('uppercases lowercase input', () => {
    expect(parseIssueKey('proj-123')).toEqual({ org: undefined, key: 'PROJ-123', projectKey: 'PROJ' });
  });

  it('parses an org-qualified key', () => {
    expect(parseIssueKey('acme/PROJ-123')).toEqual({
      org: 'acme',
      key: 'PROJ-123',
      projectKey: 'PROJ',
    });
  });

  it('rejects garbage', () => {
    expect(() => parseIssueKey('not-an-issue')).toThrow(/Invalid issue key/);
    expect(() => parseIssueKey('123')).toThrow(/Invalid issue key/);
    expect(() => parseIssueKey('/PROJ-1')).toThrow(/Invalid org prefix/);
  });
});

describe('parseIssueKeyArgs', () => {
  it('happy path with bare keys', () => {
    expect(parseIssueKeyArgs(['PROJ-1', 'PROJ-2'])).toEqual({
      org: undefined,
      projectKey: 'PROJ',
      keys: ['PROJ-1', 'PROJ-2'],
    });
  });

  it('happy path with consistent org/ prefix', () => {
    expect(parseIssueKeyArgs(['acme/PROJ-1', 'acme/PROJ-2'])).toEqual({
      org: 'acme',
      projectKey: 'PROJ',
      keys: ['PROJ-1', 'PROJ-2'],
    });
  });

  it('rejects mixed project prefixes', () => {
    expect(() => parseIssueKeyArgs(['PROJ-1', 'DOCS-2'])).toThrow(/same project prefix/);
  });

  it('rejects mixed org prefixes', () => {
    expect(() => parseIssueKeyArgs(['acme/PROJ-1', 'globex/PROJ-2'])).toThrow(/Mixed org prefixes/);
  });

  it('rejects partial org/ qualification', () => {
    expect(() => parseIssueKeyArgs(['acme/PROJ-1', 'PROJ-2'])).toThrow(/all issue keys must include/i);
  });
});
