import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type OS = 'macos' | 'linux' | 'windows' | 'unknown';
export type PackageManager = 'brew' | 'apt' | 'dnf' | 'pacman' | 'none';

export function detectOS(): OS {
  switch (process.platform) {
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    default:
      return 'unknown';
  }
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execAsync(`command -v ${cmd}`);
    return true;
  } catch {
    return false;
  }
}

export async function hasHomebrew(): Promise<boolean> {
  return commandExists('brew');
}

export async function detectPackageManager(): Promise<PackageManager> {
  const os = detectOS();
  if (os === 'macos') return (await hasHomebrew()) ? 'brew' : 'none';
  if (os === 'linux') {
    if (await commandExists('apt')) return 'apt';
    if (await commandExists('dnf')) return 'dnf';
    if (await commandExists('pacman')) return 'pacman';
    return 'none';
  }
  return 'none';
}

export function ffmpegInstallCommand(pm: PackageManager): string | undefined {
  switch (pm) {
    case 'brew':
      return 'brew install ffmpeg';
    case 'apt':
      return 'sudo apt install -y ffmpeg';
    case 'dnf':
      return 'sudo dnf install -y ffmpeg';
    case 'pacman':
      return 'sudo pacman -S --noconfirm ffmpeg';
    default:
      return undefined;
  }
}

export async function getFfmpegInstallHint(): Promise<string> {
  const os = detectOS();
  const pm = await detectPackageManager();
  const cmd = ffmpegInstallCommand(pm);

  const lines: string[] = [];
  if (cmd) {
    lines.push(`Install with: ${cmd}`);
  } else if (os === 'macos') {
    lines.push('Homebrew not detected. Install Homebrew (https://brew.sh), then: brew install ffmpeg');
  } else if (os === 'linux') {
    lines.push('No supported package manager detected. Install ffmpeg via your distro (https://ffmpeg.org/download.html).');
  } else if (os === 'windows') {
    lines.push('Install ffmpeg from https://ffmpeg.org/download.html or via Chocolatey: choco install ffmpeg');
  } else {
    lines.push('Install ffmpeg from https://ffmpeg.org/download.html');
  }
  lines.push('Or run: jirallm setup');
  lines.push('Or use bundled fallback: pnpm add -g ffmpeg-static (then re-run jirallm)');
  return lines.join('\n');
}

export type JsPackageManager = 'npm' | 'pnpm' | 'yarn';

export function detectJsPackageManagerFromUserAgent(
  userAgent: string | undefined = process.env.npm_config_user_agent
): JsPackageManager {
  const ua = userAgent ?? '';
  if (ua.includes('pnpm')) return 'pnpm';
  if (ua.includes('yarn')) return 'yarn';
  return 'npm';
}

export const HOMEBREW_INSTALL_CMD =
  '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/main/install.sh)"';
