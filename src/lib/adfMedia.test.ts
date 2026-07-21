import { describe, expect, it } from 'vitest';
import {
  applyMediaSingle,
  buildMediaEmbedBlock,
  containsMarkers,
  mediaMarker,
  isImageFile,
  mediaKind,
  parseImageLayout,
  parseMediaSpec,
  parseImageWidth,
  placeMediaMarkers,
  rewriteAdfMedia,
  type AdfDocument,
  type AdfNode,
  type EmbeddedMedia,
} from './adfMedia.js';

const LAYOUT = { layout: 'align-start', width: 50 } as const;

function image(overrides: Partial<EmbeddedMedia> = {}): EmbeddedMedia {
  return { marker: mediaMarker(0), filename: 'shot.png', source: 'shot.png', kind: 'image', ...overrides };
}

function markerParagraph(index = 0): AdfNode {
  return { type: 'paragraph', content: [{ type: 'text', text: mediaMarker(index) }] };
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

describe('parseMediaSpec', () => {
  it('returns the bare path when no caption is given', () => {
    expect(parseMediaSpec('shot.png')).toEqual({ path: 'shot.png' });
  });

  it('parses a quoted caption', () => {
    expect(parseMediaSpec('shot.png:"Nowe pole"')).toEqual({
      path: 'shot.png',
      caption: 'Nowe pole',
    });
  });

  it('keeps colons and Polish characters inside the caption', () => {
    expect(parseMediaSpec('a/b/shot.png:"Krok 2: zażółć gęślą jaźń"')).toEqual({
      path: 'a/b/shot.png',
      caption: 'Krok 2: zażółć gęślą jaźń',
    });
  });

  it('treats a colon without a quoted caption as part of the path', () => {
    expect(parseMediaSpec('C:/tmp/shot.png')).toEqual({ path: 'C:/tmp/shot.png' });
  });

  it('ignores an empty caption', () => {
    expect(parseMediaSpec('shot.png:""')).toEqual({ path: 'shot.png' });
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

describe('buildMediaEmbedBlock', () => {
  it('emits a marker paragraph before each attachment embed', () => {
    const images = [image(), image({ marker: mediaMarker(1), filename: 'b.png' })];
    expect(buildMediaEmbedBlock(images)).toBe(
      `${mediaMarker(0)}\n\n[^shot.png]\n\n${mediaMarker(1)}\n\n[^b.png]`
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
    const images = [image(), image({ marker: mediaMarker(1), filename: 'b.png', caption: 'B' })];
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

describe('video and non-media kinds', () => {
  it('sizes a video inline as a mediaSingle', () => {
    const video = image({
      filename: 'demo.webm',
      source: 'demo.webm',
      kind: 'video',
      size: { width: 1280, height: 720 },
    });
    const result = rewriteAdfMedia(doc(markerParagraph(), mediaGroup('uuid-v')), [video], LAYOUT);

    expect(result.replaced).toBe(1);
    expect(result.doc.content[0]).toEqual({
      type: 'mediaSingle',
      attrs: { layout: 'align-start', width: 50 },
      content: [
        {
          type: 'media',
          attrs: { type: 'file', id: 'uuid-v', collection: '', width: 1280, height: 720 },
        },
      ],
    });
  });

  it('renders a non-media file as a compact mediaGroup tile, not a mediaSingle', () => {
    const log = image({ filename: 'app.log', source: 'app.log', kind: 'file' });
    const result = rewriteAdfMedia(doc(markerParagraph(), mediaGroup('uuid-f')), [log], LAYOUT);

    expect(result.doc.content).toEqual([
      {
        type: 'mediaGroup',
        content: [{ type: 'media', attrs: { type: 'file', id: 'uuid-f', collection: '' } }],
      },
    ]);
  });

  it('merges consecutive non-media tiles into one mediaGroup', () => {
    const files = [
      image({ filename: 'a.log', source: 'a.log', kind: 'file' }),
      image({ marker: mediaMarker(1), filename: 'b.har', source: 'b.har', kind: 'file' }),
    ];
    const result = rewriteAdfMedia(
      doc(markerParagraph(0), mediaGroup('a'), markerParagraph(1), mediaGroup('b')),
      files,
      LAYOUT
    );

    expect(result.replaced).toBe(2);
    expect(result.doc.content).toHaveLength(1);
    expect(result.doc.content[0].content?.map((n) => n.attrs?.id)).toEqual(['a', 'b']);
  });

  it('breaks the tile group when a captioned file sits between two others', () => {
    const files = [
      image({ filename: 'a.log', source: 'a.log', kind: 'file', caption: 'first' }),
      image({ marker: mediaMarker(1), filename: 'b.har', source: 'b.har', kind: 'file' }),
    ];
    const result = rewriteAdfMedia(
      doc(markerParagraph(0), mediaGroup('a'), markerParagraph(1), mediaGroup('b')),
      files,
      LAYOUT
    );

    expect(result.doc.content.map((n) => n.type)).toEqual(['mediaGroup', 'paragraph', 'mediaGroup']);
  });

  it('classifies media by extension', () => {
    expect(mediaKind('a.PNG')).toBe('image');
    expect(mediaKind('clip.webm')).toBe('video');
    expect(mediaKind('trace.har')).toBe('file');
  });
});

describe('placeMediaMarkers', () => {
  const shot = image({ filename: 'shot.png', source: './shots/shot.png' });

  it('replaces a standalone placeholder line with the embed block', () => {
    const result = placeMediaMarkers('before\n\n@@media:shot.png@@\n\nafter', [shot]);

    expect(result.body).toBe(`before\n\n${mediaMarker(0)}\n\n[^shot.png]\n\nafter`);
    expect(result.placed).toEqual([shot]);
    expect(result.warnings).toEqual([]);
  });

  it('matches the placeholder against the path given on the command line', () => {
    const result = placeMediaMarkers('@@media:./shots/shot.png@@', [shot]);
    expect(result.placed).toEqual([shot]);
  });

  it('leaves media without a placeholder unplaced', () => {
    const result = placeMediaMarkers('no placeholder here', [shot]);
    expect(result.placed).toEqual([]);
    expect(result.body).toBe('no placeholder here');
  });

  it('warns and keeps the text when nothing matches the placeholder', () => {
    const result = placeMediaMarkers('@@media:missing.png@@', [shot]);

    expect(result.body).toBe('@@media:missing.png@@');
    expect(result.warnings[0]).toMatch(/No attached file matches placeholder "@@media:missing.png@@"/);
  });

  it('ignores a placeholder embedded inside a sentence', () => {
    const result = placeMediaMarkers('see @@media:shot.png@@ above', [shot]);
    expect(result.placed).toEqual([]);
    expect(result.body).toBe('see @@media:shot.png@@ above');
  });

  it('consumes each file once so repeated placeholders do not duplicate it', () => {
    const result = placeMediaMarkers('@@media:shot.png@@\n\n@@media:shot.png@@', [shot]);

    expect(result.placed).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });
});

describe('helpers', () => {
  it('detects image extensions case-insensitively', () => {
    expect(isImageFile('a.PNG')).toBe(true);
    expect(isImageFile('a.txt')).toBe(false);
  });

  it('finds markers in a rendered body', () => {
    expect(containsMarkers(`x ${mediaMarker(0)} y`, [image()])).toBe(true);
    expect(containsMarkers('x y', [image()])).toBe(false);
  });
});
