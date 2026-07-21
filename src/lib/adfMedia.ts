import { isVideoFile } from 'framewise';
import { readImageSize, type ImageSize } from './imageSize.js';
import { readVideoSize } from './videoSize.js';

export type AdfMark = { type: string; attrs?: Record<string, unknown> };

export type AdfNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  marks?: AdfMark[];
  text?: string;
};

export type AdfDocument = {
  version: number;
  type: string;
  content: AdfNode[];
};

export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']);

export const IMAGE_LAYOUTS = [
  'center',
  'align-start',
  'align-end',
  'wrap-left',
  'wrap-right',
  'wide',
  'full-width',
] as const;

export type ImageLayout = (typeof IMAGE_LAYOUTS)[number];

export const DEFAULT_IMAGE_LAYOUT: ImageLayout = 'align-start';
export const DEFAULT_IMAGE_WIDTH = 50;

export const MEDIA_KINDS = ['image', 'video', 'file'] as const;

export type MediaKind = (typeof MEDIA_KINDS)[number];

export type MediaSpec = { path: string; caption?: string };

export type EmbeddedMedia = {
  marker: string;
  filename: string;
  source: string;
  kind: MediaKind;
  caption?: string;
  size?: ImageSize;
};

export type MediaLayoutOptions = { layout: ImageLayout; width: number };

export function isImageFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(ext);
}

export function mediaKind(filename: string): MediaKind {
  if (isImageFile(filename)) return 'image';
  if (isVideoFile(filename)) return 'video';
  return 'file';
}

/** Images and videos get sized inline; everything else renders as a compact tile. */
export function isSizedMedia(kind: MediaKind): boolean {
  return kind !== 'file';
}

export function parseImageLayout(value?: string): ImageLayout {
  if (value === undefined) return DEFAULT_IMAGE_LAYOUT;
  const match = IMAGE_LAYOUTS.find((l) => l === value);
  if (!match) {
    throw new Error(
      `Invalid --image-layout "${value}". Allowed values: ${IMAGE_LAYOUTS.join(', ')}.`
    );
  }
  return match;
}

export function parseImageWidth(value?: string): number {
  if (value === undefined) return DEFAULT_IMAGE_WIDTH;
  const width = Number(value);
  if (!Number.isInteger(width) || width < 1 || width > 100) {
    throw new Error(`Invalid --image-width "${value}". Expected an integer between 1 and 100.`);
  }
  return width;
}

export function parseMediaSpec(spec: string): MediaSpec {
  const match = /^(.*?):"([\s\S]*)"$/.exec(spec);
  if (!match) return { path: spec };
  const [, path, caption] = match;
  if (!path) return { path: spec };
  return caption ? { path, caption } : { path };
}

export function mediaMarker(index: number): string {
  return `⟦jirallm-media-${index}⟧`;
}

