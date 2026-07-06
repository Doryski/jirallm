import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  readConfigMock,
  resolveConfigPathMock,
  loadProfileMock,
  findOrgsByProjectKeyMock,
  getCurrentUserMock,
  getTokenMock,
  checkFfmpegMock,
  resolveFfmpegBinaryMock,
} = vi.hoisted(() => ({
  readConfigMock: vi.fn(),
  resolveConfigPathMock: vi.fn(() => '/cfg/config.toml'),
  loadProfileMock: vi.fn(),
  findOrgsByProjectKeyMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  getTokenMock: vi.fn(),
  checkFfmpegMock: vi.fn(),
  resolveFfmpegBinaryMock: vi.fn(),
}));

vi.mock('../../lib/config.js', () => ({
  readConfig: readConfigMock,
  resolveConfigPath: resolveConfigPathMock,
  loadProfile: loadProfileMock,
  findOrgsByProjectKey: findOrgsByProjectKeyMock,
}));

vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    getCurrentUser = getCurrentUserMock;
  },
}));

vi.mock('../../lib/credentials.js', () => ({
  getToken: getTokenMock,
}));

vi.mock('framewise', () => ({
  checkFfmpeg: checkFfmpegMock,
  resolveFfmpegBinary: resolveFfmpegBinaryMock,
}));

vi.mock('../../lib/platform.js', () => ({
  detectOS: () => 'macos',
  getFfmpegInstallHint: async () => 'brew install ffmpeg',
}));

vi.mock('@napi-rs/keyring', () => ({ Entry: class {} }));

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
}));

import { intro, outro, note } from '@clack/prompts';
import { runDoctor } from './doctor.js';

const CONFIG = {
  orgs: {
    acme: {
      base_url: 'https://acme.atlassian.net',
      user_email: 'u@acme',
      projects: { PROJ: { key: 'PROJ' } },
    },
    globex: {
      base_url: 'https://globex.atlassian.net',
      user_email: 'u@globex',
      projects: { OTHER: { key: 'OTHER' } },
    },
  },
};

const FAKE_USER = { accountId: 'acc-1', displayName: 'Jane', emailAddress: 'jane@x' };

class ExitError extends Error {
  constructor(public code: number) {
    super(`exit ${code}`);
  }
}

let logs: string[];
let writes: string[];

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => {
    logs.push(a.map(String).join(' '));
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => {
    writes.push(String(c));
    return true;
  });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ExitError(code ?? 0);
  }) as never);

  readConfigMock.mockReset().mockReturnValue(CONFIG);
  resolveConfigPathMock.mockReturnValue('/cfg/config.toml');
  loadProfileMock.mockReset().mockResolvedValue({
    org: { baseUrl: 'https://acme.atlassian.net' },
    apiToken: 'tok',
    config: { baseUrl: 'https://acme.atlassian.net', userEmail: 'u@acme', projectKey: 'PROJ' },
  });
  findOrgsByProjectKeyMock.mockReset().mockReturnValue([]);
  getCurrentUserMock.mockReset().mockResolvedValue(FAKE_USER);
  getTokenMock.mockReset().mockResolvedValue('tok');
  checkFfmpegMock.mockReset().mockResolvedValue(true);
  resolveFfmpegBinaryMock.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runDoctor -P org inference', () => {
  it('infers the org from -P via findOrgsByProjectKey and checks only that org', async () => {
    findOrgsByProjectKeyMock.mockReturnValue(['acme']);

    await runDoctor({ project: 'PROJ', json: true });

    expect(findOrgsByProjectKeyMock).toHaveBeenCalledWith('PROJ', CONFIG);
    expect(loadProfileMock).toHaveBeenCalledWith({ org: 'acme', project: 'PROJ' });
    expect(loadProfileMock).toHaveBeenCalledTimes(1);

    const results = JSON.parse(writes.join('')) as { name: string; severity: string }[];
    const jira = results.filter((r) => r.name.startsWith('Jira reachable'));
    expect(jira).toHaveLength(1);
    expect(jira[0].name).toBe('Jira reachable [acme]');
    expect(jira[0].severity).toBe('pass');
  });

  it('fails and lists available orgs when -P matches no org', async () => {
    findOrgsByProjectKeyMock.mockReturnValue([]);

    await expect(runDoctor({ project: 'NOPE', json: true })).rejects.toBeInstanceOf(ExitError);

    const results = JSON.parse(writes.join('')) as {
      name: string;
      severity: string;
      hint?: string;
    }[];
    const jira = results.find((r) => r.name === 'Jira reachable [NOPE]');
    expect(jira?.severity).toBe('fail');
    expect(jira?.hint).toContain('acme');
    expect(jira?.hint).toContain('globex');
  });

  it('lists available orgs when an unknown --org is passed', async () => {
    await expect(runDoctor({ org: 'unknown', json: true })).rejects.toBeInstanceOf(ExitError);

    const results = JSON.parse(writes.join('')) as {
      name: string;
      severity: string;
      hint?: string;
    }[];
    const jira = results.find((r) => r.name === 'Jira reachable [unknown]');
    expect(jira?.severity).toBe('fail');
    expect(jira?.hint).toContain('acme');
    expect(jira?.hint).toContain('globex');
  });
});

