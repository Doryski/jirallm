import { intro, outro, text, password, confirm, select, isCancel, cancel, note } from '@clack/prompts';
import {
  resolveConfigPath,
  readConfig,
  upsertOrg,
  upsertProject,
  type Organization,
  type Project,
  type VideoFramesConfig,
} from '../../lib/config.js';
import { setToken } from '../../lib/credentials.js';
import { checkFFmpegInstalled } from '../../lib/videoFrameExtractor.js';
import { detectOS, hasHomebrew } from '../../lib/platform.js';

function exitIfCancelled<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel('Cancelled.');
    process.exit(0);
  }
  return value;
}

const ORG_NAME_RE = /^[a-zA-Z0-9_.-]+$/;
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

async function promptOrg(existingOrgNames: string[]): Promise<{ name: string; isNew: boolean }> {
  if (existingOrgNames.length === 0) {
    const name = exitIfCancelled(
      await text({
        message:
          'Organization name (short identifier, e.g. "acme")\n\x1b[2mA short identifier used to group projects and select via `--org acme`.\x1b[22m',
        placeholder: 'acme',
        validate: (v) => {
          if (!v) return 'Required';
          if (!ORG_NAME_RE.test(v)) return 'Use letters, digits, _, ., -';
        },
      })
    );
    return { name, isNew: true };
  }

  const choice = exitIfCancelled(
    await select({
      message:
        'What do you want to do?\n\x1b[2mChoose to add a project to an existing org or set up a new one.\x1b[22m',
      options: [
        ...existingOrgNames.map((n) => ({ value: `existing:${n}`, label: `Add a project to "${n}"` })),
        { value: '__new__', label: 'Create a new organization' },
      ],
    })
  ) as string;

  if (choice.startsWith('existing:')) {
    return { name: choice.slice('existing:'.length), isNew: false };
  }

  const name = exitIfCancelled(
    await text({
      message:
        'New organization name\n\x1b[2mA short identifier used to group projects and select via `--org acme`.\x1b[22m',
      placeholder: 'acme',
      validate: (v) => {
        if (!v) return 'Required';
        if (!ORG_NAME_RE.test(v)) return 'Use letters, digits, _, ., -';
        if (existingOrgNames.includes(v)) return 'Organization already exists';
      },
    })
  );
  return { name, isNew: true };
}

