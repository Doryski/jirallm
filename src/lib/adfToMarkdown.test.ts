import { describe, expect, it } from 'vitest';
import { convertADFToMarkdown } from './adfToMarkdown.js';

function doc(...content: unknown[]): never {
  return { version: 1, type: 'doc', content } as never;
}

function paragraph(...content: unknown[]): unknown {
  return { type: 'paragraph', content };
}

function text(value: string, marks?: unknown[]): unknown {
  return marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
}

describe('convertADFToMarkdown malformed nodes', () => {
  it('skips null and undefined children without throwing', () => {
    expect(convertADFToMarkdown(doc(null))).toBe('');
    expect(convertADFToMarkdown(doc(undefined))).toBe('');
  });

  it('renders valid nodes when malformed siblings are mixed in', () => {
    const out = convertADFToMarkdown(
      doc(paragraph(text('first')), null, paragraph(text('second')), undefined)
    );
    expect(out).toBe('first\n\nsecond\n');
  });

  it('skips non-object children', () => {
    expect(convertADFToMarkdown(doc('string', 42, true))).toBe('');
    expect(convertADFToMarkdown(doc('string', paragraph(text('kept')), 42))).toBe('kept\n');
  });

  it('skips nodes that carry no usable type', () => {
    expect(convertADFToMarkdown(doc({ content: [text('orphan')] }))).toBe('');
    expect(convertADFToMarkdown(doc({ type: 7, text: 'orphan' }))).toBe('');
  });

  it('treats a non-array content value as no content', () => {
    expect(convertADFToMarkdown(doc({ type: 'paragraph', content: 'oops' }))).toBe('');
    expect(convertADFToMarkdown(doc({ type: 'heading', attrs: { level: 2 }, content: 3 }))).toBe(
      ''
    );
  });

  it('returns an empty string when the document content is missing or not an array', () => {
    expect(convertADFToMarkdown({ version: 1, type: 'doc' } as never)).toBe('');
    expect(convertADFToMarkdown({ version: 1, type: 'doc', content: 'nope' } as never)).toBe('');
    expect(convertADFToMarkdown({ version: 1, type: 'doc', content: null } as never)).toBe('');
  });

  it('returns an empty string for a table with no table rows', () => {
    expect(convertADFToMarkdown(doc({ type: 'table', content: [] }))).toBe('');
    expect(convertADFToMarkdown(doc({ type: 'table', content: [null, 'junk'] }))).toBe('');
    expect(
      convertADFToMarkdown(doc({ type: 'table', content: [paragraph(text('stray'))] }))
    ).toBe('');
  });

  it('skips malformed cells and rows inside an otherwise valid table', () => {
    const cell = (value: string) => ({ type: 'tableCell', content: [paragraph(text(value))] });
    const out = convertADFToMarkdown(
      doc({
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('H1'), cell('H2')] },
          null,
          { type: 'tableRow', content: [cell('a'), null, cell('b')] },
          { type: 'tableRow', content: 'oops' },
        ],
      })
    );
    expect(out).toBe('| H1 | H2 |\n| --- | --- |\n| a | b |\n|  |');
  });

  it('skips a malformed node nested deep inside a list', () => {
    const out = convertADFToMarkdown(
      doc({
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [paragraph(text('a')), null] },
          null,
          { type: 'listItem', content: [paragraph(text('b'))] },
        ],
      })
    );
    expect(out).toBe('- a\n- b');
  });

  it('skips malformed marks on a text node', () => {
    const out = convertADFToMarkdown(
      doc(paragraph(text('bold', [null, { type: 'strong' }, 'junk'])))
    );
    expect(out).toBe('**bold**\n');
  });

  it('still renders a well-formed document unchanged', () => {
    const cell = (value: string) => ({ type: 'tableCell', content: [paragraph(text(value))] });
    const out = convertADFToMarkdown(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('Title')] },
        paragraph(text('intro '), text('bold', [{ type: 'strong' }])),
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [paragraph(text('one'))] },
            { type: 'listItem', content: [paragraph(text('two'))] },
          ],
        },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const a = 1;')] },
        {
          type: 'table',
          content: [
            { type: 'tableRow', content: [cell('H1'), cell('H2')] },
            { type: 'tableRow', content: [cell('a'), cell('b')] },
          ],
        }
      )
    );
    expect(out).toBe(
      [
        '## Title',
        'intro **bold**\n',
        '- one\n- two',
        '```ts\nconst a = 1;\n```',
        '| H1 | H2 |\n| --- | --- |\n| a | b |',
      ].join('\n')
    );
  });

  it('keeps positional attachment fallback stable when malformed nodes are present', () => {
    const attachments = [
      { id: '1', filename: 'first.png' },
      { id: '2', filename: 'second.png' },
    ];
    const out = convertADFToMarkdown(
      doc(
        paragraph({ type: 'media', attrs: {} }),
        null,
        paragraph({ type: 'media', attrs: {} })
      ),
      attachments
    );
    expect(out).toBe('![image](attachments/first.png)\n\n![image](attachments/second.png)\n');
  });
});
