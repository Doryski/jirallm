import { describe, expect, it } from 'vitest';
import {
  applyMediaSingle,
  buildImageEmbedBlock,
  containsMarkers,
  imageMarker,
  isImageFile,
  parseImageLayout,
  parseImageSpec,
  parseImageWidth,
  rewriteAdfMedia,
  type AdfDocument,
  type AdfNode,
  type EmbeddedImage,
} from './adfMedia.js';

const LAYOUT = { layout: 'align-start', width: 50 } as const;

function image(overrides: Partial<EmbeddedImage> = {}): EmbeddedImage {
  return { marker: imageMarker(0), filename: 'shot.png', ...overrides };
}

function markerParagraph(index = 0): AdfNode {
  return { type: 'paragraph', content: [{ type: 'text', text: imageMarker(index) }] };
}

function mediaGroup(id: string): AdfNode {
  return {
    type: 'mediaGroup',
    content: [{ type: 'media', attrs: { type: 'file', id, collection: '' } }],
  };
}

function doc(...content: AdfNode[]): AdfDocument {
  return { version: 1, type: 'doc', content };
}

describe('parseImageSpec', () => {
  it('returns the bare path when no caption is given', () => {
    expect(parseImageSpec('shot.png')).toEqual({ path: 'shot.png' });
  });

  it('parses a quoted caption', () => {
    expect(parseImageSpec('shot.png:"Nowe pole"')).toEqual({
      path: 'shot.png',
      caption: 'Nowe pole',
    });
  });

  it('keeps colons and Polish characters inside the caption', () => {
    expect(parseImageSpec('a/b/shot.png:"Krok 2: zażółć gęślą jaźń"')).toEqual({
      path: 'a/b/shot.png',
      caption: 'Krok 2: zażółć gęślą jaźń',
    });
  });

  it('treats a colon without a quoted caption as part of the path', () => {
    expect(parseImageSpec('C:/tmp/shot.png')).toEqual({ path: 'C:/tmp/shot.png' });
  });

  it('ignores an empty caption', () => {
    expect(parseImageSpec('shot.png:""')).toEqual({ path: 'shot.png' });
  });
});

describe('parseImageLayout / parseImageWidth', () => {
  it('defaults to align-start / 50', () => {
    expect(parseImageLayout(undefined)).toBe('align-start');
    expect(parseImageWidth(undefined)).toBe(50);
  });

  it('accepts every documented layout', () => {
    expect(parseImageLayout('full-width')).toBe('full-width');
    expect(parseImageLayout('wrap-right')).toBe('wrap-right');
  });

  it('rejects an unknown layout with a readable error', () => {
    expect(() => parseImageLayout('sideways')).toThrow(/Invalid --image-layout "sideways"/);
    expect(() => parseImageLayout('sideways')).toThrow(/align-start/);
  });

  it('rejects widths outside 1-100 and non-integers', () => {
    expect(() => parseImageWidth('0')).toThrow(/between 1 and 100/);
    expect(() => parseImageWidth('101')).toThrow(/between 1 and 100/);
    expect(() => parseImageWidth('abc')).toThrow(/between 1 and 100/);
    expect(() => parseImageWidth('50.5')).toThrow(/between 1 and 100/);
  });
});

describe('buildImageEmbedBlock', () => {
  it('emits a marker paragraph before each attachment embed', () => {
    const images = [image(), image({ marker: imageMarker(1), filename: 'b.png' })];
    expect(buildImageEmbedBlock(images)).toBe(
      `${imageMarker(0)}\n\n[^shot.png]\n\n${imageMarker(1)}\n\n[^b.png]`
    );
  });
});

