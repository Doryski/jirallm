#!/usr/bin/env node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { Command, Option } from 'commander';
import updateNotifier from 'update-notifier';
import { JiraExporter } from '../lib/exporter.js';
import { listOrgs, loadProfile } from '../lib/config.js';
import { resolveOrgInteractive } from './resolveOrg.js';
import { parseIssueKeyArgs } from './issueKey.js';
import {
  DEFAULT_IMAGE_LAYOUT,
  DEFAULT_IMAGE_WIDTH,
  IMAGE_LAYOUTS,
} from '../lib/adfMedia.js';
import { runInit } from './commands/init.js';
import { runAuthSet, runAuthRm, runAuthList, runAuthStatus } from './commands/auth.js';
import { runOrgsList, runOrgsRemove, runProjectRemove } from './commands/orgs.js';
import { runDoctor } from './commands/doctor.js';
import { runSetup } from './commands/setup.js';
import {
  runComment,
  runCommentList,
  runDeleteComment,
  runEditComment,
} from './commands/comment.js';
import { runBoardIssues } from './commands/board.js';
import { runTransition } from './commands/transition.js';
import { runWorklog } from './commands/worklog.js';
import { runSearch } from './commands/search.js';
import { runProjects } from './commands/projects.js';
import { runBoards } from './commands/boards.js';
import { runSprints } from './commands/sprints.js';
import { runIssueTypes } from './commands/issuetypes.js';
import { runComponents } from './commands/components.js';
import { runFields } from './commands/fields.js';
import { runLinkTypes } from './commands/linktypes.js';
import { runMe } from './commands/me.js';
import { runUsers } from './commands/users.js';
import { runFetch } from './commands/fetch.js';
import { runCreate } from './commands/create.js';
import { runEdit } from './commands/edit.js';
import { runAssign } from './commands/assign.js';
import { runLink, runLinkRemove } from './commands/link.js';
import { runAttach, runAttachRemove } from './commands/attach.js';
import { runWatchers } from './commands/watchers.js';
import { runUpgrade } from './commands/upgrade.js';
import { parseFieldsFlag, resolveFieldSet } from '../lib/exportFields.js';

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
  fields?: string;
  dryRun?: boolean;
  withHistory?: boolean;
  withWorklog?: boolean;
};

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
  const org = await resolveOrgInteractive(parsed.org, flags.org, parsed.projectKey);
  return { org, projectKey, keys };
}

