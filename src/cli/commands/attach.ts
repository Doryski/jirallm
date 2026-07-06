import { stat } from 'fs/promises';
import { loadOrgProfile, loadProfile } from '../../lib/config.js';
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

async function assertFilesReadable(files: string[]): Promise<void> {
  for (const file of files) {
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error(`Not a regular file: ${file}`);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw new Error(`File not found: ${file}`, { cause: err });
      if (code === 'EACCES') throw new Error(`File not readable: ${file}`, { cause: err });
      throw err instanceof Error ? err : new Error(`Cannot read file: ${file}`);
    }
  }
}

export async function runAttach(opts: AttachOptions): Promise<void> {
  const parsed = parseIssueKey(opts.issueKey);
  const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);
  const profile = await loadProfile({ org, project: parsed.projectKey });

  if (opts.dryRun) {
    await assertFilesReadable(opts.files);
    const payload = { dryRun: true, org, issueKey: parsed.key, files: opts.files };
    if (shouldOutputJson(opts)) printJson(payload);
    else
      console.log(
        `Dry run — would attach ${opts.files.length} file(s) to ${parsed.key} in org "${org}":\n  ${opts.files.join('\n  ')}`
      );
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
  target?: string;
  filename?: string;
  org?: string;
  dryRun?: boolean;
  json?: boolean;
};

type AttachmentMeta = Awaited<ReturnType<JiraClient['getAttachmentMeta']>>;

const NUMERIC_ID_RE = /^\d+$/;

function splitOrgPrefix(target: string): { org?: string; rest: string } {
  const idx = target.indexOf('/');
  if (idx === -1) return { rest: target };
  return { org: target.slice(0, idx) || undefined, rest: target.slice(idx + 1) };
}

function printRemovePreview(meta: AttachmentMeta, opts: AttachRemoveOptions): void {
  if (shouldOutputJson(opts)) {
    printJson({ dryRun: true, attachment: meta });
    return;
  }
  const mimeType = meta.mimeType ? ` ${meta.mimeType}` : '';
  const author = meta.author ? ` uploaded by ${meta.author}` : '';
  console.log(
    `Dry run — would delete attachment [${meta.id}] ${meta.filename} (${meta.size}b)${mimeType}${author}`
  );
}

function printRemoved(attachmentId: string, filename: string | undefined, opts: AttachRemoveOptions): void {
  if (shouldOutputJson(opts)) {
    printJson({ attachmentId, removed: true });
    return;
  }
  const label = filename ? `[${attachmentId}] ${filename}` : attachmentId;
  console.log(`✓ Removed attachment ${label}`);
}

async function resolveAttachmentIdByFilename(
  client: JiraClient,
  issueKey: string,
  filename: string
): Promise<{ id: string; filename: string }> {
  const details = await client.fetchIssueDetails(issueKey, {
    includeComments: false,
    includeChangelog: false,
  });
  const matches = details.attachments.filter((a) => a.filename === filename);
  if (matches.length === 0) {
    const available = details.attachments.map((a) => a.filename).join(', ') || '(none)';
    throw new Error(`No attachment named "${filename}" on ${issueKey}. Available: ${available}`);
  }
  if (matches.length > 1) {
    const ids = matches.map((a) => a.id).join(', ');
    throw new Error(
      `Multiple attachments named "${filename}" on ${issueKey} (ids: ${ids}). Remove by id with \`attach:rm <id> -o <org>\`.`
    );
  }
  const match = matches[0];
  return { id: match.id, filename: match.filename };
}

async function removeByKeyAndFilename(
  target: string,
  filename: string,
  opts: AttachRemoveOptions
): Promise<void> {
  const parsed = parseIssueKey(target);
  const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);
  const profile = await loadOrgProfile({ org });
  const client = new JiraClient(profile.config, profile.apiToken);
  const resolved = await resolveAttachmentIdByFilename(client, parsed.key, filename);

  if (opts.dryRun) {
    const meta = await client.getAttachmentMeta(resolved.id);
    printRemovePreview(meta, opts);
    return;
  }
  await client.deleteAttachment(resolved.id);
  printRemoved(resolved.id, resolved.filename, opts);
}

async function removeById(
  attachmentId: string,
  org: string | undefined,
  opts: AttachRemoveOptions
): Promise<void> {
  if (!org) {
    throw new Error(
      `Cannot infer org from attachment id ${attachmentId}. Pass -o <org> (e.g. \`attach:rm ${attachmentId} -o <org>\`).`
    );
  }
  const profile = await loadOrgProfile({ org });
  const client = new JiraClient(profile.config, profile.apiToken);

  if (opts.dryRun) {
    const meta = await client.getAttachmentMeta(attachmentId);
    printRemovePreview(meta, opts);
    return;
  }
  await client.deleteAttachment(attachmentId);
  printRemoved(attachmentId, undefined, opts);
}

async function requireFilenameForKey(target: string, opts: AttachRemoveOptions): Promise<never> {
  const parsed = parseIssueKey(target);
  const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);
  const profile = await loadOrgProfile({ org });
  const client = new JiraClient(profile.config, profile.apiToken);
  const details = await client.fetchIssueDetails(parsed.key, {
    includeComments: false,
    includeChangelog: false,
  });
  const available = details.attachments.map((a) => a.filename).join(', ') || '(none)';
  throw new Error(
    `A filename is required to remove an attachment from ${parsed.key}. Available: ${available}`
  );
}

export async function runAttachRemove(opts: AttachRemoveOptions): Promise<void> {
  if (!opts.target) throw new Error('Provide an attachment id, or an issue key and filename.');

  if (opts.filename) {
    await removeByKeyAndFilename(opts.target, opts.filename, opts);
    return;
  }

  const { org: prefixOrg, rest } = splitOrgPrefix(opts.target);
  if (NUMERIC_ID_RE.test(rest)) {
    await removeById(rest, opts.org ?? prefixOrg, opts);
    return;
  }

  await requireFilenameForKey(opts.target, opts);
}