function basename(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

async function readMediaSize(filePath: string, kind: MediaKind): Promise<ImageSize | undefined> {
  if (kind === 'image') return readImageSize(filePath);
  if (kind === 'video') return readVideoSize(filePath);
  return undefined;
}

export async function describeMedia(
  filePath: string,
  caption: string | undefined,
  index: number
): Promise<EmbeddedMedia> {
  const kind = mediaKind(filePath);
  const size = await readMediaSize(filePath, kind);
  return { marker: mediaMarker(index), filename: basename(filePath), source: filePath, kind, caption, size };
}

export function buildMediaEmbedBlock(media: EmbeddedMedia[]): string {
  return media.map((item) => `${item.marker}\n\n[^${item.filename}]`).join('\n\n');
}

/**
 * Positional placeholder the author writes in the body, e.g. `@@media:demo.webm@@`.
 * Deliberately punctuation that survives both markdown→wiki conversion and `--no-wiki`.
 */
const PLACEHOLDER_PATTERN = /^[^\S\n]*@@media:([^@\n]+)@@[^\S\n]*$/gm;

export type PlacementResult = { body: string; placed: EmbeddedMedia[]; warnings: string[] };

function matchesPlaceholder(item: EmbeddedMedia, name: string): boolean {
  const wanted = name.trim().toLowerCase();
  return (
    item.filename.toLowerCase() === wanted ||
    item.source.toLowerCase() === wanted ||
    basename(item.source).toLowerCase() === wanted
  );
}

/** Replaces `@@media:<name>@@` placeholder lines with the embed block for that file. */
export function placeMediaMarkers(body: string, media: EmbeddedMedia[]): PlacementResult {
  const placed: EmbeddedMedia[] = [];
  const warnings: string[] = [];
  const available = [...media];

  const replaced = body.replace(PLACEHOLDER_PATTERN, (match, name: string) => {
    const index = available.findIndex((item) => matchesPlaceholder(item, name));
    if (index === -1) {
      warnings.push(`No attached file matches placeholder "@@media:${name.trim()}@@" — left as text.`);
      return match;
    }
    const [item] = available.splice(index, 1);
    placed.push(item);
    return buildMediaEmbedBlock([item]);
  });

  return { body: replaced, placed, warnings };
}

function paragraphText(node: AdfNode): string {
  if (node.type !== 'paragraph') return '';
  return (node.content ?? []).map((child) => child.text ?? '').join('').trim();
}

function mediaChildren(node: AdfNode): AdfNode[] {
  if (node.type !== 'mediaGroup' && node.type !== 'mediaSingle') return [];
  return (node.content ?? []).filter((child) => child.type === 'media');
}

function buildMediaNode(media: AdfNode, item: EmbeddedMedia): AdfNode {
  const attrs: Record<string, unknown> = {
    type: media.attrs?.type ?? 'file',
    id: media.attrs?.id,
    collection: media.attrs?.collection ?? '',
  };
  const width = item.size?.width ?? media.attrs?.width;
  const height = item.size?.height ?? media.attrs?.height;
  if (width !== undefined && height !== undefined) {
    attrs.width = width;
    attrs.height = height;
  }
  return { type: 'media', attrs };
}

function buildMediaSingle(
  media: AdfNode,
  item: EmbeddedMedia,
  options: MediaLayoutOptions
): AdfNode {
  return {
    type: 'mediaSingle',
    attrs: { layout: options.layout, width: options.width },
    content: [buildMediaNode(media, item)],
  };
}

function buildCaptionParagraph(caption: string): AdfNode {
  return {
    type: 'paragraph',
    content: [{ type: 'text', text: caption, marks: [{ type: 'em' }] }],
  };
}

export type RewriteResult = { doc: AdfDocument; warnings: string[]; replaced: number };

export function rewriteAdfMedia(
  doc: AdfDocument,
  media: EmbeddedMedia[],
  options: MediaLayoutOptions
): RewriteResult {
  const byMarker = new Map(media.map((item) => [item.marker, item]));
  const seen = new Set<string>();
  const warnings: string[] = [];
  const content: AdfNode[] = [];
  let replaced = 0;
  let openTile: AdfNode | undefined;

  const nodes = doc.content ?? [];
  for (let i = 0; i < nodes.length; i++) {
    const item = byMarker.get(paragraphText(nodes[i]));
    if (!item) {
      openTile = undefined;
      content.push(nodes[i]);
      continue;
    }
    seen.add(item.marker);
    const next = nodes[i + 1];
    const found = next ? mediaChildren(next) : [];
    if (found.length === 0) {
      openTile = undefined;
      warnings.push(`No media node found for "${item.filename}" — left unchanged.`);
      continue;
    }

    const node = buildMediaNode(found[0], item);
    if (isSizedMedia(item.kind)) {
      openTile = undefined;
      content.push(buildMediaSingle(found[0], item, options));
    } else if (openTile) {
      openTile.content = [...(openTile.content ?? []), node];
    } else {
      openTile = { type: 'mediaGroup', content: [node] };
      content.push(openTile);
    }

    if (item.caption) {
      openTile = undefined;
      content.push(buildCaptionParagraph(item.caption));
    }
    const rest = found.slice(1);
    if (rest.length > 0) {
      openTile = undefined;
      content.push({ ...next, content: rest });
    }
    replaced++;
    i++;
  }

  for (const item of media) {
    if (!seen.has(item.marker)) {
      warnings.push(`Marker for "${item.filename}" not found in the published content.`);
    }
  }

  return { doc: { ...doc, content }, warnings, replaced };
}

export function containsMarkers(text: string, media: EmbeddedMedia[]): boolean {
  return media.some((item) => text.includes(item.marker));
}

export function isAdfDocument(value: unknown): value is AdfDocument {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as AdfDocument).type === 'doc' &&
    Array.isArray((value as AdfDocument).content)
  );
}

export async function applyMediaSingle(
  io: { get: () => Promise<unknown>; put: (doc: AdfDocument) => Promise<void> },
  media: EmbeddedMedia[],
  options: MediaLayoutOptions
): Promise<string[]> {
  if (media.length === 0) return [];
  const body = await io.get();
  if (!isAdfDocument(body)) {
    return ['Jira did not return an ADF document — media left as attachment cards.'];
  }
  const { doc, warnings, replaced } = rewriteAdfMedia(body, media, options);
  if (replaced > 0) await io.put(doc);
  return warnings;
}