async function promptOrgFields(name: string): Promise<{
  org: Organization;
  apiToken: string;
}> {
  const baseUrl = exitIfCancelled(
    await text({
      message:
        'Jira base URL\n\x1b[2mThe full URL of your Jira Cloud workspace, including https://.\x1b[22m',
      placeholder: 'https://your-org.atlassian.net',
      validate: (v) => {
        if (!v) return 'Required';
        if (!/^https?:\/\//.test(v)) return 'Must start with http(s)://';
      },
    })
  );

  const userEmail = exitIfCancelled(
    await text({
      message:
        'Jira account email\n\x1b[2mThe email you log into Jira with — used together with the API token for auth.\x1b[22m',
      placeholder: 'you@example.com',
      validate: (v) => (v && v.includes('@') ? undefined : 'Looks invalid'),
    })
  );

  const includeSubtasks = exitIfCancelled(
    await confirm({
      message:
        'Include subtasks by default?\n\x1b[2mIf enabled, exports also include child subtasks of each issue.\x1b[22m',
      initialValue: false,
    })
  );

  const enableVideo = exitIfCancelled(
    await confirm({
      message:
        "Extract video frames by default?\n\x1b[2mIf enabled, jirallm samples frames from attached videos so LLMs can 'see' them. Requires ffmpeg.\x1b[22m",
      initialValue: true,
    })
  );

  let videoFrames: VideoFramesConfig;
  if (enableVideo) {
    const fps = exitIfCancelled(
      await text({
        message:
          'Frame extraction FPS\n\x1b[2mHow many frames per second to sample from each video.\x1b[22m',
        defaultValue: '5',
        placeholder: '5',
      })
    );
    const maxFrames = exitIfCancelled(
      await text({
        message:
          'Max frames kept per video\n\x1b[2mCap on frames kept per video — controls token cost.\x1b[22m',
        defaultValue: '10',
        placeholder: '10',
      })
    );
    videoFrames = {
      enabled: true,
      fps: parseInt(fps, 10) || 5,
      maxFrames: parseInt(maxFrames, 10) || 10,
    };
  } else {
    videoFrames = { enabled: false };
  }

  const apiToken = exitIfCancelled(
    await password({
      message:
        'Jira API token\n\x1b[2mCreate one at https://id.atlassian.com/manage-profile/security/api-tokens. Stored in your OS keychain.\x1b[22m',
      validate: (v) => (v ? undefined : 'Required'),
    })
  );

  const org: Organization = {
    name,
    baseUrl,
    userEmail,
    includeSubtasks: includeSubtasks || undefined,
    videoFrames,
    projects: {},
  };

  return { org, apiToken };
}

function parseProjectKeysInput(input: string, existingKeys: string[]): string[] | string {
  const keys = input
    .split(',')
    .map((k) => k.trim().toUpperCase())
    .filter((k) => k.length > 0);
  if (keys.length === 0) return 'Required';
  const seen = new Set<string>();
  for (const k of keys) {
    if (!PROJECT_KEY_RE.test(k)) return `Invalid key "${k}". Use uppercase letters, digits, _ (must start with a letter).`;
    if (seen.has(k)) return `Duplicate key "${k}" in input.`;
    if (existingKeys.includes(k)) return `Project key "${k}" already exists in this org.`;
    seen.add(k);
  }
  return keys;
}

async function promptProject(orgName: string, existingKeys: string[]): Promise<Project[]> {
  const raw = exitIfCancelled(
    await text({
      message: `Project keys for "${orgName}" (uppercase, comma-separated, e.g. PROJ,DOCS)\n\x1b[2mJira project key prefixes shown in issue IDs (e.g. PROJ in PROJ-123). Add several at once.\x1b[22m`,
      placeholder: 'PROJ,DOCS',
      validate: (v) => {
        const result = parseProjectKeysInput(v ?? '', existingKeys);
        if (typeof result === 'string') return result;
      },
    })
  );

  const parsed = parseProjectKeysInput(raw, existingKeys);
  if (typeof parsed === 'string') throw new Error(parsed);

  const outputDir = exitIfCancelled(
    await text({
      message:
        'Default output directory for these projects (optional)\n\x1b[2mWhere exports for these projects will be written. Leave empty to choose per-export with `--output-dir`.\x1b[22m',
      placeholder: './jira-export',
    })
  );

  const dir = outputDir || undefined;
  return parsed.map((key) => ({ key, outputDir: dir }));
}

export async function runInit(): Promise<void> {
  intro('jirallm init');

  const existing = readConfig();
  const existingOrgNames = Object.keys(existing.orgs ?? {});
  const { name: orgName, isNew } = await promptOrg(existingOrgNames);

  let newOrgVideoFrames: VideoFramesConfig | undefined;
  if (isNew) {
    const { org, apiToken } = await promptOrgFields(orgName);
    newOrgVideoFrames = org.videoFrames;
    upsertOrg(org);

    try {
      await setToken(orgName, apiToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      note(
        `Org saved. Token NOT stored in keychain: ${msg}\nReinstall jirallm or check that your platform is supported, then rerun \`jirallm auth set --org ${orgName}\`.`,
        'Partial success'
      );
    }
  }

  const orgRaw = readConfig().orgs?.[orgName];
  const existingProjectKeys = Object.keys(orgRaw?.projects ?? {});

  const projects = await promptProject(orgName, existingProjectKeys);
  for (const p of projects) upsertProject(orgName, p);

  note(`Config saved to ${resolveConfigPath()}`, 'Done');

  if (isNew && newOrgVideoFrames?.enabled) {
    await maybeOfferSetup();
  }

  const sample = projects[0].key;
  outro(`Use it with: jirallm ${sample}-123  (or jirallm ${orgName}/${sample}-123 to disambiguate)`);
}

async function maybeOfferSetup(): Promise<void> {
  if (await checkFFmpegInstalled()) return;

  note(
    'Video frames are enabled but ffmpeg was not found on your PATH.\n`jirallm setup` can install it for you.',
    'ffmpeg missing'
  );

  // On macOS without Homebrew, setup may cascade into a long Homebrew + Xcode CLT install.
  // Default the prompt to "no" there so users opt in deliberately.
  const os = detectOS();
  const defaultYes = os === 'macos' ? await hasHomebrew() : true;

  const proceed = await confirm({
    message: 'Run `jirallm setup` now?\n\x1b[2mYou can also run it manually later, or use `jirallm setup --bundled` for a self-contained install.\x1b[22m',
    initialValue: defaultYes,
  });
  if (isCancel(proceed) || proceed !== true) return;

  const { runSetup } = await import('./setup.js');
  await runSetup({});
}
