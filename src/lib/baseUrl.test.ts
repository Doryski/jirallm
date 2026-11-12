import { describe, expect, it } from 'vitest';
import {
  assertSecureBaseUrl,
  baseUrlProblem,
  isInsecureHttpAllowed,
  isSameOrigin,
} from './baseUrl.js';

describe('baseUrlProblem', () => {
  it('accepts an https URL', () => {
    expect(baseUrlProblem('https://acme.atlassian.net')).toBeUndefined();
  });

  it('rejects plain http on a remote host', () => {
    expect(baseUrlProblem('http://acme.atlassian.net', { allowInsecureHttp: false })).toMatch(
      /must use https/
    );
  });

  it('accepts plain http when explicitly allowed', () => {
    expect(baseUrlProblem('http://jira.internal', { allowInsecureHttp: true })).toBeUndefined();
  });

  it.each(['http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080'])(
    'accepts loopback http %s',
    (url) => {
      expect(baseUrlProblem(url, { allowInsecureHttp: false })).toBeUndefined();
    }
  );

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'ftp://acme.example'])(
    'rejects scheme of %s',
    (url) => {
      expect(baseUrlProblem(url)).toBe('must use https://');
    }
  );

  it('rejects embedded credentials', () => {
    expect(baseUrlProblem('https://user:pw@acme.atlassian.net')).toMatch(/credentials/);
  });

  it.each(['https://acme.atlassian.net?x=1', 'https://acme.atlassian.net#frag'])(
    'rejects query or fragment in %s',
    (url) => {
      expect(baseUrlProblem(url)).toMatch(/query string or fragment/);
    }
  );

  it('rejects an unparseable value', () => {
    expect(baseUrlProblem('not a url')).toBe('is not a valid URL');
  });
});

describe('assertSecureBaseUrl', () => {
  it('throws with the offending URL in the message', () => {
    expect(() => assertSecureBaseUrl('http://acme.example', { allowInsecureHttp: false })).toThrow(
      /Invalid Jira base URL "http:\/\/acme\.example"/
    );
  });

  it('does not throw for https', () => {
    expect(() => assertSecureBaseUrl('https://acme.atlassian.net')).not.toThrow();
  });
});

describe('isInsecureHttpAllowed', () => {
  it('is true only for the exact opt-in value', () => {
    expect(isInsecureHttpAllowed({ JIRALLM_ALLOW_INSECURE_HTTP: '1' })).toBe(true);
    expect(isInsecureHttpAllowed({ JIRALLM_ALLOW_INSECURE_HTTP: 'true' })).toBe(false);
    expect(isInsecureHttpAllowed({})).toBe(false);
  });
});

describe('isSameOrigin', () => {
  it('matches scheme, host and port', () => {
    expect(isSameOrigin('https://acme.atlassian.net/rest/x', 'https://acme.atlassian.net')).toBe(
      true
    );
  });

  it.each([
    'http://acme.atlassian.net/rest/x',
    'https://evil.example/rest/x',
    'https://acme.atlassian.net:8443/rest/x',
    'not a url',
  ])('rejects %s', (url) => {
    expect(isSameOrigin(url, 'https://acme.atlassian.net')).toBe(false);
  });
});
