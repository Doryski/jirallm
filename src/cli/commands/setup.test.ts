import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CANCEL_SYMBOL = Symbol('cancel');

const {
  checkFfmpegMock,
  resolveFfmpegBinaryMock,
  runInteractiveMock,
  confirmMock,
  noteMock,
  outroMock,
} = vi.hoisted(() => ({
  checkFfmpegMock: vi.fn(),
  resolveFfmpegBinaryMock: vi.fn(),
  runInteractiveMock: vi.fn(),
  confirmMock: vi.fn(),
  noteMock: vi.fn(),
  outroMock: vi.fn(),
}));

const { detectOSMock, hasHomebrewMock, detectPackageManagerMock } = vi.hoisted(() => ({
  detectOSMock: vi.fn(),
  hasHomebrewMock: vi.fn(),
  detectPackageManagerMock: vi.fn(),
}));

vi.mock('framewise', () => ({
  checkFfmpeg: checkFfmpegMock,
  resolveFfmpegBinary: resolveFfmpegBinaryMock,
}));

vi.mock('../../lib/runCommand.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/runCommand.js')>()),
  runInteractive: runInteractiveMock,
}));

vi.mock('../../lib/platform.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/platform.js')>()),
  detectOS: detectOSMock,
  hasHomebrew: hasHomebrewMock,
  detectPackageManager: detectPackageManagerMock,
}));

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: outroMock,
  note: noteMock,
  cancel: vi.fn(),
  isCancel: (v: unknown) => typeof v === 'symbol',
  confirm: confirmMock,
}));

import { HOMEBREW_INSTALL_CMD } from '../../lib/platform.js';
import { runSetup } from './setup.js';

const noteText = () => noteMock.mock.calls.map((c) => String(c[0])).join('\n');

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  }) as never);
  checkFfmpegMock.mockReset();
  resolveFfmpegBinaryMock.mockReset();
  runInteractiveMock.mockReset();
  confirmMock.mockReset();
  noteMock.mockReset();
  outroMock.mockReset();
  detectOSMock.mockReset();
  hasHomebrewMock.mockReset();
  detectPackageManagerMock.mockReset();
});