async function runExport(rawArgs: string[], flags: ExportFlags, program: Command): Promise<void> {
  if (rawArgs.length === 0) {
    if (listOrgs().length > 0) {
      program.outputHelp();
      process.exit(0);
    }
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
  let fieldSelector = flags.fields ? parseFieldsFlag(flags.fields) : undefined;
  let customFieldDefs: import('../lib/exportFields.js').CustomFieldDefs | undefined;

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
      if (resolved.org.export) {
        if (!fieldSelector && resolved.org.export.fieldSelector) {
          fieldSelector = resolved.org.export.fieldSelector;
        }
        if (resolved.org.export.customFieldDefs) {
          customFieldDefs = resolved.org.export.customFieldDefs;
        }
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

  if (flags.dryRun) {
    const resolved = resolveFieldSet(fieldSelector, customFieldDefs ?? {});
    console.log('Dry run — no Jira calls or file writes will be performed.');
    console.log(`Org:           ${org}`);
    console.log(`Project:       ${projectKey}`);
    console.log(`Base URL:      ${baseUrl}`);
    console.log(`Output dir:    ${outputDir}`);
    console.log(`Include subtasks: ${includeSubtasks}`);
    console.log(`With history:  ${flags.withHistory ?? false}`);
    console.log(`With worklog:  ${flags.withWorklog ?? false}`);
    console.log(
      `Video frames:  ${videoEnabled ? `enabled (fps=${fps}, maxFrames=${maxFrames})` : 'disabled'}`
    );
    console.log(`Issues (${keys.length}): ${keys.join(', ')}`);
    console.log(`Field preset:  ${fieldSelector?.preset ?? '(default)'}`);
    if (fieldSelector?.include?.length) console.log(`  include:     ${fieldSelector.include.join(', ')}`);
    if (fieldSelector?.exclude?.length) console.log(`  exclude:     ${fieldSelector.exclude.join(', ')}`);
    console.log(`Frontmatter fields: ${resolved.friendlyKeys.join(', ')}`);
    console.log(`Jira fields requested: ${resolved.jiraFieldIds.join(', ')}`);
    if (customFieldDefs && Object.keys(customFieldDefs).length > 0) {
      console.log(`Custom fields: ${Object.keys(customFieldDefs).join(', ')}`);
    }
    return;
  }

  const exporter = new JiraExporter(
    { baseUrl: baseUrl!, projectKey: projectKey!, userEmail: userEmail! },
    apiToken!
  );

  console.log(`Exporting ${keys.length} issue(s) to ${outputDir}...`);

  const result = await exporter.exportIssues(keys, {
    outputDir,
    includeSubtasks,
    fieldSelector,
    customFieldDefs,
    videoFrames: { enabled: videoEnabled, fps, maxFrames },
    withHistory: flags.withHistory,
    withWorklog: flags.withWorklog,
  });

  type Item = (typeof result.imported)[number];
  const printItem = (item: Item) => {
    console.log(`    - ${item.key}: ${item.path}`);
    if (item.attachmentCount > 0) {
      console.log(`        attachments: ${item.attachmentCount}`);
    }
  };

  console.log('\nExport summary:');
  if (result.imported.length > 0) {
    console.log(`  Imported (${result.imported.length}):`);
    for (const item of result.imported) printItem(item);
  }
  if (result.updated.length > 0) {
    console.log(`  Updated (${result.updated.length}):`);
    for (const item of result.updated) printItem(item);
  }
  if (result.failed.length > 0) {
    console.log(`  Failed (${result.failed.length}):`);
    for (const { key, error } of result.failed) console.log(`    - ${key}: ${error}`);
    process.exit(1);
  }
}

export function buildProgram(): Command {
const program = new Command();
program.enablePositionalOptions();

const pkg = createRequire(import.meta.url)('../../package.json') as {
  name: string;
  description: string;
  version: string;
};

program.name(pkg.name).description(pkg.description).version(pkg.version);

const notifier = updateNotifier({ pkg, updateCheckInterval: 1000 * 60 * 60 * 24 });
if (!process.argv.includes('--json')) {
  notifier.notify({
    defer: true,
    isGlobal: true,
    message: `Update available {currentVersion} → {latestVersion}\nRun \`${pkg.name} upgrade\` to update.`,
  });
}

function addExportOptions(cmd: Command): Command {
  return cmd
    .option('-o, --org <name>', 'Organization name from config (auto-resolved from issue prefix if unique)')
    .option('-P, --project <key>', 'Project key override')
    .option('--output-dir <path>', 'Output directory (default: ./jira-export)')
    .option('--base-url <url>', 'Jira base URL (overrides config)')
    .option('--user-email <email>', 'Jira user email (overrides config)')
    .option('--api-token <token>', 'Jira API token (overrides keychain)')
    .option('--no-video-frames', 'Disable video frame extraction')
    .option('--fps <n>', 'Frame extraction FPS')
    .option('--max-frames <n>', 'Max frames kept per video')
    .option('--include-subtasks', 'Fetch subtask metadata (may already be enabled via org config).')
    .option(
      '--fields <list>',
      'Comma-separated friendly field names to include in frontmatter. Use +name/-name to add/remove, or "all" | "default" | "minimal".'
    )
    .option('--with-history', 'Include full field-change history (not just status changes)')
    .option('--with-worklog', 'Include worklogs')
    .option('--dry-run', 'Resolve config & print plan without calling Jira or writing files');
}

addExportOptions(
  program.argument('[issue-keys...]', 'Jira issue keys, e.g. PROJ-123 or acme/PROJ-123')
)
  .action(async (keys: string[], flags: ExportFlags) => {
    await runExport(keys, flags, program);
  })
  .addHelpText(
    'after',
    `
Read-command output auto-switches to JSON when piped (stdout is not a TTY);
pass --json to force it explicitly.

Examples:
  $ jirallm init
  $ jirallm PROJ-123                       # auto-resolves org from PROJ prefix
  $ jirallm acme/PROJ-123                  # disambiguate when multiple orgs have PROJ
  $ jirallm --org acme PROJ-123            # or pass --org when multiple orgs have PROJ
  $ jirallm PROJ-123 PROJ-124 --output-dir ./context
  $ jirallm PROJ-123 --no-video-frames
  $ jirallm PROJ-123 --fps 2 --max-frames 6
  $ jirallm PROJ-123 --include-subtasks
  $ jirallm export PROJ-123
  $ jirallm fetch PROJ-123 --with-comments --with-history
  $ jirallm fetch PROJ-123 --full
  $ jirallm doctor --org acme
  $ jirallm setup
  $ jirallm orgs list

Run \`jirallm <command> --help\` for command-specific options.
`
  );

addExportOptions(program.command('export [issue-keys...]'))
  .description('Export issues as LLM-ready context bundles (same as the default command).')
  .action(async (keys: string[], flags: ExportFlags) => {
    await runExport(keys, flags, program);
  });

program
  .command('init')
  .description('Interactive setup wizard — creates an org or adds a project, and stores the API token in your OS keychain')
  .option('--org <name>', 'Organization name (non-interactive)')
  .option('--base-url <url>', 'Jira base URL (non-interactive)')
  .option('--email <email>', 'Jira user email (non-interactive)')
  .option('--project <key>', 'Project key (non-interactive)')
  .option('--token-stdin', 'Read the API token from stdin (non-interactive)')
  .option('-y, --yes', 'Skip confirmation prompts (non-interactive)')
  .action(
    async (opts: {
      org?: string;
      baseUrl?: string;
      email?: string;
      project?: string;
      tokenStdin?: boolean;
      yes?: boolean;
    }) => {
      await runInit(opts);
    }
  )
  .addHelpText(
    'after',
    `
A token stored in your OS keychain is preferred. As a fallback, the API token may be
supplied via the JIRALLM_API_TOKEN environment variable (or JIRALLM_API_TOKEN_<ORG>
for a specific org) when no keychain token is stored.

Examples:
  $ jirallm init
  $ jirallm init --org acme --base-url https://acme.atlassian.net --email me@acme.com --project PROJ --token-stdin --yes
`
  );

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
Tokens are stored in your OS keychain. As a fallback, an API token may be supplied via
the JIRALLM_API_TOKEN environment variable (or JIRALLM_API_TOKEN_<ORG> for a specific
org) when no keychain token is stored; \`auth status\`/\`auth list\` report which source is used.

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
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (opts: { json?: boolean }) => {
    await runOrgsList(opts);
  });
orgs
  .command('rm [org]')
  .description('Remove an organization (and its keychain token) along with all its projects')
  .option('-o, --org <name>', 'Organization name (alias for the positional)')
  .option('--dry-run', 'Show what would be removed without changing config')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (orgArg: string | undefined, opts: { org?: string; dryRun?: boolean; yes?: boolean }) => {
    const org = orgArg ?? opts.org;
    if (!org) throw new Error('Organization name is required (positional or --org).');
    await runOrgsRemove(org, { yes: opts.yes, dryRun: opts.dryRun });
  });
const orgProject = orgs.command('project').description('Manage projects within an organization');
orgProject
  .command('rm')
  .description('Remove a project from an organization')
  .option('-o, --org <name>', 'Organization name (auto-resolved from the project key if unique)')
  .option('-P, --project <key>', 'Project key')
  .addOption(new Option('-k, --key <key>', 'Project key (alias for --project)').hideHelp())
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (opts: { org?: string; project?: string; key?: string; yes?: boolean }) => {
    const projectKey = opts.project ?? opts.key;
    if (!projectKey) throw new Error('Project key is required (-P/--project).');
    await runProjectRemove(opts.org, projectKey, { yes: opts.yes });
  });
orgs.addHelpText(
  'after',
  `
Examples:
  $ jirallm orgs list
  $ jirallm orgs rm acme
  $ jirallm orgs rm --org acme --dry-run
  $ jirallm orgs project rm -P PROJ
  $ jirallm orgs project rm --org acme -P PROJ
`
);

program
  .command('doctor')
  .description('Check that everything jirallm needs is installed and reachable')
  .option('-o, --org <name>', 'Organization to use for the Jira reachability check')
  .option('-P, --project <key>', 'Project key to use for the Jira reachability check')
  .option('--strict', 'Exit non-zero on warnings as well as failures')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (opts: { org?: string; project?: string; strict?: boolean; json?: boolean }) => {
    await runDoctor({ org: opts.org, project: opts.project, strict: opts.strict, json: opts.json });
  })
  .addHelpText('after', '\nExamples:\n  $ jirallm doctor --org acme\n  $ jirallm doctor --org acme --strict --json\n');

program
  .command('setup')
  .description('Install missing system dependencies (currently: ffmpeg) with cascading consent')
  .option('--bundled', 'Install ffmpeg-static globally instead of system ffmpeg')
  .option('-y, --yes', 'Auto-confirm package-manager install (does NOT auto-confirm Homebrew install)')
  .option('--allow-brew', 'Also auto-confirm the Homebrew install step')
  .option('--dry-run', 'Show what would be installed without running any installer')
  .action(async (opts: { bundled?: boolean; yes?: boolean; allowBrew?: boolean; dryRun?: boolean }) => {
    await runSetup({ bundled: opts.bundled, yes: opts.yes, allowBrew: opts.allowBrew, dryRun: opts.dryRun });
  })
  .addHelpText(
    'after',
    `
Examples:
  $ jirallm setup
  $ jirallm setup --yes
  $ jirallm setup --bundled
  $ jirallm setup --yes --allow-brew
  $ jirallm setup --dry-run
`
  );

program
  .command('upgrade')
  .description('Upgrade jirallm to the latest version (auto-detects npm/pnpm/yarn/Homebrew)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--check', 'Print whether an update is available without installing (exits non-zero if outdated)')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (opts: { yes?: boolean; check?: boolean; json?: boolean }) => {
    try {
      await runUpgrade(opts);
    } catch (err) {
      exitOnError(err);
    }
  })
  .addHelpText(
    'after',
    `
Examples:
  $ jirallm upgrade
  $ jirallm upgrade --yes
  $ jirallm upgrade --check
`
  );

addImageOptions(
  program
  .command('comment <issue-key>')
  .description('Post a (possibly multi-part) comment on a Jira issue. Markdown converted to Jira wiki by default.')
  .option('-f, --file <path>', 'Read comment body from a file')
  .option('-t, --text <text>', 'Inline comment text (alternative to --file / stdin)')
  .option('-o, --org <name>', 'Organization name override')
  .option('--max-chars <n>', 'Max chars per comment chunk (default 25000)')
  .option('--no-wiki', 'Skip markdown→wiki conversion (post body as-is)')
  .option('--reply-to <commentId>', 'Post as reply to an existing comment (threaded)')
  .option('--no-thread', 'When posting multiple chunks, do not chain them as replies')
  .option(
    '--attach <files...>',
    'Upload files and embed them at the end of the comment (images as thumbnails — use --attach-images for full-size images)'
  )
  .option('--dry-run', 'Show what would be posted without calling Jira')
  .option('--json', 'Output JSON instead of human-readable')
)
  .action(
    async (
      issueKey: string,
      opts: {
        file?: string;
        text?: string;
        org?: string;
        maxChars?: string;
        wiki?: boolean;
        thread?: boolean;
        replyTo?: string;
        attach?: string[];
        attachImages?: string[]; attachMedia?: string[];
        imageLayout?: string;
        imageWidth?: string;
        dryRun?: boolean;
        json?: boolean;
      }
    ) => {
      try {
        await runComment(issueKey, {
          file: opts.file,
          text: opts.text,
          org: opts.org,
          maxChars: opts.maxChars,
          noWiki: opts.wiki === false,
          noThread: opts.thread === false,
          replyTo: opts.replyTo,
          attach: opts.attach,
          attachImages: opts.attachImages,
          attachMedia: opts.attachMedia,
          imageLayout: opts.imageLayout,
          imageWidth: opts.imageWidth,
          dryRun: opts.dryRun,
          json: opts.json,
        });
      } catch (err) {
        exitOnError(err);
      }
    }
  )
  .addHelpText(
    'after',
    `
Examples:
  $ jirallm comment PROJ-123 --file ./summary.md
  $ jirallm comment PROJ-123 -t "Quick note"
  $ cat summary.md | jirallm comment PROJ-123
  $ jirallm comment PROJ-123 --file ./summary.md --dry-run
  $ jirallm comment PROJ-123 --reply-to 10001 -t "follow-up"
  $ jirallm comment PROJ-123 --file ./summary.md --attach shot.png verification.md
  $ jirallm comment PROJ-123 --file ./summary.md --attach-images shot.png:"New config field"
  $ jirallm comment PROJ-123 -t "see below" --attach-images a.png b.png --image-layout center --image-width 80
  $ jirallm comment PROJ-123 --file ./repro.md --attach-media demo.webm:"Repro" trace.har
  # place media where you want it: put @@media:demo.webm@@ on its own line in the body
`
  );

program
  .command('board:issues')
  .description('List issues in a board column. Output JSON with --json for piping into other tools.')
  .requiredOption('-b, --board <name>', 'Board name (case-insensitive match)')
  .option('-c, --column <name>', 'Column name (case-insensitive match); lists all columns when omitted')
  .requiredOption('-o, --org <name>', 'Organization name from config')
  .option('-P, --project <key>', 'Project key override (auto-selected when the org has a single project)')
  .option('-a, --assignee <accountIdOrMe>', 'Filter by assignee. Use "me" for the current user.')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (opts: { board: string; column?: string; org: string; project?: string; assignee?: string; json?: boolean }) => {
    try {
      await runBoardIssues(opts);
    } catch (err) {
      exitOnError(err);
    }
  })
  .addHelpText(
    'after',
    `
Examples:
  $ jirallm board:issues -o MyOrg -b "My Board" -c "In Review" -a me --json
  $ jirallm board:issues -o MyOrg -b "My Board" -c "Done"
`
  );

program
  .command('transition <issue-key>')
  .description('Transition a Jira issue to a target status (case-insensitive match on transition to.name, then name).')
  .option('-t, --to <status>', 'Target status name (e.g. "In Review")')
  .option('-o, --org <name>', 'Organization name override')
  .option('-l, --list', 'List available transitions (matched case-insensitively by to.name then name) instead of performing one')
  .option('--dry-run', 'Resolve the transition and print it without calling Jira')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (issueKey: string, opts: { to?: string; org?: string; list?: boolean; dryRun?: boolean; json?: boolean }) => {
    try {
      if (!opts.list && !opts.to) {
        throw new Error('Either --to <status> or --list is required.');
      }
      await runTransition(issueKey, { to: opts.to ?? '', org: opts.org, list: opts.list, dryRun: opts.dryRun, json: opts.json });
    } catch (err) {
      exitOnError(err);
    }
  })
  .addHelpText(
    'after',
    `
Examples:
  $ jirallm transition PROJ-123 --to "In Review"
  $ jirallm transition PROJ-123 --to "In Review" --dry-run
  $ jirallm transition PROJ-123 --list
`
  );

program
  .command('worklog [issue-key] [duration]')
  .description('Log work to Jira. Quick form: `worklog PROJ-123 "1h 30m"`. Batch form: JSON array on stdin or --file.')
  .option('-f, --file <path>', 'Read JSON array from a file (default: stdin)')
  .option('-o, --org <name>', 'Default org for entries without an org/ prefix or "org" field')
  .option('--no-wiki', 'Skip markdown→wiki conversion of description')
  .option('--dry-run', 'Validate and print what would be posted, without calling Jira')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (issueKey: string | undefined, duration: string | undefined, opts: { file?: string; org?: string; wiki?: boolean; dryRun?: boolean; json?: boolean }) => {
    try {
      await runWorklog({
        issueKey,
        duration,
        file: opts.file,
        org: opts.org,
        noWiki: opts.wiki === false,
        dryRun: opts.dryRun,
        json: opts.json,
      });
    } catch (err) {
      exitOnError(err);
    }
  })
  .addHelpText(
    'after',
    `
Quick single-entry form logs against "now": \`jirallm worklog PROJ-123 "1h 30m"\`.
For the batch form, pass a JSON array on stdin or via --file.

JSON entry shape (a duration alone is accepted — startTime defaults to now; or supply any 2 of startTime/endTime/duration):
  {
    "issueKey": "PROJ-123",         // required; supports "org/PROJ-123"
    "startTime": "2026-05-23T09:00:00+02:00",
    "endTime":   "2026-05-23T10:30:00+02:00",
    "duration":  "1h 30m",           // seconds | "1h 30m" | "PT1H30M"
    "description": "**markdown** ok",
    "org": "acme",                   // optional per-entry override
    "visibility": { "type": "role", "value": "Developers" }
  }

Examples:
  $ jirallm worklog -f ./worklogs.json
  $ cat worklogs.json | jirallm worklog --dry-run
  $ echo '[{"issueKey":"PROJ-1","startTime":"2026-05-23T09:00:00+02:00","duration":"1h"}]' | jirallm worklog
`
  );

program
  .command('comment:rm <issue-key> <comment-id>')
  .description('Delete a comment from a Jira issue')
  .option('-o, --org <name>', 'Organization name override')
  .option('--dry-run', 'Show what would be deleted without calling Jira')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (issueKey: string, commentId: string, opts: { org?: string; dryRun?: boolean; yes?: boolean }) => {
    try {
      await runDeleteComment(issueKey, commentId, { org: opts.org, dryRun: opts.dryRun, yes: opts.yes });
    } catch (err) {
      exitOnError(err);
    }
  })
  .addHelpText(
    'after',
    `
Examples:
  $ jirallm comment:rm PROJ-123 26215
  $ jirallm comment:rm acme/PROJ-123 26215 --dry-run
  $ jirallm comment:rm PROJ-123 26215 --yes
`
  );

program
  .command('comment:ls <issue-key>')
  .description('List comments on a Jira issue.')
  .option('-o, --org <name>', 'Organization name override')
  .option('--json', 'Output JSON instead of human-readable')
  .option('--rendered', 'Include renderedBody (Jira-rendered HTML) per comment; implies JSON')
  .action(async (issueKey: string, opts: { org?: string; json?: boolean; rendered?: boolean }) => {
    try {
      await runCommentList(issueKey, { org: opts.org, json: opts.json, rendered: opts.rendered });
    } catch (err) {
      exitOnError(err);
    }
  })
  .addHelpText(
    'after',
    `
--rendered includes each comment's Jira-rendered HTML (renderedBody), so you can
confirm a wiki-markup comment rendered correctly. It implies JSON output.

Examples:
  $ jirallm comment:ls PROJ-123
  $ jirallm comment:ls acme/PROJ-123 --json
  $ jirallm comment:ls PROJ-123 --rendered | jq -r '.comments[].renderedBody'
`
  );

addImageOptions(
  program
  .command('comment:edit <issue-key> <comment-id>')
  .description('Edit an existing comment (replaces its body).')
  .option('-o, --org <name>', 'Organization name override')
  .option('-f, --file <path>', 'Read the new comment body (markdown) from a file')
  .option('-t, --text <text>', 'New comment body (markdown) as a string')
  .option('--no-wiki', 'Send the body as-is (skip markdown → wiki conversion)')
  .option(
    '--attach <files...>',
    'Upload files and embed them at the end of the comment (images as thumbnails — use --attach-images for full-size images)'
  )
  .option('--dry-run', 'Show the new body without calling Jira')
  .option('--json', 'Output JSON instead of human-readable')
)
  .action(
    async (
      issueKey: string,
      commentId: string,
      opts: {
        org?: string;
        file?: string;
        text?: string;
        wiki?: boolean;
        attach?: string[];
        attachImages?: string[]; attachMedia?: string[];
        imageLayout?: string;
        imageWidth?: string;
        dryRun?: boolean;
        json?: boolean;
      }
    ) => {
      try {
        await runEditComment(issueKey, commentId, {
          org: opts.org,
          file: opts.file,
          text: opts.text,
          noWiki: opts.wiki === false,
          attach: opts.attach,
          attachImages: opts.attachImages,
          attachMedia: opts.attachMedia,
          imageLayout: opts.imageLayout,
          imageWidth: opts.imageWidth,
          dryRun: opts.dryRun,
          json: opts.json,
        });
      } catch (err) {
        exitOnError(err);
      }
    }
  )
  .addHelpText(
    'after',
    `
The new body is read from --file, then --text, then stdin (in that order).
Markdown is converted to Jira wiki markup unless --no-wiki is passed.
--attach uploads new files and appends embeds to the body (existing attachments are kept).

Examples:
  $ jirallm comment:edit PROJ-123 26215 --text "Updated note"
  $ jirallm comment:edit PROJ-123 26215 --file ./fixed.md
  $ jirallm comment:edit PROJ-123 26215 --file ./qa.md --attach after-proof.png
  $ jirallm comment:edit PROJ-123 26215 --file ./qa.md --attach-images after.png:"After the fix"
  $ echo "new body" | jirallm comment:edit acme/PROJ-123 26215
  $ jirallm comment:edit PROJ-123 26215 --text "wip" --dry-run --json
`
  );

function jsonModeRequested(): boolean {
  return process.argv.includes('--json');
}

function reportError(err: unknown): void {
  const message = (err as Error).message ?? String(err);
  if (jsonModeRequested()) {
    console.error(JSON.stringify({ error: message }));
    return;
  }
  console.error(message);
}

function exitOnError(err: unknown): never {
  reportError(err);
  process.exit(1);
}

/** Commander collector for repeatable options (e.g. --field a=1 --field b=2). */
function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** Shared --attach-images / --attach-media / --image-* options (ADF media embedding). */
function addImageOptions(cmd: Command): Command {
  return cmd
    .option(
      '--attach-images <spec...>',
      'Upload media and embed it inline (images/videos sized as ADF mediaSingle, other files as compact tiles). Format: file.png or file.png:"caption"'
    )
    .option(
      '--attach-media <spec...>',
      'Alias for --attach-images; both accept images, videos and any other file'
    )
    .option(
      '--image-layout <layout>',
      `Layout for sized media: ${IMAGE_LAYOUTS.join('|')} (default: ${DEFAULT_IMAGE_LAYOUT})`
    )
    .option(
      '--image-width <n>',
      `Percent of container width for sized media, 1-100 (default: ${DEFAULT_IMAGE_WIDTH})`
    );
}

program
  .command('search <jql>')
  .description('Search issues by JQL (single page; pass --cursor for next page).')
  .option('-o, --org <name>', 'Organization name')
  .option('--limit <n>', 'Page size (default 50)')
  .option('--cursor <token>', 'Next page token from prior search')
  .option('--next-page-token <token>', 'Alias for --cursor')
  .option('--fields <list>', 'Comma-separated Jira field IDs to include')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (jql: string, opts: { org?: string; limit?: string; cursor?: string; nextPageToken?: string; fields?: string; json?: boolean }) => {
    try {
      const { nextPageToken, ...rest } = opts;
      await runSearch({ jql, ...rest, cursor: opts.cursor ?? nextPageToken });
    } catch (err) { exitOnError(err); }
  })
  .addHelpText(
    'after',
    `
JQL must be quoted in your shell (it usually contains spaces and shell metacharacters).
Output JSON includes "nextPageToken" — pass it back via --cursor for the next page.

Examples:
  $ jirallm search 'assignee = currentUser() AND statusCategory != Done' -o acme --json
  $ jirallm search 'project = PROJ AND sprint in openSprints()' -o acme --limit 25
  $ jirallm search 'project = PROJ' -o acme --cursor eyJsYXN0SXNzdWVLZXkiOi4uLn0= --json
  $ jirallm search 'project = PROJ' -o acme --fields summary,status,assignee --json
`
  );