describe('runDoctor --strict', () => {
  it('exits 0 on a warning without --strict', async () => {
    checkFfmpegMock.mockResolvedValue(false);
    resolveFfmpegBinaryMock.mockResolvedValue(null);
    getTokenMock.mockResolvedValue('tok');

    await expect(runDoctor({ org: 'acme', json: true })).resolves.toBeUndefined();
  });

  it('exits 1 on a warning when --strict is set', async () => {
    checkFfmpegMock.mockResolvedValue(false);
    resolveFfmpegBinaryMock.mockResolvedValue(null);

    let caught: unknown;
    await runDoctor({ org: 'acme', strict: true, json: true }).catch((e) => {
      caught = e;
    });
    expect(caught).toBeInstanceOf(ExitError);
    expect((caught as ExitError).code).toBe(1);

    const results = JSON.parse(writes.join('')) as { name: string; severity: string }[];
    expect(results.some((r) => r.severity === 'warn')).toBe(true);
  });
});

describe('runDoctor --json', () => {
  it('emits a CheckResult[] as JSON and prints no human-readable lines', async () => {
    findOrgsByProjectKeyMock.mockReturnValue(['acme']);

    await runDoctor({ project: 'PROJ', json: true });

    expect(logs).toEqual([]);
    const results = JSON.parse(writes.join(''));
    expect(Array.isArray(results)).toBe(true);
    for (const r of results) {
      expect(typeof r.name).toBe('string');
      expect(['pass', 'fail', 'warn']).toContain(r.severity);
      expect(typeof r.detail).toBe('string');
    }
    expect(results.map((r: { name: string }) => r.name)).toEqual(
      expect.arrayContaining(['Node.js', 'ffmpeg', 'OS keychain', 'Config'])
    );
  });
});

describe('runDoctor human-readable output', () => {
  it('prints intro, environment note and per-check lines, then a success outro', async () => {
    await expect(runDoctor({ org: 'acme' })).resolves.toBeUndefined();

    expect(intro).toHaveBeenCalledWith('jirallm doctor');
    expect(note).toHaveBeenCalledWith('OS: macos', 'Environment');
    expect(writes).toEqual([]);
    const out = logs.join('\n');
    expect(out).toContain('Node.js');
    expect(out).toContain('ffmpeg');
    expect(out).toContain('OS keychain');
    expect(out).toContain('Config');
    expect(outro).toHaveBeenCalledWith('Doctor finished.');
  });

  it('prints a hint line under a warning result', async () => {
    checkFfmpegMock.mockResolvedValue(false);
    resolveFfmpegBinaryMock.mockResolvedValue(null);

    await runDoctor({ org: 'acme' });

    expect(logs.join('\n')).toContain('brew install ffmpeg');
  });

  it('shows the blocking-issues outro and exits 1 when a check fails', async () => {
    readConfigMock.mockImplementation(() => {
      throw new Error('config broken');
    });

    let caught: unknown;
    await runDoctor({}).catch((e) => {
      caught = e;
    });

    expect(caught).toBeInstanceOf(ExitError);
    expect((caught as ExitError).code).toBe(1);
    expect(outro).toHaveBeenCalledWith('Doctor found blocking issues.');
    const out = logs.join('\n');
    expect(out).toContain('Config');
    expect(out).toContain('config broken');
  });

  it('shows the strict-mode warnings outro and exits 1 without --json', async () => {
    checkFfmpegMock.mockResolvedValue(false);
    resolveFfmpegBinaryMock.mockResolvedValue(null);

    let caught: unknown;
    await runDoctor({ org: 'acme', strict: true }).catch((e) => {
      caught = e;
    });

    expect(caught).toBeInstanceOf(ExitError);
    expect((caught as ExitError).code).toBe(1);
    expect(outro).toHaveBeenCalledWith('Doctor found warnings (strict mode).');
  });
});

