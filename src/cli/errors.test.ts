import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JiraApiError } from '../lib/jiraClient.js';
import { exitOnError, formatError } from './errors.js';

function jiraApiError(): JiraApiError {
  return Object.assign(Object.create(JiraApiError.prototype), {
    name: 'JiraApiError',
    message: 'Jira API request failed: 401 Unauthorized',
    stack: 'JiraApiError: Jira API request failed: 401 Unauthorized\n    at fromResponse',
    status: 401,
    headers: { 'atl-request-id': 'abc' },
  });
}

const plainError = new Error('No API token provided.');

describe('formatError', () => {
  it.each([
    ['a plain Error', plainError, 'No API token provided.'],
    ['an Error with errno props (EAGAIN)', Object.assign(new Error('EAGAIN: read'), { code: 'EAGAIN', errno: -35 }), 'EAGAIN: read'],
    ['a JiraApiError carrying headers', jiraApiError(), 'Jira API request failed: 401 Unauthorized'],
    ['a thrown string', 'boom', 'boom'],
    ['a thrown non-Error object', { reason: 'x' }, '[object Object]'],
    ['undefined', undefined, 'undefined'],
  ])('prints only the message, with no stack or props, for %s', (_label, err, expected) => {
    const out = formatError(err, { json: false, debug: false });

    expect(out).toBe(expected);
    expect(out).not.toMatch(/\n\s+at /);
  });

  it('prints the stack when debug is on', () => {
    const out = formatError(plainError, { json: false, debug: true });

    expect(out).toContain('No API token provided.');
    expect(out).toMatch(/\n\s+at /);
  });

  it('falls back to the plain value under debug when there is no stack', () => {
    expect(formatError('boom', { json: false, debug: true })).toBe('boom');
  });

  it.each([
    [false, plainError],
    [true, plainError],
    [false, 'boom'],
  ])('emits {"error": message} in JSON mode (debug=%s)', (debug, err) => {
    const out = formatError(err, { json: true, debug });

    expect(JSON.parse(out)).toEqual({ error: err instanceof Error ? err.message : err });
  });
});

describe('exitOnError (the top-level handler of the CLI entry)', () => {
  const originalArgv = process.argv;
  let errs: string[];

  beforeEach(() => {
    errs = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => {
      errs.push(a.map(String).join(' '));
    });
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    delete process.env.DEBUG;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.argv = originalArgv;
    delete process.env.DEBUG;
  });

  it('prints one clean line and exits 1 (no "Unexpected error:" prefix, no stack)', () => {
    process.argv = ['node', 'jirallm', 'init', '--org', 'acme'];

    expect(() => exitOnError(plainError)).toThrow('exit:1');
    expect(errs).toEqual(['No API token provided.']);
  });

  it('keeps the stack available behind DEBUG', () => {
    process.argv = ['node', 'jirallm', 'orgs', 'rm'];
    process.env.DEBUG = '1';

    expect(() => exitOnError(plainError)).toThrow('exit:1');
    expect(errs[0]).toMatch(/\n\s+at /);
  });

  it('reports JSON when --json is on the command line', () => {
    process.argv = ['node', 'jirallm', 'worklog', '--json'];

    expect(() => exitOnError(plainError)).toThrow('exit:1');
    expect(JSON.parse(errs[0])).toEqual({ error: 'No API token provided.' });
  });
});
