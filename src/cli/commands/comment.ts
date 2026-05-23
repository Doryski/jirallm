import { readFileSync } from 'fs';
import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { markdownToWiki } from '../../lib/markdownToWiki.js';
import { splitIntoChunks } from '../../lib/chunkMarkdown.js';
import { parseIssueKey } from '../issueKey.js';
import { resolveOrg } from '../resolveOrg.js';

export type CommentOptions = {
  file?: string;
  text?: string;
  org?: string;
  maxChars?: string;
  noWiki?: boolean;
  dryRun?: boolean;
  replyTo?: string;
  noThread?: boolean;
};

const DEFAULT_MAX_CHARS = 25000;

export async function runComment(issueKeyArg: string, opts: CommentOptions): Promise<void> {
  const parsed = parseIssueKey(issueKeyArg);
  const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);

  let rawBody: string;
  if (opts.file) {
    rawBody = readFileSync(opts.file, 'utf-8');
  } else if (opts.text) {
    rawBody = opts.text;
  } else {
    rawBody = readFileSync(0, 'utf-8');
  }
  if (!rawBody.trim()) throw new Error('Empty comment body.');

  const profile = await loadProfile({ org, project: parsed.projectKey });
  const client = new JiraClient(profile.config, profile.apiToken);

  const maxChars = opts.maxChars ? parseInt(opts.maxChars, 10) : DEFAULT_MAX_CHARS;
  const rawChunks = splitIntoChunks(rawBody, maxChars);
  const chunks = opts.noWiki ? rawChunks : rawChunks.map((c) => markdownToWiki(c));

  console.log(`Posting ${chunks.length} comment(s) to ${parsed.key} on ${org}...`);

  const thread = !opts.noThread;
  let prevId: string | undefined = opts.replyTo;
  const rootId = opts.replyTo;
  for (let i = 0; i < chunks.length; i++) {
    const header =
      chunks.length > 1
        ? i === 0
          ? `_Część 1/${chunks.length}${rootId ? ` (replika)` : ''}._\n\n`
          : `_Część ${i + 1}/${chunks.length}._\n\n`
        : '';
    const fullBody = header + chunks[i];
    const parentId = thread ? prevId : rootId;

    if (opts.dryRun) {
      console.log(
        `--- chunk ${i + 1}/${chunks.length} (${fullBody.length} chars)${parentId ? ` reply→${parentId}` : ''} ---`
      );
      console.log(fullBody.slice(0, 300) + (fullBody.length > 300 ? '\n...' : ''));
      continue;
    }

    const result = await client.addComment(parsed.key, fullBody, parentId);
    console.log(
      `  ✓ Posted comment ${i + 1}/${chunks.length} (id=${result.id}${parentId ? `, parent=${parentId}` : ''})`
    );
    prevId = result.id;
  }

  if (opts.dryRun) console.log('(dry-run — no comments posted)');
}

export async function runDeleteComment(
  issueKeyArg: string,
  commentId: string,
  opts: { org?: string }
): Promise<void> {
  const parsed = parseIssueKey(issueKeyArg);
  const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);
  const profile = await loadProfile({ org, project: parsed.projectKey });
  const client = new JiraClient(profile.config, profile.apiToken);
  await client.deleteComment(parsed.key, commentId);
  console.log(`Deleted comment ${commentId} from ${parsed.key}`);
}
