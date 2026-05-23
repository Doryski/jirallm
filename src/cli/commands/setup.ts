import { intro, outro, confirm, note, isCancel, cancel } from '@clack/prompts';
import { checkFFmpegInstalled, resolveFfmpegBinary } from '../../lib/videoFrameExtractor.js';
import {
  detectJsPackageManagerFromUserAgent,
  detectOS,
  detectPackageManager,
  ffmpegInstallCommand,
  hasHomebrew,
  HOMEBREW_INSTALL_CMD,
  type PackageManager,
} from '../../lib/platform.js';
import { runInteractive } from '../../lib/runCommand.js';

type SetupOpts = { bundled?: boolean; yes?: boolean };

async function confirmStep(message: string, defaultYes: boolean): Promise<boolean> {
  const ok = await confirm({ message, initialValue: defaultYes });
  if (isCancel(ok)) {
    cancel('Cancelled.');
    return false;
  }
  return ok === true;
}

function detectGlobalInstaller(): string {
  const pm = detectJsPackageManagerFromUserAgent();
  if (pm === 'pnpm') return 'pnpm add -g ffmpeg-static';
  if (pm === 'yarn') return 'yarn global add ffmpeg-static';
  return 'npm install -g ffmpeg-static';
}

async function installBundled(opts: SetupOpts): Promise<number> {
  const cmd = detectGlobalInstaller();
  note(`Will run:\n  ${cmd}`, 'Bundled ffmpeg-static install');
  if (!opts.yes && !(await confirmStep('Proceed with installing ffmpeg-static globally?', true))) {
    return 1;
  }
  const code = await runInteractive(cmd);
  if (code !== 0) {
    console.error(`\nInstall command exited with code ${code}.`);
    return code;
  }
  const resolved = await resolveFfmpegBinary();
  if (resolved) {
    console.log(`\nffmpeg resolved at: ${resolved}`);
    return 0;
  }
  console.error(
    '\nffmpeg-static installed but jirallm could not resolve it. Verify the global install path is on NODE_PATH.'
  );
  return 1;
}

async function installViaPackageManager(pm: PackageManager, opts: SetupOpts): Promise<number> {
  const cmd = ffmpegInstallCommand(pm);
  if (!cmd) return 1;
  note(`Will run:\n  ${cmd}`, 'Installing ffmpeg');
  if (!opts.yes && !(await confirmStep(`Run \`${cmd}\`?`, true))) {
    return 1;
  }
  return runInteractive(cmd);
}

async function installHomebrew(): Promise<number> {
  const disclosure = [
    'Homebrew is not installed. The official installer:',
    '  • Downloads and runs a script from raw.githubusercontent.com/Homebrew',
    '  • Requires sudo (you will be prompted for your password)',
    '  • May trigger Xcode Command Line Tools install (~1GB, GUI prompt)',
    '  • Takes 5–15 minutes on a fresh machine',
    '',
    `Install command:\n  ${HOMEBREW_INSTALL_CMD}`,
  ].join('\n');
  note(disclosure, 'Homebrew install — read carefully');

  // Homebrew install ALWAYS requires interactive consent — never auto via --yes.
  if (!(await confirmStep('Install Homebrew now?', false))) {
    console.log('Skipped Homebrew install. See https://brew.sh for manual instructions.');
    return 1;
  }
  const code = await runInteractive(HOMEBREW_INSTALL_CMD);
  if (code !== 0) {
    console.error(`\nHomebrew installer exited with code ${code}.`);
  }
  return code;
}

export async function runSetup(opts: SetupOpts = {}): Promise<void> {
  intro('jirallm setup');

  if (opts.bundled) {
    const code = await installBundled(opts);
    if (code === 0) outro('Bundled ffmpeg ready.');
    else process.exit(code);
    return;
  }

  if (await checkFFmpegInstalled()) {
    outro('ffmpeg already installed. Nothing to do.');
    return;
  }

  const os = detectOS();

  if (os === 'macos') {
    if (!(await hasHomebrew())) {
      const hbCode = await installHomebrew();
      if (hbCode !== 0) {
        note(
          'You can also use the bundled fallback:\n  jirallm setup --bundled',
          'Alternative'
        );
        process.exit(hbCode);
      }
    }
    const pm = await detectPackageManager();
    const code = await installViaPackageManager(pm, opts);
    if (code !== 0) process.exit(code);
  } else if (os === 'linux') {
    const pm = await detectPackageManager();
    if (pm === 'none') {
      note(
        'No supported package manager detected (apt/dnf/pacman). Install ffmpeg manually or use:\n  jirallm setup --bundled',
        'Manual install required'
      );
      process.exit(1);
    }
    const code = await installViaPackageManager(pm, opts);
    if (code !== 0) process.exit(code);
  } else {
    note(
      'Automatic install not supported on this OS. Options:\n  • Install ffmpeg manually (https://ffmpeg.org/download.html)\n  • Use bundled fallback: jirallm setup --bundled',
      'Manual install required'
    );
    process.exit(1);
  }

  // Re-verify
  if (await checkFFmpegInstalled()) {
    outro('ffmpeg installed successfully.');
    return;
  }
  console.error('Install reported success but ffmpeg is still not on PATH. Open a new shell and try `ffmpeg -version`.');
  process.exit(1);
}