program
  .command('projects')
  .description('List projects accessible in an org.')
  .requiredOption('-o, --org <name>', 'Organization name')
  .option('--query <text>', 'Filter by name/key substring')
  .option('--limit <n>', 'Page size')
  .option('--start-at <n>', 'Pagination offset')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (opts: { org: string; query?: string; limit?: string; startAt?: string; json?: boolean }) => {
    try { await runProjects(opts); } catch (err) { exitOnError(err); }
  })
  .addHelpText(
    'after',
    `
Examples:
  $ jirallm projects -o acme
  $ jirallm projects -o acme --query docs --json
  $ jirallm projects -o acme --limit 50 --start-at 100 --json
`
  );

program
  .command('boards')
  .description('List agile boards in an org.')
  .option('-o, --org <name>', 'Organization name (auto-resolved from the -P project key when it maps to a unique org)')
  .option('-P, --project <key>', 'Filter by project key')
  .option('-t, --type <type>', 'scrum | kanban | simple')
  .option('-n, --name <name>', 'Name substring filter')
  .option('--limit <n>', 'Page size')
  .option('--start-at <n>', 'Pagination offset')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (opts: { org?: string; project?: string; type?: 'scrum' | 'kanban' | 'simple'; name?: string; limit?: string; startAt?: string; json?: boolean }) => {
    try { await runBoards(opts); } catch (err) { exitOnError(err); }
  })
  .addHelpText(
    'after',
    `
When --project is omitted and the org has a single project, that project is used automatically.
The board id printed here is what you pass to \`jirallm sprints <id>\`.

Examples:
  $ jirallm boards -o acme
  $ jirallm boards -o acme -P PROJ -t scrum --json
  $ jirallm boards -o acme -n "Team Alpha" --json
`
  );

