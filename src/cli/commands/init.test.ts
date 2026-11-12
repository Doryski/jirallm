import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getCurrentUserMock, listProjectsMock, readFileSyncMock, constructed } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  listProjectsMock: vi.fn(),
  readFileSyncMock: vi.fn(),
  constructed: [] as Array<{ config: unknown; token: unknown }>,
}));

const { introMock, outroMock, textMock, passwordMock, confirmMock, selectMock, multiselectMock, cancelMock, noteMock } =
  vi.hoisted(() => ({
    introMock: vi.fn(),
    outroMock: vi.fn(),
    textMock: vi.fn(),
    passwordMock: vi.fn(),
    confirmMock: vi.fn(),
    selectMock: vi.fn(),
    multiselectMock: vi.fn(),
    cancelMock: vi.fn(),
    noteMock: vi.fn(),
  }));

vi.mock('@clack/prompts', () => ({
  intro: introMock,
  outro: outroMock,
  text: textMock,
  password: passwordMock,
  confirm: confirmMock,
  select: selectMock,
  multiselect: multiselectMock,
  cancel: cancelMock,
  note: noteMock,
  isCancel: (v: unknown) => typeof v === 'symbol',
}));

vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    getCurrentUser = getCurrentUserMock;
    listProjects = listProjectsMock;
    constructor(config: unknown, token: unknown) {
      constructed.push({ config, token });
    }
  },
}));

vi.mock('../../lib/config.js', () => ({
  resolveConfigPath: vi.fn(() => '/tmp/config.toml'),
  readConfig: vi.fn(() => ({ orgs: {} })),
  upsertOrg: vi.fn(),
  upsertProject: vi.fn(),
}));

vi.mock('../../lib/credentials.js', () => ({
  setToken: vi.fn(async () => undefined),
}));

vi.mock('framewise', () => ({ checkFfmpeg: vi.fn(async () => true) }));
vi.mock('../../lib/platform.js', () => ({
  detectOS: vi.fn(() => 'macos'),
  hasHomebrew: vi.fn(async () => true),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, readFileSync: (...args: unknown[]) => readFileSyncMock(...args) };
});

import { upsertOrg, upsertProject } from '../../lib/config.js';
import { setToken } from '../../lib/credentials.js';
import { runInit } from './init.js';

const upsertOrgMock = vi.mocked(upsertOrg);
const upsertProjectMock = vi.mocked(upsertProject);
const setTokenMock = vi.mocked(setToken);

const cancelled = () => Symbol('cancel');

const originalStdinIsTTY = process.stdin.isTTY;

function setStdinTTY(value: boolean | undefined) {
  Object.defineProperty(process.stdin, 'isTTY', { value, configurable: true });
}

beforeEach(() => {
  setStdinTTY(false);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  }) as never);
  constructed.length = 0;
  getCurrentUserMock.mockReset().mockResolvedValue({ accountId: 'a1', displayName: 'Me' });
  listProjectsMock.mockReset();
  readFileSyncMock.mockReset();
  upsertOrgMock.mockReset();
  upsertProjectMock.mockReset();
  setTokenMock.mockReset().mockResolvedValue(undefined);
  introMock.mockReset();
  outroMock.mockReset();
  textMock.mockReset();
  passwordMock.mockReset();
  confirmMock.mockReset();
  selectMock.mockReset();
  multiselectMock.mockReset();
  cancelMock.mockReset();
  noteMock.mockReset();
  process.env.JIRALLM_API_TOKEN = 'env-token';
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.JIRALLM_API_TOKEN;
  setStdinTTY(originalStdinIsTTY);
});

