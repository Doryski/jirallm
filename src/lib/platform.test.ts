import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

import { exec } from 'child_process';
import {
  detectJsPackageManagerFromUserAgent,
  detectOS,
  detectPackageManager,
  ffmpegInstallCommand,
  getFfmpegInstallHint,
  hasHomebrew,
} from './platform.js';

const mockedExec = vi.mocked(exec) as unknown as ReturnType<typeof vi.fn>;

type ExecCallback = (error: Error | null, result: { stdout: string; stderr: string }) => void;

function setAvailableCommands(available: string[]) {
  mockedExec.mockImplementation((cmd: string, cb: ExecCallback) => {
    if (available.some((c) => cmd.includes(c))) {
      cb(null, { stdout: '', stderr: '' });
    } else {
      cb(new Error(`not found: ${cmd}`), { stdout: '', stderr: '' });
    }
  });
}

function setPlatform(value: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

const originalPlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  vi.clearAllMocks();
});

describe('detectOS', () => {
  it('maps darwin to macos', () => {
    setPlatform('darwin');
    expect(detectOS()).toBe('macos');
  });

  it('maps linux to linux', () => {
    setPlatform('linux');
    expect(detectOS()).toBe('linux');
  });

  it('maps win32 to windows', () => {
    setPlatform('win32');
    expect(detectOS()).toBe('windows');
  });

  it('maps unknown platforms to unknown', () => {
    setPlatform('freebsd');
    expect(detectOS()).toBe('unknown');
  });
});

describe('detectJsPackageManagerFromUserAgent', () => {
  it('detects pnpm', () => {
    expect(detectJsPackageManagerFromUserAgent('pnpm/8.0.0 npm/? node/v20')).toBe('pnpm');
  });

  it('detects yarn', () => {
    expect(detectJsPackageManagerFromUserAgent('yarn/1.22.0 npm/? node/v20')).toBe('yarn');
  });

  it('defaults to npm for npm user agent', () => {
    expect(detectJsPackageManagerFromUserAgent('npm/10.0.0 node/v20')).toBe('npm');
  });

  it('defaults to npm when user agent is undefined', () => {
    const saved = process.env.npm_config_user_agent;
    delete process.env.npm_config_user_agent;
    try {
      expect(detectJsPackageManagerFromUserAgent(undefined)).toBe('npm');
    } finally {
      if (saved !== undefined) process.env.npm_config_user_agent = saved;
    }
  });
});

describe('ffmpegInstallCommand', () => {
  it('returns brew command', () => {
    expect(ffmpegInstallCommand('brew')).toBe('brew install ffmpeg');
  });

  it('returns apt command', () => {
    expect(ffmpegInstallCommand('apt')).toBe('sudo apt install -y ffmpeg');
  });

  it('returns dnf command', () => {
    expect(ffmpegInstallCommand('dnf')).toBe('sudo dnf install -y ffmpeg');
  });

  it('returns pacman command', () => {
    expect(ffmpegInstallCommand('pacman')).toBe('sudo pacman -S --noconfirm ffmpeg');
  });

  it('returns undefined for none', () => {
    expect(ffmpegInstallCommand('none')).toBeUndefined();
  });
});

describe('hasHomebrew', () => {
  it('returns true when brew command exists', async () => {
    setAvailableCommands(['brew']);
    await expect(hasHomebrew()).resolves.toBe(true);
  });

  it('returns false when brew command is missing', async () => {
    setAvailableCommands([]);
    await expect(hasHomebrew()).resolves.toBe(false);
  });
});

describe('detectPackageManager', () => {
  it('returns brew on macos with homebrew', async () => {
    setPlatform('darwin');
    setAvailableCommands(['brew']);
    await expect(detectPackageManager()).resolves.toBe('brew');
  });

  it('returns none on macos without homebrew', async () => {
    setPlatform('darwin');
    setAvailableCommands([]);
    await expect(detectPackageManager()).resolves.toBe('none');
  });

  it('returns apt on linux when apt exists', async () => {
    setPlatform('linux');
    setAvailableCommands(['apt', 'dnf']);
    await expect(detectPackageManager()).resolves.toBe('apt');
  });

  it('returns dnf on linux when only dnf exists', async () => {
    setPlatform('linux');
    setAvailableCommands(['dnf']);
    await expect(detectPackageManager()).resolves.toBe('dnf');
  });

  it('returns pacman on linux when only pacman exists', async () => {
    setPlatform('linux');
    setAvailableCommands(['pacman']);
    await expect(detectPackageManager()).resolves.toBe('pacman');
  });

  it('returns none on linux without supported managers', async () => {
    setPlatform('linux');
    setAvailableCommands([]);
    await expect(detectPackageManager()).resolves.toBe('none');
  });

  it('returns none on windows', async () => {
    setPlatform('win32');
    await expect(detectPackageManager()).resolves.toBe('none');
  });
});

describe('getFfmpegInstallHint', () => {
  it('shows the concrete install command when a package manager is detected', async () => {
    setPlatform('darwin');
    setAvailableCommands(['brew']);
    const hint = await getFfmpegInstallHint();
    expect(hint).toContain('Install with: brew install ffmpeg');
    expect(hint).toContain('jirallm setup');
  });

  it('suggests installing homebrew on macos without a package manager', async () => {
    setPlatform('darwin');
    setAvailableCommands([]);
    const hint = await getFfmpegInstallHint();
    expect(hint).toContain('Homebrew not detected');
  });

  it('gives a distro hint on linux without a package manager', async () => {
    setPlatform('linux');
    setAvailableCommands([]);
    const hint = await getFfmpegInstallHint();
    expect(hint).toContain('No supported package manager detected');
  });

  it('gives a chocolatey hint on windows', async () => {
    setPlatform('win32');
    const hint = await getFfmpegInstallHint();
    expect(hint).toContain('choco install ffmpeg');
  });

  it('falls back to a generic hint on unknown platforms', async () => {
    setPlatform('freebsd');
    const hint = await getFfmpegInstallHint();
    expect(hint).toContain('https://ffmpeg.org/download.html');
    expect(hint).toContain('bundled fallback');
  });
});