program
  .command('sprints <board-id>')
  .description('List sprints on a board.')
  .requiredOption('-o, --org <name>', 'Organization name')
  .option('-s, --state <state>', 'active | future | closed')
  .option('--limit <n>', 'Page size')
  .option('--start-at <n>', 'Pagination offset')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (boardId: string, opts: { org: string; state?: 'active' | 'future' | 'closed'; limit?: string; startAt?: string; json?: boolean }) => {
    try { await runSprints({ boardId, ...opts }); } catch (err) { exitOnError(err); }
  })
  .addHelpText(
    'after',
    `
Get board ids from \`jirallm boards --org <name>\`.

Examples:
  $ jirallm sprints 42 -o acme --state active --json
  $ jirallm sprints 42 -o acme --state closed --limit 20
`
  );

program
  .command('issuetypes')
  .description('List issue types (project-scoped if --project provided).')
  .option('-o, --org <name>', 'Organization name (auto-resolved from the -P project key when it maps to a unique org)')
  .option('-P, --project <key>', 'Project key (auto-selected when the org has a single project)')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (opts: { org?: string; project?: string; json?: boolean }) => {
    try { await runIssueTypes(opts); } catch (err) { exitOnError(err); }
  })
  .addHelpText(
    'after',
    `
Use this before \`jirallm create\` to discover the valid --type values for a project.

Examples:
  $ jirallm issuetypes -o acme --json
  $ jirallm issuetypes -o acme -P PROJ --json
`
  );

