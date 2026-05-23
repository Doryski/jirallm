import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runInteractiveMock, confirmMock } = vi.hoisted(() => ({
  runInteractiveMock: vi.fn(),
  confirmMock: vi.fn(),
}));

vi.mock('../../lib/runCommand.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/runCommand.js')>()),
  runInteractive: runInteractiveMock,
}));

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  isCancel: (v: unknown) => typeof v === 'symbol',
  confirm: confirmMock,
}));

import {
  detectInstallMethod,
  fetchLatestVersion,
  runUpgrade,
  upgradeCommandFor,
} from './upgrade.js';

let logs: string[];
let errors: string[];

beforeEach(() => {
  logs = [];
  errors = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a.map(String).join(' ')); });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit:${code ?? 0}`); }) as never);
  runInteractiveMock.mockReset();
  confirmMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('detectInstallMethod', () => {
  it('detects npx by binary path', () => {
    expect(detectInstallMethod('/Users/x/.npm/_npx/abc/node_modules/.bin/jirallm', 'npm/10')).toEqual({ kind: 'npx' });
  });

  it('detects pnpm dlx by binary path', () => {
    expect(detectInstallMethod('/Users/x/.local/share/pnpm/dlx/abc/jirallm', 'pnpm/9')).toEqual({ kind: 'npx' });
  });

  it('detects Homebrew install', () => {
    expect(detectInstallMethod('/opt/homebrew/Cellar/jirallm/0.1.1/bin/jirallm', 'npm/10')).toEqual({ kind: 'homebrew' });
  });

  it('detects pnpm via user-agent', () => {
    expect(detectInstallMethod('/usr/local/lib/node_modules/jirallm/dist/cli/index.js', 'pnpm/9.0.0 npm/? node/v20')).toEqual({ kind: 'pnpm' });
  });

  it('detects yarn via user-agent', () => {
    expect(detectInstallMethod('/usr/local/lib/node_modules/jirallm/dist/cli/index.js', 'yarn/1.22 node/v20')).toEqual({ kind: 'yarn' });
  });

  it('falls back to npm', () => {
    expect(detectInstallMethod('/usr/local/lib/node_modules/jirallm/dist/cli/index.js', '')).toEqual({ kind: 'npm' });
  });
});

describe('upgradeCommandFor', () => {
  it.each([
    ['npm', 'npm install -g jirallm@latest'],
    ['pnpm', 'pnpm add -g jirallm@latest'],
    ['yarn', 'yarn global add jirallm@latest'],
  ] as const)('produces %s command', (kind, expected) => {
    expect(upgradeCommandFor({ kind }, 'jirallm')).toBe(expected);
  });

  it('returns undefined for non-installable methods', () => {
    expect(upgradeCommandFor({ kind: 'npx' }, 'jirallm')).toBeUndefined();
    expect(upgradeCommandFor({ kind: 'homebrew' }, 'jirallm')).toBeUndefined();
  });
});

describe('fetchLatestVersion', () => {
  it('returns version from registry', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ version: '9.9.9' }), { status: 200 })
    );
    await expect(fetchLatestVersion('jirallm')).resolves.toBe('9.9.9');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://registry.npmjs.org/jirallm/latest',
      expect.any(Object)
    );
  });

  it('throws on non-OK response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500, statusText: 'err' }));
    await expect(fetchLatestVersion('jirallm')).rejects.toThrow(/500/);
  });
});

describe('runUpgrade', () => {
  const ORIG_ARGV = process.argv;
  const ORIG_UA = process.env.npm_config_user_agent;

  afterEach(() => {
    process.argv = ORIG_ARGV;
    process.env.npm_config_user_agent = ORIG_UA;
  });

  function setEnv(binaryPath: string, ua: string | undefined) {
    process.argv = ['node', binaryPath];
    if (ua === undefined) delete process.env.npm_config_user_agent;
    else process.env.npm_config_user_agent = ua;
  }

  it('npx install: prints message and does not spawn', async () => {
    setEnv('/Users/x/.npm/_npx/abc/.bin/jirallm', 'npm/10');
    await runUpgrade({ yes: true });
    expect(runInteractiveMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('npx/dlx');
  });

  it('Homebrew install: prints brew instruction and does not spawn', async () => {
    setEnv('/opt/homebrew/Cellar/jirallm/0.1.1/bin/jirallm', 'npm/10');
    await runUpgrade({ yes: true });
    expect(runInteractiveMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('brew upgrade jirallm');
  });

  it('npm global install with --yes: runs npm command', async () => {
    setEnv('/usr/local/lib/node_modules/jirallm/dist/cli/index.js', 'npm/10');
    runInteractiveMock.mockResolvedValue(0);
    await runUpgrade({ yes: true });
    expect(runInteractiveMock).toHaveBeenCalledWith('npm install -g jirallm@latest');
  });

  it('pnpm global install with --yes: runs pnpm command', async () => {
    setEnv('/usr/local/lib/node_modules/jirallm/dist/cli/index.js', 'pnpm/9');
    runInteractiveMock.mockResolvedValue(0);
    await runUpgrade({ yes: true });
    expect(runInteractiveMock).toHaveBeenCalledWith('pnpm add -g jirallm@latest');
  });

  it('yarn global install with --yes: runs yarn command', async () => {
    setEnv('/usr/local/lib/node_modules/jirallm/dist/cli/index.js', 'yarn/1.22');
    runInteractiveMock.mockResolvedValue(0);
    await runUpgrade({ yes: true });
    expect(runInteractiveMock).toHaveBeenCalledWith('yarn global add jirallm@latest');
  });

  it('--check up-to-date: prints versions, does not spawn, does not exit', async () => {
    setEnv('/usr/local/lib/node_modules/jirallm/dist/cli/index.js', 'npm/10');
    const { version } = (await import('../../../package.json', { with: { type: 'json' } })).default as { version: string };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ version }), { status: 200 }));
    await runUpgrade({ check: true });
    expect(runInteractiveMock).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Up to date');
  });

  it('--check when outdated: exits non-zero', async () => {
    setEnv('/usr/local/lib/node_modules/jirallm/dist/cli/index.js', 'npm/10');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ version: '99.0.0' }), { status: 200 }));
    await expect(runUpgrade({ check: true })).rejects.toThrow('exit:1');
    expect(logs.join('\n')).toContain('Update available');
  });

  it('without --yes, confirms via prompt and aborts on no', async () => {
    setEnv('/usr/local/lib/node_modules/jirallm/dist/cli/index.js', 'npm/10');
    confirmMock.mockResolvedValue(false);
    await runUpgrade({});
    expect(runInteractiveMock).not.toHaveBeenCalled();
  });

  it('exits non-zero when install command fails', async () => {
    setEnv('/usr/local/lib/node_modules/jirallm/dist/cli/index.js', 'npm/10');
    runInteractiveMock.mockResolvedValue(2);
    await expect(runUpgrade({ yes: true })).rejects.toThrow('exit:2');
  });
});
