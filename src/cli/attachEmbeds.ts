import { basename } from 'path';
import type { JiraClient } from '../lib/jiraClient.js';
import {
  applyMediaSingle,
  buildMediaEmbedBlock,
  describeMedia,
  isImageFile,
  mediaMarker,
  parseImageLayout,
  parseMediaSpec,
  parseImageWidth,
  placeMediaMarkers,
  type EmbeddedMedia,
  type MediaLayoutOptions,
} from '../lib/adfMedia.js';

export type AttachOptions = {
  attach?: string[];
  attachImages?: string[];
  attachMedia?: string[];
  imageLayout?: string;
  imageWidth?: string;
};

export type PreparedAttachments = {
  body: string;
  attachedNames: string[];
  media: EmbeddedMedia[];
  layout: MediaLayoutOptions;
};

export function previewMedia(media: EmbeddedMedia[], layout: MediaLayoutOptions) {
  return media.map((item) => ({
    filename: item.filename,
    kind: item.kind,
    caption: item.caption,
    layout: layout.layout,
    width: layout.width,
    pixels: item.size,
  }));
}

export function reportWarnings(warnings: string[]): void {
  for (const warning of warnings) console.warn(`Warning: ${warning}`);
}

export async function embedCommentImages(
  client: JiraClient,
  issueKey: string,
  commentId: string,
  media: EmbeddedMedia[],
  layout: MediaLayoutOptions
): Promise<void> {
  const warnings = await applyMediaSingle(
    {
      get: async () => (await client.getComment(issueKey, commentId)).body,
      put: (doc) => client.updateCommentAdf(issueKey, commentId, doc),
    },
    media,
    layout
  );
  reportWarnings(warnings);
}

export async function embedDescriptionImages(
  client: JiraClient,
  issueKey: string,
  media: EmbeddedMedia[],
  layout: MediaLayoutOptions
): Promise<void> {
  const warnings = await applyMediaSingle(
    {
      get: () => client.getIssueDescriptionAdf(issueKey),
      put: (doc) => client.updateIssueDescriptionAdf(issueKey, doc),
    },
    media,
    layout
  );
  reportWarnings(warnings);
}

export function embedForAttachment(filename: string): string {
  return isImageFile(filename) ? `!${filename}|thumbnail!` : `[^${filename}]`;
}

export function resolveMediaLayout(opts: AttachOptions): MediaLayoutOptions {
  return { layout: parseImageLayout(opts.imageLayout), width: parseImageWidth(opts.imageWidth) };
}

async function uploadOrPreview(
  client: JiraClient,
  issueKey: string,
  filePath: string,
  dryRun: boolean
): Promise<string> {
  if (dryRun) return basename(filePath);
  const uploaded = await client.uploadAttachment(issueKey, filePath);
  return uploaded[0]?.filename ?? basename(filePath);
}

function appendBlocks(body: string, blocks: string[]): string {
  const joined = blocks.filter(Boolean).join('\n\n');
  if (!joined) return body;
  return `${body.replace(/\s+$/, '')}\n\n${joined}\n`;
}

export async function prepareAttachments(
  client: JiraClient,
  issueKey: string,
  rawBody: string,
  opts: AttachOptions,
  dryRun: boolean
): Promise<PreparedAttachments> {
  const layout = resolveMediaLayout(opts);
  const specs = [...(opts.attachImages ?? []), ...(opts.attachMedia ?? [])].map(parseMediaSpec);
  const plainFiles = opts.attach ?? [];

  if (plainFiles.length === 0 && specs.length === 0) {
    return { body: rawBody, attachedNames: [], media: [], layout };
  }

  const attachedNames: string[] = [];
  const plainNames: string[] = [];
  for (const file of plainFiles) {
    const name = await uploadOrPreview(client, issueKey, file, dryRun);
    plainNames.push(name);
    attachedNames.push(name);
  }

  const media: EmbeddedMedia[] = [];
  for (const spec of specs) {
    const name = await uploadOrPreview(client, issueKey, spec.path, dryRun);
    attachedNames.push(name);
    const described = await describeMedia(spec.path, spec.caption, media.length);
    media.push({ ...described, filename: name, marker: mediaMarker(media.length) });
  }

  const placement = placeMediaMarkers(rawBody, media);
  reportWarnings(placement.warnings);
  const placed = new Set(placement.placed.map((item) => item.marker));
  const trailing = media.filter((item) => !placed.has(item.marker));

  return {
    body: appendBlocks(placement.body, [
      plainNames.map(embedForAttachment).join('\n'),
      buildMediaEmbedBlock(trailing),
    ]),
    attachedNames,
    media,
    layout,
  };
}
