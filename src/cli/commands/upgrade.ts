import { createRequire } from 'node:module';
import { confirm, intro, isCancel, note, outro } from '@clack/prompts';
import { detectJsPackageManagerFromUserAgent } from '../../lib/platform.js';
import { runInteractive } from '../../lib/runCommand.js';

export type InstallMethod =
  | { kind: 'npx' }
  | { kind: 'homebrew' }
  | { kind: 'npm' | 'pnpm' | 'yarn' };

export type UpgradeOpts = { yes?: boolean; check?: boolean; json?: boolean };

export function detectInstallMethod(
  binaryPath: string = process.argv[1] ?? '',
  userAgent: string | undefined = process.env.npm_config_user_agent
): InstallMethod {
  if (/[\\/](_npx|dlx)[\\/]/.test(binaryPath)) return { kind: 'npx' };
  if (/\/(Cellar|homebrew)\//i.test(binaryPath)) return { kind: 'homebrew' };
  return { kind: detectJsPackageManagerFromUserAgent(userAgent) };
}

export function upgradeCommandFor(method: InstallMethod, packageName: string): string | undefined {
  switch (method.kind) {
    case 'pnpm':
      return `pnpm add -g ${packageName}@latest`;
    case 'yarn':
      return `yarn global add ${packageName}@latest`;
    case 'npm':
      return `npm install -g ${packageName}@latest`;
    default:
      return undefined;
  }
}

type RegistryResponse = { version: string };

export async function fetchLatestVersion(packageName: string): Promise<string> {
  const res = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Registry responded ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as RegistryResponse;
  if (!json.version) throw new Error('Registry response missing "version" field');
  return json.version;
}

function readPackageMeta(): { name: string; version: string } {
  const require = createRequire(import.meta.url);
  const pkg = require('../../../package.json') as { name: string; version: string };
  return { name: pkg.name, version: pkg.version };
}

export async function runUpgrade(opts: UpgradeOpts = {}): Promise<void> {
  const { name, version } = readPackageMeta();
  const method = detectInstallMethod();

  if (opts.check) {
    const latest = await fetchLatestVersion(name);
    const outdated = latest !== version;
    if (opts.json) {
      console.log(JSON.stringify({ current: version, latest, outdated }));
    } else {
      console.log(`Current: ${version}`);
      console.log(`Latest:  ${latest}`);
      console.log(outdated ? `Update available: ${version} → ${latest}` : 'Up to date.');
    }
    if (outdated) process.exit(1);
    return;
  }

  if (method.kind === 'npx') {
    console.log(
      `You're running ${name} via npx/dlx — there's nothing to upgrade. Re-running with the latest version is automatic.`
    );
    return;
  }

  if (method.kind === 'homebrew') {
    console.log(`Installed via Homebrew. Run:\n  brew upgrade ${name}`);
    return;
  }

  const cmd = upgradeCommandFor(method, name);
  if (!cmd) {
    console.error(`Could not determine an upgrade command for install method "${method.kind}".`);
    process.exit(1);
  }

  intro(`${name} upgrade`);
  note(`Will run:\n  ${cmd}`, `Upgrading ${name} (${method.kind})`);

  if (!opts.yes) {
    const ok = await confirm({ message: `Proceed with \`${cmd}\`?`, initialValue: true });
    if (isCancel(ok) || ok !== true) {
      outro('Cancelled.');
      return;
    }
  }

  const code = await runInteractive(cmd);
  if (code !== 0) {
    console.error(`\nUpgrade command exited with code ${code}.`);
    process.exit(code);
  }
  outro(`Upgrade complete. Run \`${name} --version\` to verify.`);
}
