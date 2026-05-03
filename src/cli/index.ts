#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { select, isCancel, cancel } from '@clack/prompts';
import { JiraExporter } from '../lib/exporter.js';
import { findOrgsByProjectKey, loadProfile, readConfig } from '../lib/config.js';
import { parseIssueKeyArgs } from './issueKey.js';
import { runInit } from './commands/init.js';
import { runAuthSet, runAuthRm, runAuthList, runAuthStatus } from './commands/auth.js';
import { runOrgsList, runOrgsRemove, runProjectRemove } from './commands/orgs.js';
import { runDoctor } from './commands/doctor.js';
import { runSetup } from './commands/setup.js';

type ExportFlags = {
  org?: string;
  project?: string;
  outputDir?: string;
  baseUrl?: string;
  userEmail?: string;
  apiToken?: string;
  videoFrames: boolean;
  fps?: string;
  maxFrames?: string;
  includeSubtasks?: boolean;
};

async function pickOrgInteractively(
  candidates: string[],
  projectKey: string
): Promise<string> {
  const raw = readConfig();
  const choice = await select({
    message: `Multiple orgs have a "${projectKey}" project. Which one?`,
    options: candidates.map((name) => ({
      value: name,
      label: name,
      hint: raw.orgs?.[name]?.base_url,
    })),
  });
  if (isCancel(choice)) {
    cancel('Cancelled.');
    process.exit(0);
  }
  return choice as string;
}

async function resolveOrgAndKeys(
  rawArgs: string[],
  flags: ExportFlags
): Promise<{ org: string; projectKey: string; keys: string[] }> {
  const parsed = parseIssueKeyArgs(rawArgs);
  const keys = parsed.keys;

  if (flags.org && parsed.org && flags.org !== parsed.org) {
    throw new Error(
      `--org "${flags.org}" conflicts with the org/ prefix "${parsed.org}/" in the issue keys.`
    );
  }

  const projectKey = flags.project ?? parsed.projectKey;
  const explicitOrg = flags.org ?? parsed.org;
  if (explicitOrg) return { org: explicitOrg, projectKey, keys };

  const matches = findOrgsByProjectKey(parsed.projectKey);
  if (matches.length === 0) {
    throw new Error(
      `Project "${parsed.projectKey}" not found in any configured org. ` +
        'Run `jirallm init` to add it, or pass --org explicitly.'
    );
  }
  if (matches.length === 1) return { org: matches[0], projectKey, keys };

  if (!process.stdin.isTTY) {
    throw new Error(
      `Project "${parsed.projectKey}" exists in multiple orgs (${matches.join(', ')}). ` +
        `Pass --org or use the org/${parsed.projectKey}-N syntax.`
    );
  }
  const org = await pickOrgInteractively(matches, parsed.projectKey);
  return { org, projectKey, keys };
}

