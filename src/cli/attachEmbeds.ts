import { basename } from 'path';
import type { JiraClient } from '../lib/jiraClient.js';
import {
  applyMediaSingle,
  buildImageEmbedBlock,
  describeImage,
  imageMarker,
  isImageFile,
  parseImageLayout,
  parseImageSpec,
  parseImageWidth,
  type EmbeddedImage,
  type MediaLayoutOptions,
} from '../lib/adfMedia.js';

export type AttachOptions = {
  attach?: string[];
  attachImages?: string[];
  imageLayout?: string;
  imageWidth?: string;
};

export type PreparedAttachments = {
  body: string;
  attachedNames: string[];
  images: EmbeddedImage[];
  layout: MediaLayoutOptions;
};

export function previewImages(images: EmbeddedImage[], layout: MediaLayoutOptions) {
  return images.map((img) => ({
    filename: img.filename,
    caption: img.caption,
    layout: layout.layout,
    width: layout.width,
    pixels: img.size,
  }));
}

export function reportWarnings(warnings: string[]): void {
  for (const warning of warnings) console.warn(`Warning: ${warning}`);
}

export async function embedCommentImages(
  client: JiraClient,
  issueKey: string,
  commentId: string,
  images: EmbeddedImage[],
  layout: MediaLayoutOptions
): Promise<void> {
  const warnings = await applyMediaSingle(
    {
      get: async () => (await client.getComment(issueKey, commentId)).body,
      put: (doc) => client.updateCommentAdf(issueKey, commentId, doc),
    },
    images,
    layout
  );
  reportWarnings(warnings);
}

export async function embedDescriptionImages(
  client: JiraClient,
  issueKey: string,
  images: EmbeddedImage[],
  layout: MediaLayoutOptions
): Promise<void> {
  const warnings = await applyMediaSingle(
    {
      get: () => client.getIssueDescriptionAdf(issueKey),
      put: (doc) => client.updateIssueDescriptionAdf(issueKey, doc),
    },
    images,
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

export async function prepareAttachments(
  client: JiraClient,
  issueKey: string,
  rawBody: string,
  opts: AttachOptions,
  dryRun: boolean
): Promise<PreparedAttachments> {
  const layout = resolveMediaLayout(opts);
  const specs = (opts.attachImages ?? []).map(parseImageSpec);
  const imageSpecs = specs.filter((s) => isImageFile(s.path));
  const nonImageSpecs = specs.filter((s) => !isImageFile(s.path));
  const plainFiles = [...(opts.attach ?? []), ...nonImageSpecs.map((s) => s.path)];

  for (const spec of nonImageSpecs) {
    console.warn(
      `Warning: ${basename(spec.path)} is not an image — embedding it as an attachment card.`
    );
  }

  if (plainFiles.length === 0 && imageSpecs.length === 0) {
    return { body: rawBody, attachedNames: [], images: [], layout };
  }

  const attachedNames: string[] = [];
  const plainNames: string[] = [];
  for (const file of plainFiles) {
    const name = await uploadOrPreview(client, issueKey, file, dryRun);
    plainNames.push(name);
    attachedNames.push(name);
  }

  const images: EmbeddedImage[] = [];
  for (const spec of imageSpecs) {
    const name = await uploadOrPreview(client, issueKey, spec.path, dryRun);
    attachedNames.push(name);
    const described = describeImage(spec.path, spec.caption, images.length);
    images.push({ ...described, filename: name, marker: imageMarker(images.length) });
  }

  const blocks = [plainNames.map(embedForAttachment).join('\n'), buildImageEmbedBlock(images)]
    .filter(Boolean)
    .join('\n\n');

  return {
    body: `${rawBody.replace(/\s+$/, '')}\n\n${blocks}\n`,
    attachedNames,
    images,
    layout,
  };
}
