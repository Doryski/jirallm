import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { parseIssueKey } from '../issueKey.js';
import { resolveOrg } from '../resolveOrg.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type AttachOptions = {
  issueKey: string;
  files: string[];
  org?: string;
  dryRun?: boolean;
  json?: boolean;
};

export async function runAttach(opts: AttachOptions): Promise<void> {
  const parsed = parseIssueKey(opts.issueKey);
  const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);
  const profile = await loadProfile({ org, project: parsed.projectKey });

  if (opts.dryRun) {
    const payload = { dryRun: true, issueKey: parsed.key, files: opts.files };
    if (shouldOutputJson(opts)) printJson(payload);
    else console.log(`Dry run — would attach ${opts.files.length} file(s) to ${parsed.key}:\n  ${opts.files.join('\n  ')}`);
    return;
  }

  const client = new JiraClient(profile.config, profile.apiToken);
  const uploaded: Array<{ id: string; filename: string; size: number }> = [];
  for (const file of opts.files) {
    const result = await client.uploadAttachment(parsed.key, file);
    for (const a of result) uploaded.push(a);
  }

  if (shouldOutputJson(opts)) {
    printJson({ issueKey: parsed.key, attachments: uploaded });
    return;
  }
  console.log(`✓ Uploaded ${uploaded.length} attachment(s) to ${parsed.key}:`);
  for (const a of uploaded) {
    console.log(`  [${a.id}] ${a.filename} (${a.size}b)`);
  }
}

export type AttachRemoveOptions = {
  attachmentId: string;
  org: string;
  dryRun?: boolean;
  json?: boolean;
};

export async function runAttachRemove(opts: AttachRemoveOptions): Promise<void> {
  if (opts.dryRun) {
    const payload = { dryRun: true, attachmentId: opts.attachmentId };
    if (shouldOutputJson(opts)) printJson(payload);
    else console.log(`Dry run — would delete attachment ${opts.attachmentId}`);
    return;
  }
  const profile = await loadProfile({ org: opts.org });
  const client = new JiraClient(profile.config, profile.apiToken);
  await client.deleteAttachment(opts.attachmentId);
  if (shouldOutputJson(opts)) {
    printJson({ attachmentId: opts.attachmentId, removed: true });
    return;
  }
  console.log(`✓ Removed attachment ${opts.attachmentId}`);
}