async function runExport(rawArgs: string[], flags: ExportFlags): Promise<void> {
  if (rawArgs.length === 0) {
    await runInit();
    process.exit(0);
  }

  let baseUrl = flags.baseUrl;
  let userEmail = flags.userEmail;
  let projectKey = flags.project;
  let apiToken = flags.apiToken;
  let outputDir = flags.outputDir ?? './jira-export';
  let includeSubtasks = flags.includeSubtasks ?? false;
  let videoEnabled = flags.videoFrames;
  let fps = flags.fps ? parseInt(flags.fps, 10) : 5;
  let maxFrames = flags.maxFrames ? parseInt(flags.maxFrames, 10) : 10;

  let keys: string[];
  let org: string | undefined = flags.org;

  try {
    const resolved = await resolveOrgAndKeys(rawArgs, flags);
    org = resolved.org;
    projectKey = resolved.projectKey;
    keys = resolved.keys;
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  if (!(baseUrl && userEmail && apiToken)) {
    try {
      const resolved = await loadProfile({ org, project: projectKey });
      baseUrl = baseUrl ?? resolved.config.baseUrl;
      userEmail = userEmail ?? resolved.config.userEmail;
      projectKey = projectKey ?? resolved.project.key;
      apiToken = apiToken ?? resolved.apiToken;
      if (!flags.outputDir && resolved.project.outputDir) {
        outputDir = resolved.project.outputDir;
      }
      if (flags.includeSubtasks === undefined && resolved.org.includeSubtasks !== undefined) {
        includeSubtasks = resolved.org.includeSubtasks;
      }
      if (resolved.org.videoFrames) {
        if (resolved.org.videoFrames.enabled === false && flags.videoFrames !== false) {
          videoEnabled = false;
        }
        if (!flags.fps && resolved.org.videoFrames.fps !== undefined) {
          fps = resolved.org.videoFrames.fps;
        }
        if (!flags.maxFrames && resolved.org.videoFrames.maxFrames !== undefined) {
          maxFrames = resolved.org.videoFrames.maxFrames;
        }
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  }

  const exporter = new JiraExporter(
    { baseUrl: baseUrl!, projectKey: projectKey!, userEmail: userEmail! },
    apiToken!
  );

  console.log(`Exporting ${keys.length} issue(s) to ${outputDir}...`);

  const result = await exporter.exportIssues(keys, {
    outputDir,
    includeSubtasks,
    videoFrames: { enabled: videoEnabled, fps, maxFrames },
  });

  console.log('\nExport summary:');
  if (result.imported.length > 0) {
    console.log(`  Imported (${result.imported.length}): ${result.imported.join(', ')}`);
  }
  if (result.updated.length > 0) {
    console.log(`  Updated (${result.updated.length}): ${result.updated.join(', ')}`);
  }
  if (result.failed.length > 0) {
    console.log(`  Failed (${result.failed.length}):`);
    for (const { key, error } of result.failed) console.log(`    - ${key}: ${error}`);
    process.exit(1);
  }
}

const program = new Command();
program.enablePositionalOptions();

const pkg = createRequire(import.meta.url)('../../package.json') as {
  name: string;
  description: string;
  version: string;
};

program.name(pkg.name).description(pkg.description).version(pkg.version);

program
  .argument('[issue-keys...]', 'Jira issue keys, e.g. PROJ-123 or acme/PROJ-123')
  .option('-o, --org <name>', 'Organization name from config (auto-resolved from issue prefix if unique)')
  .option('-P, --project <key>', 'Project key override')
  .option('--output-dir <path>', 'Output directory (default: ./jira-export)')
  .option('--base-url <url>', 'Jira base URL (overrides config)')
  .option('--user-email <email>', 'Jira user email (overrides config)')
  .option('--api-token <token>', 'Jira API token (overrides keychain)')
  .option('--no-video-frames', 'Disable video frame extraction')
  .option('--fps <n>', 'Frame extraction FPS')
  .option('--max-frames <n>', 'Max frames kept per video')
  .option('--include-subtasks', 'Fetch and include subtask metadata')
  .action(async (keys: string[], flags: ExportFlags) => {
    await runExport(keys, flags);
  })
  .addHelpText(
    'after',
    `
Examples:
  $ jirallm init
  $ jirallm PROJ-123                       # auto-resolves org from PROJ prefix
  $ jirallm acme/PROJ-123                  # disambiguate when multiple orgs have PROJ
  $ jirallm PROJ-123 PROJ-124 --output-dir ./context
  $ jirallm PROJ-123 --no-video-frames
  $ jirallm PROJ-123 --fps 2 --max-frames 6
  $ jirallm PROJ-123 --include-subtasks
  $ jirallm --org acme PROJ-123
  $ jirallm doctor --org acme
  $ jirallm setup
  $ jirallm orgs list

Run \`jirallm <command> --help\` for command-specific options.
`
  );

program
  .command('init')
  .description('Interactive setup wizard — creates an org or adds a project, and stores the API token in your OS keychain')
  .action(async () => {
    await runInit();
  })
  .addHelpText('after', '\nExample:\n  $ jirallm init\n');

const auth = program.command('auth').description('Manage stored API tokens (per organization)');
auth
  .command('set')
  .description('Store/replace the API token for an organization')
  .requiredOption('-o, --org <name>', 'Organization name')
  .action(async (opts: { org: string }) => {
    await runAuthSet(opts.org);
  });
auth
  .command('rm')
  .description('Remove the stored API token for an organization')
  .requiredOption('-o, --org <name>', 'Organization name')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (opts: { org: string; yes?: boolean }) => {
    await runAuthRm(opts.org, { yes: opts.yes });
  });
auth
  .command('list')
  .description('List all orgs and the resolved state of their API tokens')
  .action(async () => {
    await runAuthList();
  });
auth
  .command('status')
  .description('Show whether a token is resolvable for an org (exits non-zero if missing)')
  .requiredOption('-o, --org <name>', 'Organization name')
  .action(async (opts: { org: string }) => {
    await runAuthStatus(opts.org);
  });
auth.addHelpText(
  'after',
  `
Examples:
  $ jirallm auth list
  $ jirallm auth status --org acme
  $ jirallm auth set --org acme
  $ jirallm auth rm --org acme --yes
`
);

const orgs = program.command('orgs').description('Inspect or modify organizations and their projects');
orgs
  .command('list')
  .description('List all configured organizations and projects')
  .action(async () => {
    await runOrgsList();
  });
orgs
  .command('rm')
  .description('Remove an organization (and its keychain token) along with all its projects')
  .requiredOption('-o, --org <name>', 'Organization name')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (opts: { org: string; yes?: boolean }) => {
    await runOrgsRemove(opts.org, { yes: opts.yes });
  });
const orgProject = orgs.command('project').description('Manage projects within an organization');
orgProject
  .command('rm')
  .description('Remove a project from an organization')
  .requiredOption('-o, --org <name>', 'Organization name')
  .requiredOption('-k, --key <key>', 'Project key')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (opts: { org: string; key: string; yes?: boolean }) => {
    await runProjectRemove(opts.org, opts.key, { yes: opts.yes });
  });
orgs.addHelpText(
  'after',
  `
Examples:
  $ jirallm orgs list
  $ jirallm orgs rm --org acme
  $ jirallm orgs project rm --org acme --key PROJ
`
);

program
  .command('doctor')
  .description('Check that everything jirallm needs is installed and reachable')
  .option('-o, --org <name>', 'Organization to use for the Jira reachability check')
  .option('-P, --project <key>', 'Project key to use for the Jira reachability check')
  .action(async (opts: { org?: string; project?: string }) => {
    await runDoctor({ org: opts.org, project: opts.project });
  })
  .addHelpText('after', '\nExample:\n  $ jirallm doctor --org acme\n');

program
  .command('setup')
  .description('Install missing system dependencies (currently: ffmpeg) with cascading consent')
  .option('--bundled', 'Install ffmpeg-static globally instead of system ffmpeg')
  .option('-y, --yes', 'Auto-confirm package-manager install (does NOT auto-confirm Homebrew install)')
  .action(async (opts: { bundled?: boolean; yes?: boolean }) => {
    await runSetup({ bundled: opts.bundled, yes: opts.yes });
  })
  .addHelpText(
    'after',
    `
Examples:
  $ jirallm setup
  $ jirallm setup --yes
  $ jirallm setup --bundled
`
  );

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
