import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readConfigMock = vi.fn();
const removeOrgMock = vi.fn();
const removeProjectMock = vi.fn();
const listOrgsMock = vi.fn();
const findOrgsByProjectKeyMock = vi.fn();
vi.mock('../../lib/config.js', () => ({
  resolveConfigPath: () => '/tmp/config.toml',
  readConfig: (...a: unknown[]) => readConfigMock(...a),
  removeOrg: (...a: unknown[]) => removeOrgMock(...a),
  removeProject: (...a: unknown[]) => removeProjectMock(...a),
  listOrgs: (...a: unknown[]) => listOrgsMock(...a),
  findOrgsByProjectKey: (...a: unknown[]) => findOrgsByProjectKeyMock(...a),
}));

const hasStoredTokenMock = vi.fn();
const removeTokenMock = vi.fn();
vi.mock('../../lib/credentials.js', () => ({
  hasStoredToken: (...a: unknown[]) => hasStoredTokenMock(...a),
  removeToken: (...a: unknown[]) => removeTokenMock(...a),
}));

const confirmOrAbortMock = vi.fn();
const typedNameConfirmMock = vi.fn();
vi.mock('../confirm.js', () => ({
  confirmOrAbort: (...a: unknown[]) => confirmOrAbortMock(...a),
  typedNameConfirm: (...a: unknown[]) => typedNameConfirmMock(...a),
}));

import { runOrgsList, runOrgsRemove, runProjectRemove } from './orgs.js';

class ExitError extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => {
    logs.push(a.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...a) => {
    logs.push(a.map(String).join(' '));
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    writes.push(String(c));
    return true;
  });
  readConfigMock.mockReset();
  removeOrgMock.mockReset().mockReturnValue({ removed: true });
  removeProjectMock.mockReset().mockReturnValue({ removed: true });
  listOrgsMock.mockReset().mockReturnValue(['acme']);
  findOrgsByProjectKeyMock.mockReset().mockReturnValue([]);
  hasStoredTokenMock.mockReset().mockResolvedValue(true);
  removeTokenMock.mockReset().mockResolvedValue(undefined);
  confirmOrAbortMock.mockReset().mockResolvedValue(true);
  typedNameConfirmMock.mockReset().mockResolvedValue(true);
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runOrgsList --json', () => {
  it('emits structured JSON with token status and projects', async () => {
    readConfigMock.mockReturnValue({
      orgs: {
        acme: {
          base_url: 'https://acme.atlassian.net',
          projects: { PROJ: { output_dir: '/out/proj' }, DOCS: {} },
        },
      },
    });
    hasStoredTokenMock.mockResolvedValue(true);

    await runOrgsList({ json: true });

    const parsed = JSON.parse(writes.join(''));
    expect(parsed).toEqual({
      configPath: '/tmp/config.toml',
      orgs: [
        {
          name: 'acme',
          baseUrl: 'https://acme.atlassian.net',
          tokenStored: true,
          projects: [
            { key: 'PROJ', outputDir: '/out/proj' },
            { key: 'DOCS', outputDir: undefined },
          ],
        },
      ],
    });
    expect(logs).toEqual([]);
  });
});

describe('runOrgsList human-readable output', () => {
  it('prints each org with token status and its projects', async () => {
    readConfigMock.mockReturnValue({
      orgs: {
        acme: {
          base_url: 'https://acme.atlassian.net',
          projects: { PROJ: { output_dir: '/out/proj' } },
        },
        empty: { base_url: 'https://empty.atlassian.net', projects: {} },
      },
    });
    hasStoredTokenMock.mockImplementation(async (name: string) => name === 'acme');

    await runOrgsList({});

    expect(writes).toEqual([]);
    const out = logs.join('\n');
    expect(out).toContain('/tmp/config.toml');
    expect(out).toContain('acme');
    expect(out).toContain('token: stored');
    expect(out).toContain('PROJ');
    expect(out).toContain('→ /out/proj');
    expect(out).toContain('token: missing');
    expect(out).toContain('(no projects)');
  });

  it('prints a helpful message when no orgs are configured', async () => {
    readConfigMock.mockReturnValue({ orgs: {} });

    await runOrgsList({});

    const out = logs.join('\n');
    expect(out).toContain('No organizations configured.');
    expect(out).toContain('jirallm init');
  });
});

describe('ensureOrgExists guard', () => {
  it('errors and exits 1 when the org is unknown', async () => {
    listOrgsMock.mockReturnValue(['acme']);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new ExitError(code ?? 0);
    }) as never);

    await expect(runOrgsRemove('ghost', { dryRun: true })).rejects.toBeInstanceOf(ExitError);
    expect(logs.join('\n')).toContain('Organization "ghost" not found');
  });
});