describe('runInit (non-interactive)', () => {
  it('creates org + project from explicit flags', async () => {
    await runInit({
      org: 'acme',
      baseUrl: 'https://acme.atlassian.net',
      email: 'me@acme.com',
      project: 'proj',
    });

    expect(getCurrentUserMock).toHaveBeenCalledTimes(1);
    expect(upsertOrgMock).toHaveBeenCalledWith({
      name: 'acme',
      baseUrl: 'https://acme.atlassian.net',
      userEmail: 'me@acme.com',
      projects: {},
    });
    expect(setTokenMock).toHaveBeenCalledWith('acme', 'env-token');
    expect(upsertProjectMock).toHaveBeenCalledWith('acme', { key: 'PROJ' });
  });

  it('prefills org name and base URL from the email domain', async () => {
    await runInit({ email: 'me@acme.com' });

    expect(constructed[0].config).toEqual({
      baseUrl: 'https://acme.atlassian.net',
      userEmail: 'me@acme.com',
    });
    expect(upsertOrgMock).toHaveBeenCalledWith({
      name: 'acme',
      baseUrl: 'https://acme.atlassian.net',
      userEmail: 'me@acme.com',
      projects: {},
    });
    expect(upsertProjectMock).not.toHaveBeenCalled();
  });

  it('persists the token before the org (setToken precedes upsertOrg)', async () => {
    await runInit({ email: 'me@acme.com' });

    expect(setTokenMock).toHaveBeenCalledTimes(1);
    expect(upsertOrgMock).toHaveBeenCalledTimes(1);
    expect(setTokenMock.mock.invocationCallOrder[0]).toBeLessThan(
      upsertOrgMock.mock.invocationCallOrder[0]
    );
  });

  it('validates credentials before writing; a getCurrentUser failure persists nothing', async () => {
    getCurrentUserMock.mockRejectedValue(new Error('401 Unauthorized'));

    await expect(
      runInit({ org: 'acme', baseUrl: 'https://acme.atlassian.net', email: 'me@acme.com', project: 'PROJ' })
    ).rejects.toThrow('401');

    expect(getCurrentUserMock).toHaveBeenCalledTimes(1);
    expect(upsertOrgMock).not.toHaveBeenCalled();
    expect(setTokenMock).not.toHaveBeenCalled();
    expect(upsertProjectMock).not.toHaveBeenCalled();
  });

  it('does not persist the org when the token write fails', async () => {
    setTokenMock.mockRejectedValueOnce(new Error('keychain unavailable'));

    await expect(
      runInit({ org: 'acme', baseUrl: 'https://acme.atlassian.net', email: 'me@acme.com', project: 'PROJ' })
    ).rejects.toThrow('keychain unavailable');

    expect(getCurrentUserMock).toHaveBeenCalledTimes(1);
    expect(setTokenMock).toHaveBeenCalledTimes(1);
    expect(upsertOrgMock).not.toHaveBeenCalled();
    expect(upsertProjectMock).not.toHaveBeenCalled();
  });

  it('reads the token from stdin with --token-stdin', async () => {
    delete process.env.JIRALLM_API_TOKEN;
    readFileSyncMock.mockReturnValue('stdin-token\n');

    await runInit({ email: 'me@acme.com', tokenStdin: true });

    expect(readFileSyncMock).toHaveBeenCalledWith(0, 'utf-8');
    expect(constructed[0].token).toBe('stdin-token');
    expect(setTokenMock).toHaveBeenCalledWith('acme', 'stdin-token');
  });

  it('throws when --token-stdin is set but stdin is empty', async () => {
    delete process.env.JIRALLM_API_TOKEN;
    readFileSyncMock.mockReturnValue('   \n');

    await expect(runInit({ email: 'me@acme.com', tokenStdin: true })).rejects.toThrow(/stdin/i);

    expect(getCurrentUserMock).not.toHaveBeenCalled();
    expect(upsertOrgMock).not.toHaveBeenCalled();
  });

  it('throws when no token source is available and writes nothing', async () => {
    delete process.env.JIRALLM_API_TOKEN;

    await expect(runInit({ email: 'me@acme.com' })).rejects.toThrow(/token/i);

    expect(getCurrentUserMock).not.toHaveBeenCalled();
    expect(upsertOrgMock).not.toHaveBeenCalled();
  });

  it('requires a valid --email in non-interactive mode', async () => {
    await expect(runInit({ org: 'acme' })).rejects.toThrow(/email/i);
    expect(upsertOrgMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid --base-url before any write', async () => {
    await expect(
      runInit({ email: 'me@acme.com', baseUrl: 'ftp://acme.example' })
    ).rejects.toThrow(/base-url/i);
    expect(getCurrentUserMock).not.toHaveBeenCalled();
    expect(upsertOrgMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid project key before any write', async () => {
    await expect(runInit({ email: 'me@acme.com', project: '1bad' })).rejects.toThrow(/project key/i);
    expect(getCurrentUserMock).not.toHaveBeenCalled();
    expect(upsertOrgMock).not.toHaveBeenCalled();
  });

  it.each([
    ['plain http', 'http://acme.atlassian.net', 'must use https://'],
    ['embedded credentials', 'https://me:pw@acme.atlassian.net', 'must not contain credentials'],
    ['a query string', 'https://acme.atlassian.net/?x=1', 'must not contain a query string'],
    ['a javascript: URL', 'javascript:alert(1)', 'must use https://'],
  ])('rejects a --base-url with %s, naming the reason, before any token read or write', async (_label, baseUrl, reason) => {
    await expect(runInit({ email: 'me@acme.com', baseUrl, tokenStdin: true })).rejects.toThrow(
      `Invalid --base-url "${baseUrl}": ${reason}`
    );
    expect(readFileSyncMock).not.toHaveBeenCalled();
    expect(constructed).toEqual([]);
    expect(setTokenMock).not.toHaveBeenCalled();
    expect(upsertOrgMock).not.toHaveBeenCalled();
  });

  it('accepts plain http for a loopback host', async () => {
    await runInit({ org: 'local', email: 'me@acme.com', baseUrl: 'http://localhost:8080' });
    expect(upsertOrgMock).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: 'http://localhost:8080' })
    );
  });

  it.each([['me@acme'], ['me@@acme.com'], ['me@acme.com/x'], ['@acme.com'], ['me@acme_corp.com'], ['me@evil.com?x=.atlassian.net']])(
    'rejects a malformed --email %j before deriving anything from it',
    async (email) => {
      await expect(runInit({ email })).rejects.toThrow('Non-interactive init requires a valid --email.');
      expect(constructed).toEqual([]);
      expect(upsertOrgMock).not.toHaveBeenCalled();
    }
  );

  it('derives the default base URL only from the first domain label', async () => {
    await runInit({ email: 'me@Acme-Corp.example.com' });
    expect(upsertOrgMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Acme-Corp', baseUrl: 'https://Acme-Corp.atlassian.net' })
    );
  });
});

