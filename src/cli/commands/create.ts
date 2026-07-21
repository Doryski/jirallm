import { readFile } from 'node:fs/promises';
import { loadOrgProfile, resolveOptionalProjectKey } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { findFieldsOffCreateScreen, parseFieldFlags } from '../../lib/customFieldWrite.js';
import { withResolvedSprint } from '../../lib/sprintWrite.js';
import type { CustomFieldDefs } from '../../lib/exportFields.js';
import { resolveAccountId } from '../resolveUser.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';
import {
  embedDescriptionImages,
  prepareAttachments,
  previewMedia,
  resolveMediaLayout,
} from '../attachEmbeds.js';

export type CreateOptions = {
  org?: string;
  projectKey?: string;
  type: string;
  summary: string;
  description?: string;
  descriptionFile?: string;
  noWiki?: boolean;
  assignee?: string;
  labels?: string;
  priority?: string;
  parent?: string;
  components?: string[];
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

export async function runCreate(opts: CreateOptions): Promise<void> {
  const profile = await loadOrgProfile({ org: opts.org });
  resolveMediaLayout(opts);

  let descriptionMarkdown: string | undefined;
  if (opts.descriptionFile) {
    descriptionMarkdown = await readFile(opts.descriptionFile, 'utf8');
  } else if (opts.description) {
    descriptionMarkdown = opts.description;
  }

  const labels = opts.labels?.split(',').map((s) => s.trim()).filter(Boolean);
  const components = opts.components?.map((s) => s.trim()).filter(Boolean);
  const customFieldDefs = profile.org?.export?.customFieldDefs;
  const parsedFields = parseFieldFlags(opts.field, customFieldDefs);

  const projectKey = resolveOptionalProjectKey(profile.org, opts.projectKey);
  if (!projectKey) {
    const keys = Object.keys(profile.org.projects).join(', ') || '(none)';
    throw new Error(
      `No project specified for org "${profile.org.name}". Pass --project. Available projects: ${keys}`
    );
  }

  const client = new JiraClient(profile.config, profile.apiToken);

  const customFields = await withResolvedSprint(client, parsedFields, opts.sprint, {
    projectKey,
    board: opts.board,
    customFieldDefs,
  });

  let assigneeAccountId: string | undefined;
  let assigneeDisplayName: string | undefined;
  if (opts.assignee) {
    const resolved = await resolveAccountId(client, opts.assignee, { project: projectKey });
    assigneeAccountId = resolved.accountId ?? undefined;
    assigneeDisplayName = resolved.displayName ?? undefined;
  }

  const input = {
    projectKey,
    issueType: opts.type,
    summary: opts.summary,
    descriptionMarkdown,
    noWiki: opts.noWiki,
    assigneeAccountId,
    labels,
    priority: opts.priority,
    parentKey: opts.parent,
    components,
    customFields,
  };

  if (opts.dryRun) {
    const dryRunAttachments = await prepareAttachments(
      client,
      '(new issue)',
      descriptionMarkdown ?? '',
      opts,
      true
    );
    const preview = assigneeDisplayName ? { ...input, assigneeDisplayName } : input;
    if (shouldOutputJson(opts)) {
      printJson({
        dryRun: true,
        input: preview,
        attachments: dryRunAttachments.attachedNames,
        embeddedImages: previewMedia(dryRunAttachments.media, dryRunAttachments.layout),
      });
    } else {
      console.log('Dry run — would create issue:');
      console.log(JSON.stringify(preview, null, 2));
      for (const name of dryRunAttachments.attachedNames) console.log(`  attach: ${name}`);
    }
    return;
  }

  if (customFields) {
    await assertCustomFieldsOnCreateScreen(
      client,
      projectKey,
      opts.type,
      customFields,
      profile.org?.export?.customFieldDefs
    );
  }

  const result = await client.createIssue(input);

  const applied = await prepareAttachments(
    client,
    result.key,
    descriptionMarkdown ?? '',
    opts,
    false
  );
  if (applied.attachedNames.length > 0) {
    await client.editIssue(result.key, { descriptionMarkdown: applied.body, noWiki: opts.noWiki });
    await embedDescriptionImages(client, result.key, applied.media, applied.layout);
  }

  if (shouldOutputJson(opts)) {
    printJson({
      ...result,
      ...(applied.attachedNames.length > 0 ? { attachments: applied.attachedNames } : {}),
    });
    return;
  }
  console.log(`✓ Created ${result.key}`);
}

/**
 * Guard against Jira silently dropping custom fields on create: fields absent
 * from the project + issue-type create screen are ignored (and defaulted) by the
 * create endpoint, unlike edit. Abort with a clear message instead of writing an
 * issue with the values silently lost. If the create screen can't be fetched
 * (e.g. permissions), warn and proceed rather than block a flow that may work.
 */
async function assertCustomFieldsOnCreateScreen(
  client: JiraClient,
  projectKey: string,
  issueType: string,
  customFields: Record<string, unknown>,
  customFieldDefs: CustomFieldDefs = {}
): Promise<void> {
  let createFields;
  try {
    createFields = await client.getCreateFields(projectKey, issueType);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(
      `Warning: could not verify the "${issueType}" create screen (${reason}) — ` +
        'proceeding without checking that --field values are on it.'
    );
    return;
  }

  const missing = findFieldsOffCreateScreen(
    Object.keys(customFields),
    createFields.map((f) => f.fieldId)
  );
  if (missing.length === 0) return;

  const idToName = new Map(Object.entries(customFieldDefs).map(([name, def]) => [def.id, name]));
  const labels = missing.map((id) => (idToName.has(id) ? `${idToName.get(id)} [${id}]` : id));
  throw new Error(
    `Field(s) not on the "${issueType}" create screen in ${projectKey}: ${labels.join(', ')}. ` +
      'Jira would silently drop them on create. Add them to the create screen, or create the ' +
      `issue first and set them with \`jirallm edit <key> --field ...\`. Run \`jirallm fields -P ${projectKey} --type ${issueType}\` to list create-screen fields.`
  );
}
