import { readFileSync } from 'fs';
import { loadProfile } from '../../lib/config.js';
import { JiraClient, type JiraComment } from '../../lib/jiraClient.js';
import { markdownToWiki } from '../../lib/markdownToWiki.js';
import { splitIntoChunks } from '../../lib/chunkMarkdown.js';
import { parseIssueKey } from '../issueKey.js';
import { resolveOrg } from '../resolveOrg.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';
import { confirmOrAbort } from '../confirm.js';
import { embedCommentImages, prepareAttachments, previewImages } from '../attachEmbeds.js';
import { containsMarkers } from '../../lib/adfMedia.js';

export type CommentOptions = {
  file?: string;
  text?: string;
  org?: string;
  maxChars?: string;
  noWiki?: boolean;
  dryRun?: boolean;
  replyTo?: string;
  noThread?: boolean;
  attach?: string[];
  attachImages?: string[];
  imageLayout?: string;
  imageWidth?: string;
  json?: boolean;
};

export type DeleteCommentOptions = {
  org?: string;
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
};

export type CommentListOptions = {
  org?: string;
  json?: boolean;
};

export type EditCommentOptions = {
  file?: string;
  text?: string;
  org?: string;
  noWiki?: boolean;
  attach?: string[];
  attachImages?: string[];
  imageLayout?: string;
  imageWidth?: string;
  dryRun?: boolean;
  json?: boolean;
};

const DEFAULT_MAX_CHARS = 25000;

function buildHeader(index: number, total: number, rootId?: string): string {
  if (total <= 1) return '';
  if (index === 0) return `_Part 1/${total}${rootId ? ' (reply)' : ''}._\n\n`;
  return `_Part ${index + 1}/${total}._\n\n`;
}

function commentSnippet(client: JiraClient, comment: JiraComment, max = 200): string {
  const text = client.convertADFToMarkdown(comment.body).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function commentBody(client: JiraClient, comment: JiraComment): string {
  return client.convertADFToMarkdown(comment.body).trim();
}

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

  const applied = await prepareAttachments(client, parsed.key, rawBody, opts, !!opts.dryRun);
  rawBody = applied.body;
  const attachedNames = applied.attachedNames;

  const maxChars = opts.maxChars ? parseInt(opts.maxChars, 10) : DEFAULT_MAX_CHARS;
  const rawChunks = splitIntoChunks(rawBody, maxChars);
  const chunks = opts.noWiki ? rawChunks : rawChunks.map((c) => markdownToWiki(c));

  const asJson = shouldOutputJson(opts);
  const thread = !opts.noThread;
  const rootId = opts.replyTo;

  if (opts.dryRun) {
    const previews = chunks.map((chunk, i) => {
      const fullBody = buildHeader(i, chunks.length, rootId) + chunk;
      return { index: i + 1, total: chunks.length, chars: fullBody.length, parent: rootId, body: fullBody };
    });
    const embeddedImages = previewImages(applied.images, applied.layout);
    if (asJson) {
      printJson({
        dryRun: true,
        issueKey: parsed.key,
        org,
        attachments: attachedNames,
        embeddedImages,
        chunks: previews,
      });
      return;
    }
    console.log(`Posting ${chunks.length} comment(s) to ${parsed.key} on ${org}...`);
    for (const img of embeddedImages) {
      const px = img.pixels ? ` ${img.pixels.width}x${img.pixels.height}px` : '';
      console.log(
        `  image: ${img.filename} (${img.layout}, ${img.width}%${px})${img.caption ? ` — "${img.caption}"` : ''}`
      );
    }
    for (const p of previews) {
      console.log(
        `--- chunk ${p.index}/${p.total} (${p.chars} chars)${p.parent ? ` reply→${p.parent}` : ''} ---`
      );
      console.log(p.body.slice(0, 300) + (p.body.length > 300 ? '\n...' : ''));
    }
    console.log('(dry-run — no comments posted)');
    return;
  }

  if (!asJson) console.log(`Posting ${chunks.length} comment(s) to ${parsed.key} on ${org}...`);

  const posted: Array<{ id: string; index: number; parent?: string }> = [];
  let prevId: string | undefined = opts.replyTo;
  for (let i = 0; i < chunks.length; i++) {
    const fullBody = buildHeader(i, chunks.length, rootId) + chunks[i];
    const parentId = thread ? prevId : rootId;
    const result = await client.addComment(parsed.key, fullBody, parentId);
    posted.push({ id: result.id, index: i + 1, parent: parentId });
    const chunkImages = applied.images.filter((img) => containsMarkers(fullBody, [img]));
    if (chunkImages.length > 0) {
      await embedCommentImages(client, parsed.key, result.id, chunkImages, applied.layout);
    }
    if (!asJson) {
      console.log(
        `  ✓ Posted comment ${i + 1}/${chunks.length} (id=${result.id}${parentId ? `, parent=${parentId}` : ''})`
      );
    }
    prevId = result.id;
  }

  if (asJson) printJson({ issueKey: parsed.key, org, attachments: attachedNames, posted });
}