describe('rewriteAdfMedia', () => {
  it('replaces the marker + mediaGroup pair with a mediaSingle carrying layout attrs', () => {
    const result = rewriteAdfMedia(doc(markerParagraph(), mediaGroup('uuid-1')), [image()], LAYOUT);

    expect(result.replaced).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(result.doc.content).toEqual([
      {
        type: 'mediaSingle',
        attrs: { layout: 'align-start', width: 50 },
        content: [{ type: 'media', attrs: { type: 'file', id: 'uuid-1', collection: '' } }],
      },
    ]);
  });

  it('carries pixel dimensions into the media node when known', () => {
    const result = rewriteAdfMedia(
      doc(markerParagraph(), mediaGroup('uuid-1')),
      [image({ size: { width: 3456, height: 2080 } })],
      LAYOUT
    );

    expect(result.doc.content[0].content?.[0].attrs).toEqual({
      type: 'file',
      id: 'uuid-1',
      collection: '',
      width: 3456,
      height: 2080,
    });
  });

  it('adds the caption as an em paragraph AFTER the media, never as a caption node', () => {
    const result = rewriteAdfMedia(
      doc(markerParagraph(), mediaGroup('uuid-1')),
      [image({ caption: 'Co pokazuje zrzut' })],
      LAYOUT
    );

    expect(result.doc.content[1]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Co pokazuje zrzut', marks: [{ type: 'em' }] }],
    });
    expect(JSON.stringify(result.doc)).not.toContain('"caption"');
  });

  it('omits the caption paragraph when no caption was given', () => {
    const result = rewriteAdfMedia(doc(markerParagraph(), mediaGroup('uuid-1')), [image()], LAYOUT);
    expect(result.doc.content).toHaveLength(1);
  });

  it('leaves a mediaGroup of non-image attachment cards untouched', () => {
    const cards = mediaGroup('uuid-file');
    const result = rewriteAdfMedia(
      doc(markerParagraph(), mediaGroup('uuid-1'), cards),
      [image()],
      LAYOUT
    );

    expect(result.doc.content[1]).toBe(cards);
  });

  it('preserves tables and code blocks', () => {
    const table: AdfNode = { type: 'table', content: [{ type: 'tableRow' }] };
    const code: AdfNode = { type: 'codeBlock', attrs: { language: 'ts' } };
    const result = rewriteAdfMedia(
      doc(table, code, markerParagraph(), mediaGroup('uuid-1')),
      [image()],
      LAYOUT
    );

    expect(result.doc.content[0]).toBe(table);
    expect(result.doc.content[1]).toBe(code);
    expect(result.doc.content[2].type).toBe('mediaSingle');
  });

  it('warns and changes nothing when the marker is missing', () => {
    const original = doc({ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] });
    const result = rewriteAdfMedia(original, [image()], LAYOUT);

    expect(result.replaced).toBe(0);
    expect(result.doc.content).toEqual(original.content);
    expect(result.warnings[0]).toMatch(/Marker for "shot.png" not found/);
  });

  it('warns and drops the marker when no media node follows it', () => {
    const result = rewriteAdfMedia(doc(markerParagraph()), [image()], LAYOUT);

    expect(result.replaced).toBe(0);
    expect(result.doc.content).toEqual([]);
    expect(result.warnings[0]).toMatch(/No media node found for "shot.png"/);
  });

  it('handles several images independently', () => {
    const images = [image(), image({ marker: imageMarker(1), filename: 'b.png', caption: 'B' })];
    const result = rewriteAdfMedia(
      doc(markerParagraph(0), mediaGroup('a'), markerParagraph(1), mediaGroup('b')),
      images,
      { layout: 'center', width: 80 }
    );

    expect(result.replaced).toBe(2);
    expect(result.doc.content.map((n) => n.type)).toEqual([
      'mediaSingle',
      'mediaSingle',
      'paragraph',
    ]);
    expect(result.doc.content[0].attrs).toEqual({ layout: 'center', width: 80 });
  });
});

describe('applyMediaSingle', () => {
  it('does nothing when there are no images', async () => {
    const get = async () => doc();
    const put = async () => {
      throw new Error('should not be called');
    };
    expect(await applyMediaSingle({ get, put }, [], LAYOUT)).toEqual([]);
  });

  it('writes back the rewritten document', async () => {
    const written: AdfDocument[] = [];
    const warnings = await applyMediaSingle(
      {
        get: async () => doc(markerParagraph(), mediaGroup('uuid-1')),
        put: async (d) => {
          written.push(d);
        },
      },
      [image()],
      LAYOUT
    );

    expect(warnings).toEqual([]);
    expect(written[0].content[0].type).toBe('mediaSingle');
  });

  it('warns instead of throwing when Jira returns a non-ADF body', async () => {
    const warnings = await applyMediaSingle(
      {
        get: async () => 'plain wiki text',
        put: async () => {
          throw new Error('should not be called');
        },
      },
      [image()],
      LAYOUT
    );

    expect(warnings[0]).toMatch(/did not return an ADF document/);
  });
});

describe('helpers', () => {
  it('detects image extensions case-insensitively', () => {
    expect(isImageFile('a.PNG')).toBe(true);
    expect(isImageFile('a.txt')).toBe(false);
  });

  it('finds markers in a rendered body', () => {
    expect(containsMarkers(`x ${imageMarker(0)} y`, [image()])).toBe(true);
    expect(containsMarkers('x y', [image()])).toBe(false);
  });
});