program
  .command('components')
  .description('List components defined on a project.')
  .option('-o, --org <name>', 'Organization name (auto-resolved from the project key if unique)')
  .option('-P, --project <key>', 'Project key (auto-selected when the org has a single project)')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (opts: { org?: string; project?: string; json?: boolean }) => {
    try { await runComponents(opts); } catch (err) { exitOnError(err); }
  })
  .addHelpText(
    'after',
    `
The "name" values are what \`jirallm create/edit --components\` expects.

Examples:
  $ jirallm components -o acme -P PROJ
  $ jirallm components -o acme -P PROJ --json
`
  );

program
  .command('fields')
  .description('List custom fields (and select options with --type) for use with --field.')
  .option('-o, --org <name>', 'Organization name (auto-resolved from the -P project key when it maps to a unique org)')
  .option('-P, --project <key>', 'Project key (auto-selected when the org has a single project)')
  .option('-t, --type <issueType>', 'Show create-screen fields + allowed values for this issue type')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (opts: { org?: string; project?: string; type?: string; json?: boolean }) => {
    try { await runFields(opts); } catch (err) { exitOnError(err); }
  })
  .addHelpText(
    'after',
    `
The [customfield_NNNNN] ids are what \`jirallm create/edit --field\` expects.
Add --type Bug to see valid select options (e.g. for Severity, Environment).

Examples:
  $ jirallm fields -o acme -P PROJ
  $ jirallm fields -o acme -P PROJ --type Bug
  $ jirallm fields -o acme -P PROJ --type Bug --json
`
  );

program
  .command('linktypes')
  .description('List issue link types available in an org.')
  .requiredOption('-o, --org <name>', 'Organization name')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (opts: { org: string; json?: boolean }) => {
    try { await runLinkTypes(opts); } catch (err) { exitOnError(err); }
  })
  .addHelpText(
    'after',
    `
The "name" column is what \`jirallm link\` expects as <type> (e.g. "Blocks", "Relates").

Examples:
  $ jirallm linktypes -o acme
  $ jirallm linktypes -o acme --json
`
  );