describe('runInit (interactive validators)', () => {
  type Validator = (value: string | undefined) => string | undefined;

  const validatorFor = (fragment: string): Validator => {
    const call = textMock.mock.calls.find(([opts]) => String(opts.message).includes(fragment));
    if (!call) throw new Error(`No text prompt containing "${fragment}"`);
    return call[0].validate;
  };

  const runWizardUntilToken = async () => {
    selectMock.mockResolvedValue('__new__');
    textMock
      .mockResolvedValueOnce('acme')
      .mockResolvedValueOnce('https://acme.atlassian.net')
      .mockResolvedValueOnce('me@acme.com')
      .mockResolvedValueOnce('5')
      .mockResolvedValueOnce('10');
    confirmMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    passwordMock.mockResolvedValueOnce(cancelled());
    await expect(runInit()).rejects.toThrow('exit:0');
  };

  it('rejects http, credentials and non-URLs in the base URL prompt', async () => {
    await runWizardUntilToken();
    const validate = validatorFor('Jira base URL');
    expect(validate('https://acme.atlassian.net')).toBeUndefined();
    expect(validate('')).toBe('Required');
    expect(validate('http://acme.atlassian.net')).toMatch(/^Base URL must use https:\/\//);
    expect(validate('https://me:pw@acme.atlassian.net')).toBe('Base URL must not contain credentials');
    expect(validate('acme.atlassian.net')).toBe('Base URL is not a valid URL');
  });

  it('rejects a malformed email in the email prompt', async () => {
    await runWizardUntilToken();
    const validate = validatorFor('Jira account email');
    expect(validate('me@acme.com')).toBeUndefined();
    expect(validate('me@acme')).toBe('Looks invalid');
  });

  it('bounds the FPS and max-frames prompts, allowing an empty answer for the default', async () => {
    await runWizardUntilToken();
    const fps = validatorFor('Frame extraction FPS');
    const maxFrames = validatorFor('Max frames kept per video');
    expect(fps('')).toBeUndefined();
    expect(fps('30')).toBeUndefined();
    expect(fps('31')).toBe('"31" is not a whole number from 1 to 30');
    expect(fps('0')).toBeDefined();
    expect(maxFrames('200')).toBeUndefined();
    expect(maxFrames('201')).toBe('"201" is not a whole number from 1 to 200');
  });
});

describe('runInit (flags in a terminal) — issue #28', () => {
  const fullFlags = {
    org: 'acme',
    baseUrl: 'https://acme.atlassian.net',
    email: 'me@example.com',
    project: 'PROJ',
  };

  beforeEach(() => {
    setStdinTTY(true);
    delete process.env.JIRALLM_API_TOKEN;
  });

  it('prompts for the token (masked) and completes when flags are given without a token source', async () => {
    passwordMock.mockResolvedValueOnce('typed-token');

    await runInit(fullFlags);

    expect(passwordMock).toHaveBeenCalledTimes(1);
    expect(readFileSyncMock).not.toHaveBeenCalled();
    expect(constructed[0].token).toBe('typed-token');
    expect(setTokenMock).toHaveBeenCalledWith('acme', 'typed-token');
    expect(upsertOrgMock).toHaveBeenCalledWith(expect.objectContaining({ name: 'acme', userEmail: 'me@example.com' }));
    expect(upsertProjectMock).toHaveBeenCalledWith('acme', { key: 'PROJ' });
  });

  it.each([
    ['full flags', fullFlags],
    ['--yes', { ...fullFlags, yes: true }],
    ['only --email', { email: 'me@acme.com' }],
  ])('rejects --token-stdin on a terminal with a one-line hint and never reads fd 0 (%s)', async (_label, flags) => {
    await expect(runInit({ ...flags, tokenStdin: true })).rejects.toThrow(
      /^stdin is a terminal — pipe the token, e\.g\. `pbpaste \| jirallm init … --token-stdin`/
    );

    expect(readFileSyncMock).not.toHaveBeenCalled();
    expect(passwordMock).not.toHaveBeenCalled();
    expect(getCurrentUserMock).not.toHaveBeenCalled();
    expect(setTokenMock).not.toHaveBeenCalled();
    expect(upsertOrgMock).not.toHaveBeenCalled();
  });

  it('prefers JIRALLM_API_TOKEN over the prompt', async () => {
    process.env.JIRALLM_API_TOKEN = 'env-token';

    await runInit(fullFlags);

    expect(passwordMock).not.toHaveBeenCalled();
    expect(constructed[0].token).toBe('env-token');
  });

  it('prompts for a missing --email, then derives org and base URL from it', async () => {
    textMock.mockResolvedValueOnce('me@acme.com');
    passwordMock.mockResolvedValueOnce('typed-token');

    await runInit({ project: 'PROJ' });

    expect(textMock).toHaveBeenCalledTimes(1);
    expect(constructed[0].config).toEqual({ baseUrl: 'https://acme.atlassian.net', userEmail: 'me@acme.com' });
    expect(setTokenMock).toHaveBeenCalledWith('acme', 'typed-token');
  });

  it('still rejects an invalid --email instead of prompting', async () => {
    await expect(runInit({ email: 'nope' })).rejects.toThrow(/email/i);

    expect(textMock).not.toHaveBeenCalled();
    expect(passwordMock).not.toHaveBeenCalled();
  });

  it('exits without saving when the token prompt is cancelled', async () => {
    passwordMock.mockResolvedValueOnce(cancelled());

    await expect(runInit(fullFlags)).rejects.toThrow('exit:0');

    expect(getCurrentUserMock).not.toHaveBeenCalled();
    expect(setTokenMock).not.toHaveBeenCalled();
    expect(upsertOrgMock).not.toHaveBeenCalled();
  });

  it('validates flags before prompting, so a bad --base-url never asks for a token', async () => {
    await expect(runInit({ ...fullFlags, baseUrl: 'ftp://acme.example' })).rejects.toThrow(/base-url/i);

    expect(passwordMock).not.toHaveBeenCalled();
  });
});

describe('runInit (flags without a terminal: CI / scripts)', () => {
  it.each([
    ['a pipe', false],
    ['a redirected file', undefined],
  ])('reads a piped --token-stdin token when stdin is %s', async (_label, isTTY) => {
    setStdinTTY(isTTY);
    delete process.env.JIRALLM_API_TOKEN;
    readFileSyncMock.mockReturnValue('piped-token\n');

    await runInit({ email: 'me@acme.com', tokenStdin: true, yes: true });

    expect(constructed[0].token).toBe('piped-token');
    expect(passwordMock).not.toHaveBeenCalled();
  });

  it('uses JIRALLM_API_TOKEN without prompting', async () => {
    process.env.JIRALLM_API_TOKEN = 'env-token';

    await runInit({ email: 'me@acme.com', yes: true });

    expect(constructed[0].token).toBe('env-token');
    expect(passwordMock).not.toHaveBeenCalled();
  });

  it('fails with an actionable message (never prompts) when no token source exists', async () => {
    delete process.env.JIRALLM_API_TOKEN;

    await expect(runInit({ email: 'me@acme.com', yes: true })).rejects.toThrow(
      'No API token provided. Pipe it with --token-stdin (e.g. `pbpaste | jirallm init … --token-stdin`) or set JIRALLM_API_TOKEN.'
    );
    expect(passwordMock).not.toHaveBeenCalled();
  });

  it('requires --email (never prompts) when it is missing', async () => {
    await expect(runInit({ org: 'acme', yes: true })).rejects.toThrow(/email/i);
    expect(textMock).not.toHaveBeenCalled();
  });
});

describe('runInit (interactive wizard)', () => {
  it('sets up a new org, validates, and picks projects from the Jira project list', async () => {
    textMock
      .mockResolvedValueOnce('acme')
      .mockResolvedValueOnce('https://acme.atlassian.net')
      .mockResolvedValueOnce('me@acme.com')
      .mockResolvedValueOnce('./jira-export');
    confirmMock.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    passwordMock.mockResolvedValueOnce('secret-token');
    listProjectsMock.mockResolvedValue({
      values: [
        { key: 'PROJ', name: 'Project X' },
        { key: 'DOCS', name: 'Docs' },
      ],
    });
    multiselectMock.mockResolvedValueOnce(['PROJ']);

    await runInit();

    expect(introMock).toHaveBeenCalledWith('jirallm init');
    expect(getCurrentUserMock).toHaveBeenCalledTimes(1);
    expect(constructed[0]).toEqual({
      config: { baseUrl: 'https://acme.atlassian.net', userEmail: 'me@acme.com' },
      token: 'secret-token',
    });
    expect(setTokenMock).toHaveBeenCalledWith('acme', 'secret-token');
    expect(upsertOrgMock).toHaveBeenCalledWith({
      name: 'acme',
      baseUrl: 'https://acme.atlassian.net',
      userEmail: 'me@acme.com',
      includeSubtasks: undefined,
      videoFrames: { enabled: false },
      projects: {},
    });

    const multiselectOptions = multiselectMock.mock.calls[0][0].options;
    expect(multiselectOptions).toEqual([
      { value: 'PROJ', label: 'PROJ — Project X' },
      { value: 'DOCS', label: 'DOCS — Docs' },
    ]);
    expect(upsertProjectMock).toHaveBeenCalledWith('acme', { key: 'PROJ', outputDir: './jira-export' });
    expect(outroMock).toHaveBeenCalledTimes(1);
  });

  it('persists the token before the org during the wizard', async () => {
    textMock
      .mockResolvedValueOnce('acme')
      .mockResolvedValueOnce('https://acme.atlassian.net')
      .mockResolvedValueOnce('me@acme.com')
      .mockResolvedValueOnce('');
    confirmMock.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    passwordMock.mockResolvedValueOnce('secret-token');
    listProjectsMock.mockResolvedValue({ values: [{ key: 'PROJ', name: 'Project X' }] });
    multiselectMock.mockResolvedValueOnce(['PROJ']);

    await runInit();

    expect(setTokenMock.mock.invocationCallOrder[0]).toBeLessThan(
      upsertOrgMock.mock.invocationCallOrder[0]
    );
  });

  it('falls back to manual project-key entry when the Jira project list is empty', async () => {
    textMock
      .mockResolvedValueOnce('acme')
      .mockResolvedValueOnce('https://acme.atlassian.net')
      .mockResolvedValueOnce('me@acme.com')
      .mockResolvedValueOnce('PROJ,DOCS')
      .mockResolvedValueOnce('');
    confirmMock.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    passwordMock.mockResolvedValueOnce('secret-token');
    listProjectsMock.mockRejectedValue(new Error('403 Forbidden'));

    await runInit();

    expect(multiselectMock).not.toHaveBeenCalled();
    expect(upsertProjectMock).toHaveBeenCalledWith('acme', { key: 'PROJ', outputDir: undefined });
    expect(upsertProjectMock).toHaveBeenCalledWith('acme', { key: 'DOCS', outputDir: undefined });
  });

  it('cancels and saves nothing when the org-name prompt is cancelled', async () => {
    textMock.mockResolvedValueOnce(cancelled());

    await expect(runInit()).rejects.toThrow('exit:0');

    expect(cancelMock).toHaveBeenCalled();
    expect(setTokenMock).not.toHaveBeenCalled();
    expect(upsertOrgMock).not.toHaveBeenCalled();
    expect(upsertProjectMock).not.toHaveBeenCalled();
  });

  it('aborts without saving when Jira authentication fails in the wizard', async () => {
    textMock
      .mockResolvedValueOnce('acme')
      .mockResolvedValueOnce('https://acme.atlassian.net')
      .mockResolvedValueOnce('me@acme.com');
    confirmMock.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    passwordMock.mockResolvedValueOnce('bad-token');
    getCurrentUserMock.mockRejectedValue(new Error('401 Unauthorized'));

    await expect(runInit()).rejects.toThrow('exit:1');

    expect(cancelMock).toHaveBeenCalledWith(expect.stringContaining('401 Unauthorized'));
    expect(setTokenMock).not.toHaveBeenCalled();
    expect(upsertOrgMock).not.toHaveBeenCalled();
  });
});