const outroText = () => outroMock.mock.calls.map((c) => String(c[0])).join('\n');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runSetup --dry-run', () => {
  it('prints the install plan and runs no installer or prompt (macos with brew)', async () => {
    checkFfmpegMock.mockResolvedValue(false);
    detectOSMock.mockReturnValue('macos');
    hasHomebrewMock.mockResolvedValue(true);
    detectPackageManagerMock.mockResolvedValue('brew');

    await runSetup({ dryRun: true });

    expect(noteText()).toContain('brew install ffmpeg');
    expect(runInteractiveMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('includes the Homebrew install command when Homebrew is missing', async () => {
    checkFfmpegMock.mockResolvedValue(false);
    detectOSMock.mockReturnValue('macos');
    hasHomebrewMock.mockResolvedValue(false);
    detectPackageManagerMock.mockResolvedValue('brew');

    await runSetup({ dryRun: true });

    const text = noteText();
    expect(text).toContain(HOMEBREW_INSTALL_CMD);
    expect(text).toContain('brew install ffmpeg');
    expect(runInteractiveMock).not.toHaveBeenCalled();
  });

  it('reports nothing to do when ffmpeg is already installed', async () => {
    checkFfmpegMock.mockResolvedValue(true);

    await runSetup({ dryRun: true });

    expect(noteText()).toContain('already installed');
    expect(runInteractiveMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });
});

describe('runSetup --allow-brew', () => {
  it('bypasses the Homebrew confirmation and installs Homebrew then ffmpeg', async () => {
    checkFfmpegMock.mockResolvedValueOnce(false).mockResolvedValue(true);
    detectOSMock.mockReturnValue('macos');
    hasHomebrewMock.mockResolvedValue(false);
    detectPackageManagerMock.mockResolvedValue('brew');
    runInteractiveMock.mockResolvedValue(0);

    await runSetup({ allowBrew: true, yes: true });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(runInteractiveMock).toHaveBeenCalledWith(HOMEBREW_INSTALL_CMD);
    expect(runInteractiveMock).toHaveBeenCalledWith('brew install ffmpeg');
  });

  it('prompts for Homebrew confirmation when --allow-brew is not set', async () => {
    checkFfmpegMock.mockResolvedValue(false);
    detectOSMock.mockReturnValue('macos');
    hasHomebrewMock.mockResolvedValue(false);
    detectPackageManagerMock.mockResolvedValue('brew');
    confirmMock.mockResolvedValue(false);

    await expect(runSetup({ yes: true })).rejects.toThrow('exit:1');

    expect(confirmMock).toHaveBeenCalled();
    expect(runInteractiveMock).not.toHaveBeenCalledWith(HOMEBREW_INSTALL_CMD);
  });
});

describe('runSetup (real install, non-dry-run)', () => {
  it('reports nothing to do and installs nothing when ffmpeg already present', async () => {
    checkFfmpegMock.mockResolvedValue(true);

    await runSetup({});

    expect(outroText()).toContain('already installed');
    expect(runInteractiveMock).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('macos: installs ffmpeg via brew after confirmation and re-verifies', async () => {
    checkFfmpegMock.mockResolvedValueOnce(false).mockResolvedValue(true);
    detectOSMock.mockReturnValue('macos');
    hasHomebrewMock.mockResolvedValue(true);
    detectPackageManagerMock.mockResolvedValue('brew');
    confirmMock.mockResolvedValue(true);
    runInteractiveMock.mockResolvedValue(0);

    await runSetup({});

    expect(runInteractiveMock).toHaveBeenCalledExactlyOnceWith('brew install ffmpeg');
    expect(outroText()).toContain('installed successfully');
  });

  it('macos: aborts without installing when the package-manager confirm is declined', async () => {
    checkFfmpegMock.mockResolvedValue(false);
    detectOSMock.mockReturnValue('macos');
    hasHomebrewMock.mockResolvedValue(true);
    detectPackageManagerMock.mockResolvedValue('brew');
    confirmMock.mockResolvedValue(false);

    await expect(runSetup({})).rejects.toThrow('exit:1');

    expect(runInteractiveMock).not.toHaveBeenCalled();
  });

  it('macos: cancelling the confirm prompt aborts the install', async () => {
    checkFfmpegMock.mockResolvedValue(false);
    detectOSMock.mockReturnValue('macos');
    hasHomebrewMock.mockResolvedValue(true);
    detectPackageManagerMock.mockResolvedValue('brew');
    confirmMock.mockResolvedValue(CANCEL_SYMBOL);

    await expect(runSetup({})).rejects.toThrow('exit:1');

    expect(runInteractiveMock).not.toHaveBeenCalled();
  });

  it('macos: shows the bundled fallback and exits when Homebrew install fails', async () => {
    checkFfmpegMock.mockResolvedValue(false);
    detectOSMock.mockReturnValue('macos');
    hasHomebrewMock.mockResolvedValue(false);
    detectPackageManagerMock.mockResolvedValue('brew');
    runInteractiveMock.mockResolvedValue(1);

    await expect(runSetup({ allowBrew: true, yes: true })).rejects.toThrow('exit:1');

    expect(runInteractiveMock).toHaveBeenCalledExactlyOnceWith(HOMEBREW_INSTALL_CMD);
    expect(noteText()).toContain('setup --bundled');
  });

  it('reports failure and exits when re-verify finds ffmpeg still missing after install', async () => {
    checkFfmpegMock.mockResolvedValue(false);
    detectOSMock.mockReturnValue('macos');
    hasHomebrewMock.mockResolvedValue(true);
    detectPackageManagerMock.mockResolvedValue('brew');
    runInteractiveMock.mockResolvedValue(0);

    await expect(runSetup({ yes: true })).rejects.toThrow('exit:1');

    expect(runInteractiveMock).toHaveBeenCalledWith('brew install ffmpeg');
    expect(outroMock).not.toHaveBeenCalled();
  });

  it('linux: installs via apt with --yes and skips the confirm prompt', async () => {
    checkFfmpegMock.mockResolvedValueOnce(false).mockResolvedValue(true);
    detectOSMock.mockReturnValue('linux');
    detectPackageManagerMock.mockResolvedValue('apt');
    runInteractiveMock.mockResolvedValue(0);

    await runSetup({ yes: true });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(runInteractiveMock).toHaveBeenCalledExactlyOnceWith('sudo apt install -y ffmpeg');
    expect(outroText()).toContain('installed successfully');
  });

  it('linux: no package manager -> prints manual note and exits, installs nothing', async () => {
    checkFfmpegMock.mockResolvedValue(false);
    detectOSMock.mockReturnValue('linux');
    detectPackageManagerMock.mockResolvedValue('none');

    await expect(runSetup({})).rejects.toThrow('exit:1');

    expect(noteText()).toContain('No supported package manager');
    expect(runInteractiveMock).not.toHaveBeenCalled();
  });

  it('unknown OS -> prints manual note and exits, installs nothing', async () => {
    checkFfmpegMock.mockResolvedValue(false);
    detectOSMock.mockReturnValue('windows');

    await expect(runSetup({})).rejects.toThrow('exit:1');

    expect(noteText()).toContain('Automatic install not supported');
    expect(runInteractiveMock).not.toHaveBeenCalled();
  });
});

describe('runSetup --bundled', () => {
  const ORIG_UA = process.env.npm_config_user_agent;

  afterEach(() => {
    if (ORIG_UA === undefined) delete process.env.npm_config_user_agent;
    else process.env.npm_config_user_agent = ORIG_UA;
  });

  it('installs ffmpeg-static with --yes and reports the resolved binary', async () => {
    delete process.env.npm_config_user_agent;
    runInteractiveMock.mockResolvedValue(0);
    resolveFfmpegBinaryMock.mockResolvedValue('/path/to/ffmpeg');

    await runSetup({ bundled: true, yes: true });

    expect(confirmMock).not.toHaveBeenCalled();
    expect(runInteractiveMock).toHaveBeenCalledExactlyOnceWith('npm install -g ffmpeg-static');
    expect(outroText()).toContain('Bundled ffmpeg ready');
  });

  it('uses the pnpm global installer when the user-agent is pnpm', async () => {
    process.env.npm_config_user_agent = 'pnpm/9.0.0 node/v20';
    runInteractiveMock.mockResolvedValue(0);
    resolveFfmpegBinaryMock.mockResolvedValue('/path/to/ffmpeg');

    await runSetup({ bundled: true, yes: true });

    expect(runInteractiveMock).toHaveBeenCalledExactlyOnceWith('pnpm add -g ffmpeg-static');
  });

  it('prompts before installing and aborts (exit 1) when the confirm is declined', async () => {
    delete process.env.npm_config_user_agent;
    confirmMock.mockResolvedValue(false);

    await expect(runSetup({ bundled: true })).rejects.toThrow('exit:1');

    expect(confirmMock).toHaveBeenCalled();
    expect(runInteractiveMock).not.toHaveBeenCalled();
  });

  it('propagates the exit code when the install command fails', async () => {
    delete process.env.npm_config_user_agent;
    runInteractiveMock.mockResolvedValue(3);

    await expect(runSetup({ bundled: true, yes: true })).rejects.toThrow('exit:3');

    expect(resolveFfmpegBinaryMock).not.toHaveBeenCalled();
  });

  it('exits 1 when install succeeds but the binary cannot be resolved', async () => {
    delete process.env.npm_config_user_agent;
    runInteractiveMock.mockResolvedValue(0);
    resolveFfmpegBinaryMock.mockResolvedValue(null);

    await expect(runSetup({ bundled: true, yes: true })).rejects.toThrow('exit:1');

    expect(outroMock).not.toHaveBeenCalled();
  });

  it('dry run lists the bundled installer command and installs nothing', async () => {
    delete process.env.npm_config_user_agent;

    await runSetup({ bundled: true, dryRun: true });

    expect(noteText()).toContain('ffmpeg-static');
    expect(runInteractiveMock).not.toHaveBeenCalled();
    expect(checkFfmpegMock).not.toHaveBeenCalled();
  });
});

describe('runSetup --dry-run (additional plans)', () => {
  it('linux with no package manager reports a manual-install message', async () => {
    checkFfmpegMock.mockResolvedValue(false);
    detectOSMock.mockReturnValue('linux');
    detectPackageManagerMock.mockResolvedValue('none');

    await runSetup({ dryRun: true });

    expect(noteText()).toContain('No supported package manager');
    expect(runInteractiveMock).not.toHaveBeenCalled();
  });

  it('unknown OS reports that automatic install is unsupported', async () => {
    checkFfmpegMock.mockResolvedValue(false);
    detectOSMock.mockReturnValue('windows');

    await runSetup({ dryRun: true });

    expect(noteText()).toContain('Automatic install not supported');
    expect(runInteractiveMock).not.toHaveBeenCalled();
  });

  it('linux with apt lists the apt install command', async () => {
    checkFfmpegMock.mockResolvedValue(false);
    detectOSMock.mockReturnValue('linux');
    detectPackageManagerMock.mockResolvedValue('apt');

    await runSetup({ dryRun: true });

    expect(noteText()).toContain('sudo apt install -y ffmpeg');
    expect(runInteractiveMock).not.toHaveBeenCalled();
  });
});
