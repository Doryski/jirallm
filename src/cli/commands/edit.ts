import { readFile } from 'node:fs/promises';
import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { parseFieldFlags } from '../../lib/customFieldWrite.js';
import { withResolvedSprint } from '../../lib/sprintWrite.js';
import { parseIssueKey, type ParsedIssueKey } from '../issueKey.js';
import { resolveOrg } from '../resolveOrg.js';
import { resolveAccountId } from '../resolveUser.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';
import { normalizeNameList } from '../nameList.js';
import { assertVersionsSettable } from '../versionScreen.js';
import {
  embedDescriptionImages,
  hasAttachments,
  prepareAttachments,
  previewMedia,
  resolveMediaLayout,
} from '../attachEmbeds.js';

export type EditOptions = {
  issueKey: string;
  org?: string;
  summary?: string;
  description?: string;
  descriptionFile?: string;
  noWiki?: boolean;
  assignee?: string;
  unassign?: boolean;
  labels?: string;
  priority?: string;
  parent?: string;
  due?: string;
  components?: string[];
  fixVersions?: string[];
  affectsVersions?: string[];
  field?: string[];
  sprint?: string;
  board?: string;
  attach?: string[];
  attachImages?: string[];
  attachMedia?: string[];
  imageLayout?: string;
  imageWidth?: string;
  dryRun?: boolean;
  json?: boolean;
};

const FIELD_INPUT_KEYS = [
  'summary',
  'description',
  'descriptionFile',
  'assignee',
  'labels',
  'priority',
  'parent',
  'due',
  'components',
  'fixVersions',
  'affectsVersions',
  'sprint',
] as const satisfies readonly (keyof EditOptions)[];

const NO_INPUT_MESSAGE =
  'Nothing to edit: pass at least one field flag (--summary, --description, --description-file, ' +
  '--assignee, --unassign, --labels, --priority, --parent, --due, --components, --fix-versions, ' +
  '--affects-versions, --sprint, --field) or --attach/--attach-images/--attach-media.';

export function hasFieldInput(opts: EditOptions): boolean {
  if (FIELD_INPUT_KEYS.some((key) => opts[key] !== undefined)) return true;
  if (opts.unassign === true) return true;
  return (opts.field?.length ?? 0) > 0;
}

async function readDescription(opts: EditOptions): Promise<string | undefined> {
  if (opts.descriptionFile) return readFile(opts.descriptionFile, 'utf8');
  return opts.description;
}

async function resolveAssignee(client: JiraClient, opts: EditOptions, parsed: ParsedIssueKey) {
  if (opts.unassign) return { accountId: null, displayName: undefined };
  if (opts.assignee === undefined) return { accountId: undefined, displayName: undefined };
  const resolved = await resolveAccountId(client, opts.assignee, {
    issueKey: parsed.key,
    project: parsed.projectKey,
    allowUnassign: true,
  });
  return { accountId: resolved.accountId, displayName: resolved.displayName };
}

function printAttachOnly(opts: EditOptions, issueKey: string, attachments: string[]): void {
  if (shouldOutputJson(opts)) {
    printJson({ issueKey, updated: false, attachments });
    return;
  }
  console.log(`✓ Attached ${attachments.length} file(s) to ${issueKey}`);
}

export async function runEdit(opts: EditOptions): Promise<void> {
  const parsed = parseIssueKey(opts.issueKey);
  const fieldInput = hasFieldInput(opts);
  if (!fieldInput && !hasAttachments(opts)) throw new Error(NO_INPUT_MESSAGE);

  const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);
  const profile = await loadProfile({ org, project: parsed.projectKey });

  const client = new JiraClient(profile.config, profile.apiToken);

  let descriptionMarkdown = await readDescription(opts);

  const labels = normalizeNameList(opts.labels?.split(','));
  const components = normalizeNameList(opts.components);
  const fixVersions = normalizeNameList(opts.fixVersions);
  const versions = normalizeNameList(opts.affectsVersions);
  const customFieldDefs = profile.org?.export?.customFieldDefs;
  const parsedFields = parseFieldFlags(opts.field, customFieldDefs);
  resolveMediaLayout(opts);

  const assignee = await resolveAssignee(client, opts, parsed);
  const customFields = await withResolvedSprint(client, parsedFields, opts.sprint, {
    projectKey: parsed.projectKey,
    board: opts.board,
    customFieldDefs,
  });
  await assertVersionsSettable(
    opts.dryRun ? {} : { fixVersions, versions },
    {
      load: () => client.getEditFields(parsed.key),
      context: { screen: `edit screen of ${parsed.key}`, target: `for ${parsed.key}` },
      remedy:
        `List the project's versions with \`jirallm versions -P ${parsed.projectKey}\`. ` +
        'A field missing from the edit screen can only be added by a Jira admin, or set from Jira itself (e.g. the release on the board).',
    }
  );

  const applied = await prepareAttachments(
    client,
    parsed.key,
    descriptionMarkdown ?? '',
    opts,
    !!opts.dryRun
  );
  if (applied.attachedNames.length > 0) {
    if (descriptionMarkdown === undefined) {
      console.warn(
        `Warning: files ${opts.dryRun ? 'would be uploaded' : 'uploaded'}, but no --description/--description-file given — embeds ${opts.dryRun ? 'would not be' : 'were not'} added to the description.`
      );
    } else {
      descriptionMarkdown = applied.body;
    }
  }

  const fields = {
    summary: opts.summary,
    descriptionMarkdown,
    noWiki: opts.noWiki,
    assigneeAccountId: assignee.accountId,
    labels,
    priority: opts.priority,
    parentKey: opts.parent,
    dueDate: opts.due,
    components,
    fixVersions,
    versions,
    customFields,
  };

  if (opts.dryRun) {
    const dryRunFields =
      assignee.displayName !== undefined
        ? { ...fields, assigneeDisplayName: assignee.displayName }
        : fields;
    if (shouldOutputJson(opts)) {
      printJson({
        dryRun: true,
        issueKey: parsed.key,
        fields: dryRunFields,
        attachments: applied.attachedNames,
        embeddedImages: previewMedia(applied.media, applied.layout),
      });
    } else {
      console.log(`Dry run — would edit ${parsed.key}:`);
      console.log(JSON.stringify(dryRunFields, null, 2));
      for (const name of applied.attachedNames) console.log(`  attach: ${name}`);
    }
    return;
  }

  if (!fieldInput) {
    printAttachOnly(opts, parsed.key, applied.attachedNames);
    return;
  }

  await client.editIssue(parsed.key, fields);
  if (applied.media.length > 0 && descriptionMarkdown !== undefined) {
    await embedDescriptionImages(client, parsed.key, applied.media, applied.layout);
  }

  if (shouldOutputJson(opts)) {
    printJson({
      issueKey: parsed.key,
      updated: true,
      ...(applied.attachedNames.length > 0 ? { attachments: applied.attachedNames } : {}),
    });
    return;
  }
  console.log(`✓ Updated ${parsed.key}`);
}
