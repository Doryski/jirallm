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

describe('convertADFToMarkdown code blocks and headings', () => {
  const codeBlock = (body: string, language?: unknown) => ({
    type: 'codeBlock',
    attrs: language === undefined ? {} : { language },
    content: [text(body)],
  });

  it('lengthens the fence past the longest backtick run in the body', () => {
    const out = convertADFToMarkdown(doc(codeBlock('a\n```\n## Injected\n`````x')));
    expect(out).toBe('``````\na\n```\n## Injected\n`````x\n``````');
  });

  it('keeps a three-backtick fence for bodies without long runs', () => {
    expect(convertADFToMarkdown(doc(codeBlock('use `x` here', 'js')))).toBe(
      '```js\nuse `x` here\n```'
    );
  });

  it('drops a language attribute containing a newline or unsafe characters', () => {
    expect(convertADFToMarkdown(doc(codeBlock('x', 'ts\n## Injected')))).toBe('```\nx\n```');
    expect(convertADFToMarkdown(doc(codeBlock('x', 'a b')))).toBe('```\nx\n```');
    expect(convertADFToMarkdown(doc(codeBlock('x', 'a'.repeat(33))))).toBe('```\nx\n```');
    expect(convertADFToMarkdown(doc(codeBlock('x', 42)))).toBe('```\nx\n```');
  });

  it('keeps safe language tokens', () => {
    expect(convertADFToMarkdown(doc(codeBlock('x', 'c++')))).toBe('```c++\nx\n```');
    expect(convertADFToMarkdown(doc(codeBlock('x', 'objective-c.v2_#')))).toBe(
      '```objective-c.v2_#\nx\n```'
    );
  });

  it('clamps heading levels to 1-6', () => {
    const heading = (level: unknown) => ({
      type: 'heading',
      attrs: { level },
      content: [text('T')],
    });
    expect(convertADFToMarkdown(doc(heading(99)))).toBe('###### T');
    expect(convertADFToMarkdown(doc(heading(0)))).toBe('# T');
    expect(convertADFToMarkdown(doc(heading(-3)))).toBe('# T');
    expect(convertADFToMarkdown(doc(heading('3')))).toBe('# T');
    expect(convertADFToMarkdown(doc(heading(2.7)))).toBe('## T');
  });
});

describe('convertADFToMarkdown attachment links', () => {
  const media = (attrs: Record<string, unknown>) => paragraph({ type: 'media', attrs });

  it('sanitizes an unmatched alt before using it as an attachment path', () => {
    const out = convertADFToMarkdown(doc(media({ alt: '../../.ssh/id_rsa', id: 'm1' })));
    expect(out).toBe('[id_rsa](attachments/id_rsa)\n');
  });

  it('links matched attachments by their sanitized on-disk name', () => {
    const out = convertADFToMarkdown(doc(media({ alt: '../evil.png' })), [
      { id: '1', filename: '../evil.png' },
    ]);
    expect(out).toBe('![image](attachments/evil.png)\n');
  });

  it('links duplicate filenames to the deduplicated names used on disk', () => {
    const out = convertADFToMarkdown(doc(media({}), media({})), [
      { id: '1', filename: 'shot.png' },
      { id: '2', filename: 'Shot.png' },
    ]);
    expect(out).toBe('![image](attachments/shot.png)\n\n![image](attachments/Shot-1.png)\n');
  });

  it('uses sanitized names for card links matched by attachment id', () => {
    const out = convertADFToMarkdown(
      doc(paragraph({ type: 'inlineCard', attrs: { url: 'https://x/attachment/55' } })),
      [{ id: '55', filename: 'a/..\\report<1>.pdf', url: 'https://x/attachment/55' }]
    );
    expect(out).toBe('[report_1_.pdf](attachments/report_1_.pdf)\n');
  });

  it('strips path characters from embedded media ids', () => {
    expect(convertADFToMarkdown(doc(media({ id: '../../x' })))).toBe(
      '![embedded media](media/x)\n'
    );
  });
});