program
  .command('me')
  .description('Show the currently authenticated Jira user.')
  .requiredOption('-o, --org <name>', 'Organization name')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (opts: { org: string; json?: boolean }) => {
    try { await runMe(opts); } catch (err) { exitOnError(err); }
  })
  .addHelpText(
    'after',
    `
Returns the accountId — use it as --assignee for \`create\` / \`edit\` / \`assign\`,
or pass "me" as a shorthand in commands that resolve it (\`assign\`, \`watchers\`).

Examples:
  $ jirallm me -o acme
  $ jirallm me -o acme --json | jq -r .accountId
`
  );

program
  .command('users <query>')
  .alias('user')
  .description('Look up Jira users by email, display name or accountId prefix.')
  .option('-o, --org <name>', 'Organization name')
  .option('-P, --project <key>', 'Restrict to users assignable in a project')
  .option('--issue <issue-key>', 'Restrict to users assignable on an issue')
  .option('--limit <n>', 'Maximum results (default 50)')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (query: string, opts: { org?: string; project?: string; issue?: string; limit?: string; json?: boolean }) => {
    try { await runUsers({ query, ...opts }); } catch (err) { exitOnError(err); }
  })
  .addHelpText(
    'after',
    `
Output is an array of users — use the accountId as --assignee for \`create\` / \`edit\` /
\`assign\`, as \`watchers --add\`, or to build an [~accountId:...] mention in a comment.
Pass "me" as the query to get the authenticated user (same as \`jirallm me\`).

Examples:
  $ jirallm users someone@example.com -o acme
  $ jirallm users someone@example.com -o acme --json | jq -r '.[0].accountId'
  $ jirallm users "Jane Doe" -o acme --json
  $ jirallm users Jane --issue PROJ-123        # only users assignable on that issue
  $ jirallm users Jane -o acme -P PROJ --limit 10
`
  );

program
  .command('fetch <issue-key>')
  .description('Fetch a single issue as JSON or pretty text (no file output).')
  .option('-o, --org <name>', 'Organization name override')
  .option('--json', 'Output JSON instead of human-readable')
  .option('--with-comments', 'Include comments')
  .option('--with-history', 'Include status + field-change history')
  .option('--with-worklog', 'Include worklogs')
  .option('--with-subtasks', 'Include subtask metadata')
  .option('--with-links', 'Include issue links')
  .option('--with-attachments', 'List attachment metadata (does not download)')
  .option('--full', 'Include everything (comments, history, worklog, subtasks, links, attachments)')
  .option(
    '--fields <list>',
    'Field set to include: preset (all|default|minimal), +add/-drop, or a bare comma list'
  )
  .option('--raw', 'Output the complete, untransformed Jira field object (all fields; implies JSON)')
  .option('--rendered', 'Include renderedFields (Jira-rendered HTML for description and other fields; implies raw JSON)')
  .option('--expand <list>', 'Comma-separated Jira expand params to pass through on the raw object (implies raw JSON)')
  .action(async (issueKey: string, opts: Omit<import('./commands/fetch.js').FetchOptions, 'issueKey'>) => {
    try { await runFetch({ issueKey, ...opts }); } catch (err) { exitOnError(err); }
  })
  .addHelpText(
    'after',
    `
For the full export bundle (attachments, video frames, on-disk folder),
use the default \`jirallm <key>\` command instead.

By default \`fetch\` returns the "default" field preset (components, labels,
priority, assignee, ...) plus any custom fields configured for the org. Use
--fields to widen or narrow the set, or --raw to dump the untouched Jira
field object (every field, including unconfigured custom fields) — handy for
verifying what actually landed after a create/edit.

--rendered adds a renderedFields object (Jira-rendered HTML) alongside the raw
fields, so you can confirm a wiki-markup body rendered correctly. --expand lets
you pass arbitrary Jira expand params through on the raw object. Both imply raw
JSON output.

Examples:
  $ jirallm fetch PROJ-123 --json
  $ jirallm fetch acme/PROJ-123
  $ jirallm fetch PROJ-123 --with-comments --with-history
  $ jirallm fetch PROJ-123 --full
  $ jirallm fetch PROJ-123 --fields all --json
  $ jirallm fetch PROJ-123 --raw | jq '.fields.labels'
  $ jirallm fetch PROJ-123 --rendered | jq -r '.renderedFields.description'
  $ jirallm fetch PROJ-123 --expand changelog,renderedFields
  $ jirallm fetch PROJ-123 --json | jq .status
`
  );