export async function runCommentList(
  issueKeyArg: string,
  opts: CommentListOptions
): Promise<void> {
  const parsed = parseIssueKey(issueKeyArg);
  const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);
  const profile = await loadProfile({ org, project: parsed.projectKey });
  const client = new JiraClient(profile.config, profile.apiToken);

  const comments = await client.fetchIssueComments(parsed.key);

  if (shouldOutputJson(opts)) {
    printJson({
      issueKey: parsed.key,
      comments: comments.map((c) => ({
        id: c.id,
        author: c.author.displayName,
        created: c.created,
        snippet: commentSnippet(client, c),
        body: commentBody(client, c),
      })),
    });
    return;
  }

  if (comments.length === 0) {
    console.log(`${parsed.key} has no comments.`);
    return;
  }

  console.log(`${parsed.key} comments (${comments.length}):`);
  for (const c of comments) {
    console.log(
      `  ${c.id.padEnd(10)}  ${c.author.displayName.padEnd(20)}  ${commentSnippet(client, c, 80)}`
    );
  }
}

export async function runEditComment(
  issueKeyArg: string,
  commentId: string,
  opts: EditCommentOptions
): Promise<void> {
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

  const existing = await client.getComment(parsed.key, commentId);
  const applied = await prepareAttachments(client, parsed.key, rawBody, opts, !!opts.dryRun);
  const body = opts.noWiki ? applied.body : markdownToWiki(applied.body);
  const attachedNames = applied.attachedNames;
  const asJson = shouldOutputJson(opts);

  if (opts.dryRun) {
    if (asJson) {
      printJson({
        dryRun: true,
        issueKey: parsed.key,
        org,
        id: existing.id,
        attachments: attachedNames,
        embeddedImages: previewImages(applied.images, applied.layout),
        chars: body.length,
        body,
      });
      return;
    }
    console.log(`Dry run — would update comment ${existing.id} on ${parsed.key} (${body.length} chars):`);
    console.log(body.slice(0, 300) + (body.length > 300 ? '\n...' : ''));
    console.log('(dry-run — comment not updated)');
    return;
  }

  await client.updateComment(parsed.key, commentId, body);
  if (applied.images.length > 0) {
    await embedCommentImages(client, parsed.key, commentId, applied.images, applied.layout);
  }

  if (asJson) {
    printJson({ issueKey: parsed.key, org, id: existing.id, attachments: attachedNames, updated: true });
    return;
  }
  console.log(`✓ Updated comment ${existing.id} on ${parsed.key}`);
}

export async function runDeleteComment(
  issueKeyArg: string,
  commentId: string,
  opts: DeleteCommentOptions
): Promise<void> {
  const parsed = parseIssueKey(issueKeyArg);
  const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);
  const profile = await loadProfile({ org, project: parsed.projectKey });
  const client = new JiraClient(profile.config, profile.apiToken);

  const comment = await client.getComment(parsed.key, commentId);
  const snippet = commentSnippet(client, comment);
  const asJson = shouldOutputJson(opts);

  if (opts.dryRun) {
    if (asJson) {
      printJson({
        dryRun: true,
        issueKey: parsed.key,
        id: comment.id,
        author: comment.author.displayName,
        body: snippet,
      });
      return;
    }
    console.log(`Dry run — would delete comment ${comment.id} from ${parsed.key}:`);
    console.log(`  author: ${comment.author.displayName}`);
    console.log(`  ${snippet}`);
    return;
  }

  console.log(`Comment ${comment.id} by ${comment.author.displayName}:`);
  console.log(`  ${snippet}`);
  const confirmed = await confirmOrAbort(`Delete comment ${comment.id} from ${parsed.key}?`, {
    yes: opts.yes,
  });
  if (!confirmed) {
    console.log('Aborted — no comment deleted.');
    return;
  }

  await client.deleteComment(parsed.key, commentId);
  console.log(`Deleted comment ${commentId} from ${parsed.key}`);
}