describe('runDoctor checkJiraOrg branches', () => {
  it('warns when no API token is stored for an org (no project)', async () => {
    getTokenMock.mockResolvedValue(null);

    await runDoctor({ org: 'acme', json: true });

    const results = JSON.parse(writes.join('')) as {
      name: string;
      severity: string;
      detail: string;
      hint?: string;
    }[];
    const jira = results.find((r) => r.name === 'Jira reachable [acme]');
    expect(jira?.severity).toBe('warn');
    expect(jira?.detail).toContain('no API token stored');
    expect(jira?.hint).toContain('jirallm auth set --org acme');
  });

  it('passes an org check without a project using the stored token', async () => {
    getTokenMock.mockResolvedValue('tok');

    await runDoctor({ org: 'acme', json: true });

    const results = JSON.parse(writes.join('')) as {
      name: string;
      severity: string;
      detail: string;
    }[];
    const jira = results.find((r) => r.name === 'Jira reachable [acme]');
    expect(jira?.severity).toBe('pass');
    expect(jira?.detail).toContain('Jane');
    expect(jira?.detail).toContain('jane@x');
  });

  it('warns when the Jira request throws', async () => {
    getTokenMock.mockResolvedValue('tok');
    getCurrentUserMock.mockRejectedValue(new Error('401 unauthorized'));

    await runDoctor({ org: 'acme', json: true });

    const results = JSON.parse(writes.join('')) as { name: string; severity: string; detail: string }[];
    const jira = results.find((r) => r.name === 'Jira reachable [acme]');
    expect(jira?.severity).toBe('warn');
    expect(jira?.detail).toContain('401 unauthorized');
  });
});

describe('runDoctor checkJira config-level branches', () => {
  it('skips the Jira check with a warning when no orgs are configured', async () => {
    readConfigMock.mockReturnValue({ orgs: {} });

    await runDoctor({ json: true });

    const results = JSON.parse(writes.join('')) as { name: string; severity: string; detail: string }[];
    const jira = results.find((r) => r.name === 'Jira reachable');
    expect(jira?.severity).toBe('warn');
    expect(jira?.detail).toContain('no orgs configured');
  });

  it('checks every configured org when neither --org nor -P is given', async () => {
    getTokenMock.mockResolvedValue('tok');

    await runDoctor({ json: true });

    const results = JSON.parse(writes.join('')) as { name: string; severity: string }[];
    const jira = results.filter((r) => r.name.startsWith('Jira reachable ['));
    expect(jira.map((r) => r.name).sort()).toEqual([
      'Jira reachable [acme]',
      'Jira reachable [globex]',
    ]);
  });

  it('warns and skips Jira when readConfig throws inside checkJira only', async () => {
    let call = 0;
    readConfigMock.mockImplementation(() => {
      call += 1;
      if (call === 1) return CONFIG;
      throw new Error('read failed');
    });

    await runDoctor({ json: true });

    const results = JSON.parse(writes.join('')) as { name: string; severity: string; detail: string }[];
    const jira = results.find((r) => r.name === 'Jira reachable');
    expect(jira?.severity).toBe('warn');
    expect(jira?.detail).toContain('read failed');
  });
});
