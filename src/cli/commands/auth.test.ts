import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listOrgsMock = vi.fn();
const readConfigMock = vi.fn();
vi.mock('../../lib/config.js', () => ({
  listOrgs: (...a: unknown[]) => listOrgsMock(...a),
  readConfig: (...a: unknown[]) => readConfigMock(...a),
}));

const setTokenMock = vi.fn();
const removeTokenMock = vi.fn();
const hasStoredTokenMock = vi.fn();
const getTokenSourceMock = vi.fn();
vi.mock('../../lib/credentials.js', () => ({
  setToken: (...a: unknown[]) => setTokenMock(...a),
  removeToken: (...a: unknown[]) => removeTokenMock(...a),
  hasStoredToken: (...a: unknown[]) => hasStoredTokenMock(...a),
  getTokenSource: (...a: unknown[]) => getTokenSourceMock(...a),
}));

const introMock = vi.fn();
const outroMock = vi.fn();
const passwordMock = vi.fn();
const confirmMock = vi.fn();
const isCancelMock = vi.fn();
const cancelMock = vi.fn();
vi.mock('@clack/prompts', () => ({
  intro: (...a: unknown[]) => introMock(...a),
  outro: (...a: unknown[]) => outroMock(...a),
  password: (...a: unknown[]) => passwordMock(...a),
  confirm: (...a: unknown[]) => confirmMock(...a),
  isCancel: (...a: unknown[]) => isCancelMock(...a),
  cancel: (...a: unknown[]) => cancelMock(...a),
}));

import { runAuthSet, runAuthRm, runAuthList, runAuthStatus } from './auth.js';

let logs: string[];
let errors: string[];

beforeEach(() => {
  logs = [];
  errors = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => {
    logs.push(a.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...a) => {
    errors.push(a.map(String).join(' '));
  });
  listOrgsMock.mockReset().mockReturnValue(['acme']);
  readConfigMock.mockReset();
  setTokenMock.mockReset().mockResolvedValue(undefined);
  removeTokenMock.mockReset().mockResolvedValue(true);
  hasStoredTokenMock.mockReset().mockResolvedValue(true);
  getTokenSourceMock.mockReset();
  introMock.mockReset();
  outroMock.mockReset();
  passwordMock.mockReset().mockResolvedValue('secret-token');
  confirmMock.mockReset().mockResolvedValue(true);
  isCancelMock.mockReset().mockReturnValue(false);
  cancelMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ensureOrg guard', () => {
  it('errors and exits when the org is unknown', async () => {
    listOrgsMock.mockReturnValue(['other']);
    const exitError = new Error('exit');
    const exitMock = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw exitError;
    });

    await expect(runAuthSet('acme')).rejects.toBe(exitError);

    expect(exitMock).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain('Organization "acme" not found. Existing orgs: other');
    expect(setTokenMock).not.toHaveBeenCalled();
  });

  it('lists (none) when no orgs exist', async () => {
    listOrgsMock.mockReturnValue([]);
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });

    await expect(runAuthStatus('acme')).rejects.toThrow('exit');

    expect(errors.join('\n')).toContain('Existing orgs: (none)');
  });
});

describe('runAuthSet', () => {
  it('prompts for a token and stores it in the keychain', async () => {
    await runAuthSet('acme');

    expect(introMock).toHaveBeenCalledWith('jirallm auth set --org acme');
    expect(setTokenMock).toHaveBeenCalledWith('acme', 'secret-token');
    expect(outroMock).toHaveBeenCalledWith('Token stored in OS keychain.');
    expect(cancelMock).not.toHaveBeenCalled();
  });

  it('cancels without storing when the prompt is aborted', async () => {
    isCancelMock.mockReturnValue(true);
    const exitError = new Error('exit');
    const exitMock = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw exitError;
    });

    await expect(runAuthSet('acme')).rejects.toBe(exitError);

    expect(exitMock).toHaveBeenCalledWith(0);
    expect(cancelMock).toHaveBeenCalledWith('Cancelled.');
    expect(setTokenMock).not.toHaveBeenCalled();
  });
});

