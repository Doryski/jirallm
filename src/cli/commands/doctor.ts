import { intro, outro, note } from '@clack/prompts';
import { checkFfmpeg, resolveFfmpegBinary } from 'framewise';
import { detectOS, getFfmpegInstallHint } from '../../lib/platform.js';
import { readConfig, resolveConfigPath, loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { getToken } from '../../lib/credentials.js';

type Severity = 'pass' | 'fail' | 'warn';

const symbols: Record<Severity, string> = {
  pass: '\x1b[32m✔\x1b[0m',
  fail: '\x1b[31m✖\x1b[0m',
  warn: '\x1b[33m⚠\x1b[0m',
};

type CheckResult = {
  name: string;
  severity: Severity;
  detail: string;
  hint?: string;
};

function printResult(r: CheckResult): void {
  console.log(`${symbols[r.severity]} ${r.name}: ${r.detail}`);
  if (r.hint) {
    for (const line of r.hint.split('\n')) console.log(`    \x1b[2m${line}\x1b[0m`);
  }
}

function checkNode(): CheckResult {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major >= 20) {
    return { name: 'Node.js', severity: 'pass', detail: `v${process.versions.node}` };
  }
  return {
    name: 'Node.js',
    severity: 'fail',
    detail: `v${process.versions.node} (requires >= 20)`,
    hint: 'Upgrade Node.js to 20 or later (https://nodejs.org).',
  };
}

async function checkFfmpegStatus(): Promise<CheckResult> {
  if (await checkFfmpeg()) {
    return { name: 'ffmpeg', severity: 'pass', detail: 'system ffmpeg available' };
  }
  const resolved = await resolveFfmpegBinary();
  if (resolved) {
    return {
      name: 'ffmpeg',
      severity: 'pass',
      detail: `bundled (${resolved})`,
    };
  }
  return {
    name: 'ffmpeg',
    severity: 'warn',
    detail: 'not found (video frame extraction will fail)',
    hint: await getFfmpegInstallHint(),
  };
}

async function checkKeychain(): Promise<CheckResult> {
  try {
    const mod = (await import('@napi-rs/keyring')) as { Entry?: unknown };
    if (!mod?.Entry) throw new Error('@napi-rs/keyring not loaded');
    return { name: 'OS keychain', severity: 'pass', detail: '@napi-rs/keyring loaded' };
  } catch (err) {
    return {
      name: 'OS keychain',
      severity: 'fail',
      detail: '@napi-rs/keyring unavailable; tokens cannot be stored or read',
      hint:
        err instanceof Error
          ? `${err.message}\nTry reinstalling jirallm; ensure your platform binary is supported.`
          : 'Try reinstalling jirallm; ensure your platform binary is supported.',
    };
  }
}

function checkConfig(): CheckResult {
  const path = resolveConfigPath();
  try {
    const raw = readConfig(path);
    const orgs = Object.keys(raw.orgs ?? {});
    if (orgs.length === 0) {
      return {
        name: 'Config',
        severity: 'warn',
        detail: `no orgs configured (${path})`,
        hint: 'Run `jirallm init` to create one.',
      };
    }
    const projectCount = orgs.reduce(
      (acc, name) => acc + Object.keys(raw.orgs?.[name].projects ?? {}).length,
      0
    );
    return {
      name: 'Config',
      severity: 'pass',
      detail: `${orgs.length} org(s), ${projectCount} project(s) at ${path}`,
    };
  } catch (err) {
    return {
      name: 'Config',
      severity: 'fail',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkJiraOrg(orgName: string, project?: string): Promise<CheckResult> {
  const label = `Jira reachable [${orgName}]`;
  try {
    const raw = readConfig();
    const orgRaw = raw.orgs?.[orgName];
    if (!orgRaw) {
      return {
        name: label,
        severity: 'fail',
        detail: `org "${orgName}" not found in config`,
      };
    }
    if (project) {
      const resolved = await loadProfile({ org: orgName, project });
      const client = new JiraClient(resolved.config, resolved.apiToken);
      const user = await client.getCurrentUser();
      return {
        name: label,
        severity: 'pass',
        detail: `${resolved.org.baseUrl} as ${user.displayName}${user.emailAddress ? ` <${user.emailAddress}>` : ''}`,
      };
    }
    const apiToken = await getToken(orgName);
    if (!apiToken) {
      return {
        name: label,
        severity: 'warn',
        detail: `no API token stored for org "${orgName}"`,
        hint: `Run \`jirallm auth set --org ${orgName}\`.`,
      };
    }
    const firstProjectKey = Object.keys(orgRaw.projects ?? {})[0] ?? '';
    const client = new JiraClient(
      { baseUrl: orgRaw.base_url, userEmail: orgRaw.user_email, projectKey: firstProjectKey },
      apiToken
    );
    const user = await client.getCurrentUser();
    return {
      name: label,
      severity: 'pass',
      detail: `${orgRaw.base_url} as ${user.displayName}${user.emailAddress ? ` <${user.emailAddress}>` : ''}`,
    };
  } catch (err) {
    return {
      name: label,
      severity: 'warn',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkJira(org?: string, project?: string): Promise<CheckResult[]> {
  if (org) return [await checkJiraOrg(org, project)];
  let orgs: string[];
  try {
    const raw = readConfig();
    orgs = Object.keys(raw.orgs ?? {});
  } catch (err) {
    return [
      {
        name: 'Jira reachable',
        severity: 'warn',
        detail: `skipped: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
  if (orgs.length === 0) {
    return [
      {
        name: 'Jira reachable',
        severity: 'warn',
        detail: 'skipped (no orgs configured)',
        hint: 'Run `jirallm init` to create one.',
      },
    ];
  }
  return Promise.all(orgs.map((name) => checkJiraOrg(name)));
}

export async function runDoctor(opts: { org?: string; project?: string } = {}): Promise<void> {
  intro('jirallm doctor');
  note(`OS: ${detectOS()}`, 'Environment');

  const results: CheckResult[] = [];
  results.push(checkNode());
  results.push(await checkFfmpegStatus());
  results.push(await checkKeychain());
  results.push(checkConfig());
  results.push(...(await checkJira(opts.org, opts.project)));

  for (const r of results) printResult(r);

  const failed = results.some((r) => r.severity === 'fail');
  if (failed) {
    outro('Doctor found blocking issues.');
    process.exit(1);
  }
  outro('Doctor finished.');
}