addImageOptions(
  program
  .command('create')
  .description('Create a new Jira issue.')
  .option(
    '--attach <files...>',
    'Upload files and embed them at the end of the description (images as thumbnails)'
  )
  .option('-o, --org <name>', 'Organization name (auto-resolved from the project key if unique)')
  .option('-P, --project <key>', 'Project key (auto-selected when the org has a single project)')
  .requiredOption('-t, --type <type>', 'Issue type name (e.g. Task, Bug, Story)')
  .requiredOption('-s, --summary <text>', 'Issue summary')
  .option('-d, --description <text>', 'Description (markdown)')
  .option('--description-file <path>', 'Read description (markdown) from a file')
  .option('--no-wiki', 'Send the description as-is (skip markdown → wiki conversion)')
  .option('-a, --assignee <user>', 'Assignee: an accountId, email, display name, or "me"')
  .option('-l, --labels <list>', 'Comma-separated labels')
  .option('--priority <name>', 'Priority name (e.g. High)')
  .option('--parent <key>', 'Parent issue key (for subtasks / epic children)')
  .option('--components <name>', 'Component name (repeatable; pass once per component)', collect)
  .option(
    '-F, --field <pair>',
    'Set a custom field: friendlyName=value or customfield_NNNNN[:type]=value (repeatable). Use name= or name=null to clear.',
    collect
  )
  .option('--sprint <id>', 'Sprint field: a sprint id, "active" (board\'s active sprint), or "none" to clear')
  .option('--board <name>', 'Board name to disambiguate --sprint active (when the project has several scrum boards)')
  .option('--dry-run', 'Show what would be created without calling Jira')
  .option('--json', 'Output JSON instead of human-readable')
)
  .action(async (opts: { org?: string; project?: string; type: string; summary: string; description?: string; descriptionFile?: string; wiki?: boolean; assignee?: string; labels?: string; priority?: string; parent?: string; components?: string[]; field?: string[]; sprint?: string; board?: string; attach?: string[]; attachImages?: string[]; attachMedia?: string[]; imageLayout?: string; imageWidth?: string; dryRun?: boolean; json?: boolean }) => {
    try {
      await runCreate({
        org: opts.org,
        projectKey: opts.project,
        type: opts.type,
        summary: opts.summary,
        description: opts.description,
        descriptionFile: opts.descriptionFile,
        noWiki: opts.wiki === false,
        assignee: opts.assignee,
        labels: opts.labels,
        priority: opts.priority,
        parent: opts.parent,
        components: opts.components,
        field: opts.field,
        sprint: opts.sprint,
        board: opts.board,
        attach: opts.attach,
        attachImages: opts.attachImages,
        attachMedia: opts.attachMedia,
        imageLayout: opts.imageLayout,
        imageWidth: opts.imageWidth,
        dryRun: opts.dryRun,
        json: opts.json,
      });
    } catch (err) { exitOnError(err); }
  })
  .addHelpText(
    'after',
    `
Run \`jirallm issuetypes -o <org>\` to discover valid --type values.
Run \`jirallm components -o <org> -P <project>\` to discover valid --components names.
Run \`jirallm fields -o <org> -P <project> --type Bug\` to discover custom field ids and select options.
Get a user's accountId via \`jirallm me -o <org>\` (for the current user).
--description is markdown; it gets converted to Jira wiki on the way in (pass --no-wiki to send it as-is).

Custom fields:
  Friendly names defined under [orgs.<org>.export.custom_fields] resolve automatically
  (e.g. --field severity=High shapes to the right payload from the configured type).
  For ad-hoc fields use the raw id with an optional type: --field customfield_10050:select=High.

Examples:
  $ jirallm create -o acme -t Task -s "Investigate flaky test"
  $ jirallm create -o acme -P PROJ -t Bug -s "Crash on save" --description-file ./repro.md
  $ jirallm create -o acme -t Task -s "Templated" --description-file ./wiki.txt --no-wiki   # send wiki markup as-is
  $ jirallm create -o acme -t Story -s "Spike X" -l backend,p1 --priority High
  $ jirallm create -o acme -t Sub-task -s "Subtask of PROJ-1" --parent PROJ-1
  $ jirallm create -o acme -t Bug -s "Crash" --components Web --components API --field severity=High --field environment=PROD
  $ jirallm create -o acme -t Bug -s "Crash" --components "Frontend, Web & API"   # a single name containing a comma
  $ jirallm create -o acme -t Story -s "Spike X" --sprint 42          # add to a sprint by id
  $ jirallm create -o acme -t Story -s "Spike X" --sprint active      # add to the board's active sprint
  $ jirallm create -o acme -t Bug -s "test" --dry-run --json
  $ jirallm create -o acme -t Bug -s "Crash" --description-file ./repro.md --attach-images repro.png:"Stack trace"
`
  );

addImageOptions(
  program
  .command('edit <issue-key>')
  .description('Edit fields on an existing Jira issue.')
  .option('-o, --org <name>', 'Organization name override')
  .option(
    '--attach <files...>',
    'Upload files and embed them at the end of the new description (images as thumbnails)'
  )
  .option('-s, --summary <text>', 'New summary')
  .option('-d, --description <text>', 'New description (markdown)')
  .option('--description-file <path>', 'Read description (markdown) from a file')
  .option('--no-wiki', 'Send the description as-is (skip markdown → wiki conversion)')
  .option('-a, --assignee <user>', 'Assignee: an accountId, email, display name, or "me"')
  .option('--unassign', 'Unassign the issue (clears assignee)')
  .option('-l, --labels <list>', 'Comma-separated labels (replaces existing)')
  .option('--priority <name>', 'Priority name')
  .option('--parent <key>', 'Parent issue key (reparent / set epic)')
  .option('--due <date>', 'Due date (YYYY-MM-DD)')
  .option('--components <name>', 'Component name (repeatable; replaces existing set)', collect)
  .option(
    '-F, --field <pair>',
    'Set a custom field: friendlyName=value or customfield_NNNNN[:type]=value (repeatable). Use name= or name=null to clear.',
    collect
  )
  .option('--sprint <id>', 'Sprint field: a sprint id, "active" (board\'s active sprint), or "none" to clear')
  .option('--board <name>', 'Board name to disambiguate --sprint active (when the project has several scrum boards)')
  .option('--dry-run', 'Show what would change without calling Jira')
  .option('--json', 'Output JSON instead of human-readable')
)
  .action(async (issueKey: string, opts: { org?: string; summary?: string; description?: string; descriptionFile?: string; wiki?: boolean; assignee?: string; unassign?: boolean; labels?: string; priority?: string; parent?: string; due?: string; components?: string[]; field?: string[]; sprint?: string; board?: string; attach?: string[]; attachImages?: string[]; attachMedia?: string[]; imageLayout?: string; imageWidth?: string; dryRun?: boolean; json?: boolean }) => {
    try {
      const { wiki, ...rest } = opts;
      await runEdit({ issueKey, ...rest, noWiki: wiki === false });
    } catch (err) { exitOnError(err); }
  })
  .addHelpText(
    'after',
    `
--labels and --components REPLACE the existing sets; there is no add/remove syntax here.
--unassign and --assignee are mutually exclusive (use one).
Custom fields work like \`create\`: --field friendlyName=value or --field customfield_NNNNN[:type]=value.
Clear any nullable field with an empty or null value: --field reproductionRate= or --field reproductionRate=null.

Examples:
  $ jirallm edit PROJ-123 --summary "New title"
  $ jirallm edit PROJ-123 --description-file ./updated.md
  $ jirallm edit PROJ-123 --description-file ./wiki.txt --no-wiki   # send wiki markup as-is
  $ jirallm edit PROJ-123 --labels backend,p1 --priority High
  $ jirallm edit PROJ-123 --parent PROJ-1 --due 2026-08-01
  $ jirallm edit PROJ-123 --components Web --components API --field reproductionRate=Always
  $ jirallm edit PROJ-123 --sprint 42            # move into sprint 42
  $ jirallm edit PROJ-123 --sprint active        # move into the board's active sprint
  $ jirallm edit PROJ-123 --sprint none          # remove from its sprint
  $ jirallm edit PROJ-123 --field customfield_10020=   # clear any field (e.g. sprint) directly
  $ jirallm edit PROJ-123 --assignee 5ac1234567890abcdef
  $ jirallm edit PROJ-123 --unassign --dry-run --json
  $ jirallm edit PROJ-123 --description-file ./updated.md --attach-images after.png:"After the fix"

--attach / --attach-images only rewrite the description when --description/--description-file
is also given; otherwise the files are uploaded and the description is left alone.
`
  );