describe('runAuthRm', () => {
  it('is a no-op when there is no stored token', async () => {
    hasStoredTokenMock.mockResolvedValue(false);

    await runAuthRm('acme');

    expect(logs.join('\n')).toContain('No stored token for "acme" (nothing to remove).');
    expect(confirmMock).not.toHaveBeenCalled();
    expect(removeTokenMock).not.toHaveBeenCalled();
  });

  it('bypasses confirmation with --yes and removes the token', async () => {
    await runAuthRm('acme', { yes: true });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(removeTokenMock).toHaveBeenCalledWith('acme');
    expect(logs.join('\n')).toContain('Removed token for "acme".');
  });

  it('prompts for confirmation and removes on yes', async () => {
    confirmMock.mockResolvedValue(true);

    await runAuthRm('acme', { yes: false });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(removeTokenMock).toHaveBeenCalledWith('acme');
    expect(logs.join('\n')).toContain('Removed token for "acme".');
  });

  it('aborts without removal when confirmation is declined', async () => {
    confirmMock.mockResolvedValue(false);

    await runAuthRm('acme');

    expect(removeTokenMock).not.toHaveBeenCalled();
    expect(cancelMock).toHaveBeenCalledWith('Cancelled.');
  });

  it('aborts without removal when confirmation is cancelled', async () => {
    isCancelMock.mockReturnValue(true);

    await runAuthRm('acme');

    expect(removeTokenMock).not.toHaveBeenCalled();
    expect(cancelMock).toHaveBeenCalledWith('Cancelled.');
  });

  it('reports nothing-to-remove when removeToken returns false', async () => {
    removeTokenMock.mockResolvedValue(false);

    await runAuthRm('acme', { yes: true });

    expect(logs.join('\n')).toContain('No stored token for "acme" (nothing to remove).');
  });
});

describe('runAuthList', () => {
  it('tells the user to init when no orgs are configured', async () => {
    readConfigMock.mockReturnValue({ orgs: {} });

    await runAuthList();

    expect(logs.join('\n')).toBe('No organizations configured. Run `jirallm init`.');
  });

  it('lists each org with its base url and token state', async () => {
    readConfigMock.mockReturnValue({
      orgs: {
        acme: { base_url: 'https://acme.atlassian.net' },
        beta: { base_url: 'https://beta.atlassian.net' },
      },
    });
    hasStoredTokenMock.mockImplementation(async (name: string) => name === 'acme');

    await runAuthList();

    const out = logs.join('\n');
    expect(out).toContain('acme  https://acme.atlassian.net  token: stored');
    expect(out).toContain('beta  https://beta.atlassian.net  token: missing');
  });

  it('handles a missing orgs map and empty base url', async () => {
    readConfigMock.mockReturnValue({ orgs: { acme: {} } });
    hasStoredTokenMock.mockResolvedValue(false);

    await runAuthList();

    expect(logs.join('\n')).toContain('acme    token: missing');
  });
});

describe('runAuthStatus', () => {
  it('reports the OS keychain when the token comes from the keyring', async () => {
    getTokenSourceMock.mockResolvedValue('keychain');

    await runAuthStatus('acme');

    expect(logs.join('\n')).toBe('acme: token stored in OS keychain.');
    expect(errors).toEqual([]);
  });

  it('reports the environment variable when the token comes from env', async () => {
    getTokenSourceMock.mockResolvedValue('env');

    await runAuthStatus('acme');

    expect(logs.join('\n')).toBe('acme: token resolved from environment variable.');
    expect(errors).toEqual([]);
  });

  it('errors and exits when no token source resolves', async () => {
    getTokenSourceMock.mockResolvedValue(null);
    const exitError = new Error('exit');
    const exitMock = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw exitError;
    });

    await expect(runAuthStatus('acme')).rejects.toBe(exitError);

    expect(exitMock).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain('No token stored for "acme".');
    expect(logs).toEqual([]);
  });
});
