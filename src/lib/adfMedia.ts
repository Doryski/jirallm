import { readImageSize, type ImageSize } from './imageSize.js';

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

export type ImageSpec = { path: string; caption?: string };

export type EmbeddedImage = {
  marker: string;
  filename: string;
  caption?: string;
  size?: ImageSize;
};

export type MediaLayoutOptions = { layout: ImageLayout; width: number };

export function isImageFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(ext);
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

export function parseImageSpec(spec: string): ImageSpec {
  const match = /^(.*?):"([\s\S]*)"$/.exec(spec);
  if (!match) return { path: spec };
  const [, path, caption] = match;
  if (!path) return { path: spec };
  return caption ? { path, caption } : { path };
}

export function imageMarker(index: number): string {
  return `⟦jirallm-img-${index}⟧`;
}

export function describeImage(filePath: string, caption: string | undefined, index: number): EmbeddedImage {
  const filename = filePath.split(/[\\/]/).pop() ?? filePath;
  const size = readImageSize(filePath);
  return { marker: imageMarker(index), filename, caption, size };
}

export function buildImageEmbedBlock(images: EmbeddedImage[]): string {
  return images.map((img) => `${img.marker}\n\n[^${img.filename}]`).join('\n\n');
}

function paragraphText(node: AdfNode): string {
  if (node.type !== 'paragraph') return '';
  return (node.content ?? []).map((child) => child.text ?? '').join('').trim();
}

function mediaChildren(node: AdfNode): AdfNode[] {
  if (node.type !== 'mediaGroup' && node.type !== 'mediaSingle') return [];
  return (node.content ?? []).filter((child) => child.type === 'media');
}

function buildMediaSingle(
  media: AdfNode,
  image: EmbeddedImage,
  options: MediaLayoutOptions
): AdfNode {
  const attrs: Record<string, unknown> = {
    type: media.attrs?.type ?? 'file',
    id: media.attrs?.id,
    collection: media.attrs?.collection ?? '',
  };
  const width = image.size?.width ?? media.attrs?.width;
  const height = image.size?.height ?? media.attrs?.height;
  if (width !== undefined && height !== undefined) {
    attrs.width = width;
    attrs.height = height;
  }
  return {
    type: 'mediaSingle',
    attrs: { layout: options.layout, width: options.width },
    content: [{ type: 'media', attrs }],
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
  images: EmbeddedImage[],
  options: MediaLayoutOptions
): RewriteResult {
  const byMarker = new Map(images.map((img) => [img.marker, img]));
  const seen = new Set<string>();
  const warnings: string[] = [];
  const content: AdfNode[] = [];
  let replaced = 0;

  const nodes = doc.content ?? [];
  for (let i = 0; i < nodes.length; i++) {
    const image = byMarker.get(paragraphText(nodes[i]));
    if (!image) {
      content.push(nodes[i]);
      continue;
    }
    seen.add(image.marker);
    const next = nodes[i + 1];
    const media = next ? mediaChildren(next) : [];
    if (media.length === 0) {
      warnings.push(`No media node found for "${image.filename}" — left unchanged.`);
      continue;
    }
    content.push(buildMediaSingle(media[0], image, options));
    if (image.caption) content.push(buildCaptionParagraph(image.caption));
    const rest = media.slice(1);
    if (rest.length > 0) content.push({ ...next, content: rest });
    replaced++;
    i++;
  }

  for (const image of images) {
    if (!seen.has(image.marker)) {
      warnings.push(`Marker for "${image.filename}" not found in the published content.`);
    }
  }

  return { doc: { ...doc, content }, warnings, replaced };
}

export function containsMarkers(text: string, images: EmbeddedImage[]): boolean {
  return images.some((img) => text.includes(img.marker));
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
  images: EmbeddedImage[],
  options: MediaLayoutOptions
): Promise<string[]> {
  if (images.length === 0) return [];
  const body = await io.get();
  if (!isAdfDocument(body)) {
    return ['Jira did not return an ADF document — images left as attachment cards.'];
  }
  const { doc, warnings, replaced } = rewriteAdfMedia(body, images, options);
  if (replaced > 0) await io.put(doc);
  return warnings;
}