program
  .command('assign <issue-key> <assignee>')
  .description('Assign an issue. Use "me" for the current user, "none" to unassign.')
  .option('-o, --org <name>', 'Organization name override')
  .option('--dry-run', 'Show what would change without calling Jira')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (issueKey: string, assignee: string, opts: { org?: string; dryRun?: boolean; json?: boolean }) => {
    try { await runAssign({ issueKey, assignee, ...opts }); } catch (err) { exitOnError(err); }
  })
  .addHelpText(
    'after',
    `
<assignee> shortcuts: "me" (current user) or "none"/"-" (unassign).
Any other value is resolved as an email, display name, or accountId.

Examples:
  $ jirallm assign PROJ-123 me
  $ jirallm assign PROJ-123 none
  $ jirallm assign PROJ-123 5ac1234567890abcdef
  $ jirallm assign PROJ-123 me --dry-run --json
`
  );

program
  .command('link <inward-key> <type> <outward-key>')
  .description('Create an issue link (e.g. `link FOO-1 "blocks" FOO-2`).')
  .option('-c, --comment <text>', 'Add a comment when linking')
  .option('-o, --org <name>', 'Organization name override')
  .option('--dry-run', 'Show what would be created without calling Jira')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (inwardKey: string, type: string, outwardKey: string, opts: { comment?: string; org?: string; dryRun?: boolean; json?: boolean }) => {
    try { await runLink({ inwardKey, type, outwardKey, ...opts }); } catch (err) { exitOnError(err); }
  })
  .addHelpText(
    'after',
    `
<type> is the link-type NAME (e.g. "Blocks", "Relates", "Duplicate"), not the inward/outward label.
Discover the available types with: \`jirallm linktypes -o <org>\`.
--comment is markdown; it gets converted to Jira wiki.

Examples:
  $ jirallm link PROJ-1 "Blocks" PROJ-2
  $ jirallm link PROJ-1 "Relates" PROJ-2 --comment "see also **infra rewrite**"
  $ jirallm link PROJ-1 "Blocks" PROJ-2 --dry-run --json
`
  );

program
  .command('link:rm [issue-key] [link-id]')
  .description('Remove an issue link by ID, or by issue key + --to target.')
  .option('-o, --org <name>', 'Organization name (auto-resolved from the issue/project key if unique)')
  .option('--to <key>', 'Remove the link between <issue-key> and this issue key')
  .option('--dry-run', 'Show what would be deleted without calling Jira')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (issueKey: string | undefined, linkId: string | undefined, opts: { org?: string; to?: string; dryRun?: boolean; json?: boolean }) => {
    try {
      const target = issueKey ?? linkId;
      if (!target) throw new Error('Provide a link id, or an issue key with --to.');
      await runLinkRemove({ linkId: target, to: opts.to, org: opts.org, dryRun: opts.dryRun, json: opts.json });
    } catch (err) { exitOnError(err); }
  })
  .addHelpText(
    'after',
    `
Get link IDs from the issueLinks array in \`jirallm fetch <key> --json\`.
Alternatively, drop the link between two issues with --to.

Examples:
  $ jirallm link:rm 10042 -o acme
  $ jirallm link:rm 10042 -o acme --dry-run --json
  $ jirallm link:rm PROJ-1 --to PROJ-2
`
  );

program
  .command('attach <issue-key> [files...]')
  .description('Upload one or more file attachments to an issue. At least one file is required.')
  .option('-o, --org <name>', 'Organization name override')
  .option('--dry-run', 'Show what would be uploaded without calling Jira')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (issueKey: string, files: string[], opts: { org?: string; dryRun?: boolean; json?: boolean }) => {
    try {
      if (!files || files.length === 0) throw new Error('At least one file is required.');
      await runAttach({ issueKey, files, ...opts });
    } catch (err) { exitOnError(err); }
  })
  .addHelpText(
    'after',
    `
Files are uploaded sequentially; --json returns the aggregated attachments array.
The id from the response is what \`jirallm attach:rm\` takes.

Examples:
  $ jirallm attach PROJ-123 ./screenshot.png
  $ jirallm attach PROJ-123 ./a.png ./b.png ./recording.mp4 --json
  $ jirallm attach PROJ-123 ./screenshot.png --dry-run
`
  );

program
  .command('attach:rm [target] [filename]')
  .description('Delete an attachment by ID, or by issue key + filename.')
  .option('-o, --org <name>', 'Organization name (auto-resolved from the issue/project key if unique)')
  .option('--dry-run', 'Show what would be deleted without calling Jira')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (target: string | undefined, filename: string | undefined, opts: { org?: string; dryRun?: boolean; json?: boolean }) => {
    try { await runAttachRemove({ target, filename, org: opts.org, dryRun: opts.dryRun, json: opts.json }); } catch (err) { exitOnError(err); }
  })
  .addHelpText(
    'after',
    `
Delete by attachment id (get ids from the attachments array in \`jirallm fetch <key> --json\`);
a bare numeric id needs -o (or an org/KEY) since it cannot infer the org on its own.
Alternatively, delete by issue key + filename — the org is inferred from the key prefix.

Examples:
  $ jirallm attach:rm 99021 -o acme
  $ jirallm attach:rm 99021 -o acme --dry-run --json
  $ jirallm attach:rm PROJ-123 screenshot.png
`
  );

program
  .command('watchers <issue-key>')
  .description('List, add, or remove watchers on an issue.')
  .option('-o, --org <name>', 'Organization name override')
  .option('--add <user>', 'Add watcher: an accountId, email, display name, or "me"')
  .option('--rm <user>', 'Remove watcher: an accountId, email, display name, or "me"')
  .option('--dry-run', 'Show what would change without calling Jira')
  .option('--json', 'Output JSON instead of human-readable')
  .action(async (issueKey: string, opts: { org?: string; add?: string; rm?: string; dryRun?: boolean; json?: boolean }) => {
    try { await runWatchers({ issueKey, ...opts }); } catch (err) { exitOnError(err); }
  })
  .addHelpText(
    'after',
    `
With no --add/--rm, just lists current watchers.
You can pass both --add and --rm in one call; both run before the final listing.
Pass "me" to add/remove yourself (resolved via \`/myself\`).

Examples:
  $ jirallm watchers PROJ-123 --json
  $ jirallm watchers PROJ-123 --add me
  $ jirallm watchers PROJ-123 --rm 5ac1234567890abcdef
  $ jirallm watchers PROJ-123 --add me --rm 5acOldUser --json
`
  );

  return program;
}

function isRunAsEntry(): boolean {
  const invoked = process.argv[1];
  if (invoked === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(invoked)).href;
  } catch {
    return import.meta.url === pathToFileURL(invoked).href;
  }
}

if (isRunAsEntry()) {
  buildProgram()
    .parseAsync(process.argv)
    .catch((error: unknown) => {
      if (process.argv.includes('--json')) {
        console.error(JSON.stringify({ error: (error as Error).message ?? String(error) }));
        process.exit(1);
      }
      console.error('Unexpected error:', error);
      process.exit(1);
    });
}