describe('runOrgsRemove --dry-run', () => {
  it('prints what would be removed and mutates nothing', async () => {
    readConfigMock.mockReturnValue({
      orgs: { acme: { base_url: 'https://x', projects: { PROJ: {}, DOCS: {} } } },
    });

    await runOrgsRemove('acme', { dryRun: true });

    expect(removeOrgMock).not.toHaveBeenCalled();
    expect(removeTokenMock).not.toHaveBeenCalled();
    expect(confirmOrAbortMock).not.toHaveBeenCalled();
    expect(typedNameConfirmMock).not.toHaveBeenCalled();
    const out = logs.join('\n');
    expect(out).toContain('[dry-run] Would remove organization "acme".');
    expect(out).toContain('PROJ, DOCS');
  });
});

describe('runOrgsRemove typed-name confirm gate', () => {
  it('requires typing the org name when it still owns projects', async () => {
    readConfigMock.mockReturnValue({ orgs: { acme: { projects: { PROJ: {} } } } });
    typedNameConfirmMock.mockResolvedValue(true);

    await runOrgsRemove('acme', {});

    expect(typedNameConfirmMock).toHaveBeenCalledWith('acme', { yes: undefined });
    expect(confirmOrAbortMock).not.toHaveBeenCalled();
    expect(removeOrgMock).toHaveBeenCalledWith('acme');
  });

  it('aborts without mutation when the typed name does not match', async () => {
    readConfigMock.mockReturnValue({ orgs: { acme: { projects: { PROJ: {} } } } });
    typedNameConfirmMock.mockResolvedValue(false);

    await runOrgsRemove('acme', {});

    expect(removeOrgMock).not.toHaveBeenCalled();
    expect(removeTokenMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Cancelled.');
  });

  it('uses a plain confirm when the org has no projects', async () => {
    readConfigMock.mockReturnValue({ orgs: { acme: { projects: {} } } });

    await runOrgsRemove('acme', {});

    expect(confirmOrAbortMock).toHaveBeenCalledTimes(1);
    expect(typedNameConfirmMock).not.toHaveBeenCalled();
    expect(removeOrgMock).toHaveBeenCalledWith('acme');
    expect(removeTokenMock).toHaveBeenCalledWith('acme');
  });

  it('reports nothing-to-remove when removeOrg finds no org', async () => {
    readConfigMock.mockReturnValue({ orgs: { acme: { projects: {} } } });
    removeOrgMock.mockReturnValue({ removed: false });

    await runOrgsRemove('acme', {});

    expect(removeTokenMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('nothing to remove');
  });

  it('still succeeds when removeToken rejects (best-effort keychain)', async () => {
    readConfigMock.mockReturnValue({ orgs: { acme: { projects: {} } } });
    removeTokenMock.mockRejectedValue(new Error('keychain locked'));

    await runOrgsRemove('acme', {});

    expect(removeOrgMock).toHaveBeenCalledWith('acme');
    expect(logs.join('\n')).toContain('Removed organization "acme".');
  });
});

describe('runProjectRemove org inference', () => {
  it('infers the org from the project key when none is passed', async () => {
    findOrgsByProjectKeyMock.mockReturnValue(['acme']);
    listOrgsMock.mockReturnValue(['acme']);

    await runProjectRemove(undefined, 'PROJ', {});

    expect(findOrgsByProjectKeyMock).toHaveBeenCalledWith('PROJ');
    expect(removeProjectMock).toHaveBeenCalledWith('acme', 'PROJ');
    expect(logs.join('\n')).toContain('Removed project "PROJ" from "acme".');
  });

  it('honors an explicit org over inference', async () => {
    listOrgsMock.mockReturnValue(['beta']);

    await runProjectRemove('beta', 'PROJ', {});

    expect(findOrgsByProjectKeyMock).not.toHaveBeenCalled();
    expect(removeProjectMock).toHaveBeenCalledWith('beta', 'PROJ');
  });

  it('supports dry-run without mutating', async () => {
    findOrgsByProjectKeyMock.mockReturnValue(['acme']);

    await runProjectRemove(undefined, 'PROJ', { dryRun: true });

    expect(removeProjectMock).not.toHaveBeenCalled();
    expect(confirmOrAbortMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('[dry-run] Would remove project "PROJ" from org "acme".');
  });

  it('cancels without mutation when the confirm is declined', async () => {
    findOrgsByProjectKeyMock.mockReturnValue(['acme']);
    listOrgsMock.mockReturnValue(['acme']);
    confirmOrAbortMock.mockResolvedValue(false);

    await runProjectRemove(undefined, 'PROJ', {});

    expect(removeProjectMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Cancelled.');
  });

  it('reports nothing-to-remove when the project is absent', async () => {
    findOrgsByProjectKeyMock.mockReturnValue(['acme']);
    listOrgsMock.mockReturnValue(['acme']);
    removeProjectMock.mockReturnValue({ removed: false });

    await runProjectRemove(undefined, 'PROJ', {});

    expect(logs.join('\n')).toContain(
      'Project "PROJ" not found in org "acme" (nothing to remove).'
    );
  });
});
