import { describe, it, expect } from 'vitest';
import { markdownToWiki } from './markdownToWiki.js';

describe('markdownToWiki — headings', () => {
  it.each([
    ['# H1', 'h1. H1'],
    ['## H2', 'h2. H2'],
    ['### H3', 'h3. H3'],
    ['#### H4', 'h4. H4'],
    ['##### H5', 'h5. H5'],
    ['###### H6', 'h6. H6'],
  ])('converts %j → %j', (md, wiki) => {
    expect(markdownToWiki(md)).toBe(wiki);
  });

  it('does not match #hashtag without space', () => {
    expect(markdownToWiki('#hashtag')).toBe('#hashtag');
  });
});

describe('markdownToWiki — inline formatting', () => {
  it('converts bold **text** to *text*', () => {
    expect(markdownToWiki('**bold**')).toBe('*bold*');
  });

  it('converts italic *text* to _text_', () => {
    expect(markdownToWiki('an *italic* word')).toBe('an _italic_ word');
  });

  it('converts italic _text_ to _text_', () => {
    expect(markdownToWiki('an _italic_ word')).toBe('an _italic_ word');
  });

  it('does not convert italic inside bold-converted output', () => {
    expect(markdownToWiki('**bold word**')).toBe('*bold word*');
  });

  it('converts strikethrough ~~text~~ to -text-', () => {
    expect(markdownToWiki('~~struck~~')).toBe('-struck-');
  });

  it('converts links [text](url)', () => {
    expect(markdownToWiki('see [docs](https://example.com)')).toBe('see [docs|https://example.com]');
  });

  it('handles bold and italic in same paragraph', () => {
    expect(markdownToWiki('**bold** and *italic*')).toBe('*bold* and _italic_');
  });
});

describe('markdownToWiki — code', () => {
  it('converts inline code', () => {
    expect(markdownToWiki('use `foo()` here')).toBe('use {{foo()}} here');
  });

  it('converts fenced code block with language', () => {
    expect(markdownToWiki('```ts\nconst x = 1;\n```')).toBe('{code:ts}\nconst x = 1;\n{code}');
  });

  it('converts fenced code block without language', () => {
    expect(markdownToWiki('```\nplain\n```')).toBe('{code}\nplain\n{code}');
  });

  it('does not apply inline formatting inside code blocks', () => {
    expect(markdownToWiki('```\n**not bold**\n```')).toBe('{code}\n**not bold**\n{code}');
  });

  it('does not apply inline formatting inside inline code', () => {
    expect(markdownToWiki('text `**raw**` here')).toBe('text {{**raw**}} here');
  });
});

describe('markdownToWiki — lists', () => {
  it('converts bullet list', () => {
    expect(markdownToWiki('- one\n- two')).toBe('* one\n* two');
  });

  it('converts ordered list', () => {
    expect(markdownToWiki('1. one\n2. two')).toBe('# one\n# two');
  });

  it('converts nested bullets via indent depth', () => {
    expect(markdownToWiki('- top\n  - nested')).toBe('* top\n** nested');
  });
});

describe('markdownToWiki — blocks', () => {
  it('converts blockquote', () => {
    expect(markdownToWiki('> quoted')).toBe('bq. quoted');
  });

  it('converts horizontal rule', () => {
    expect(markdownToWiki('---')).toBe('----');
  });
});

describe('markdownToWiki — tables', () => {
  it('converts a basic table', () => {
    const md = '| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |';
    const wiki = markdownToWiki(md);
    expect(wiki).toContain('||h1||h2||');
    expect(wiki).toContain('|a|b|');
    expect(wiki).toContain('|c|d|');
    expect(wiki).not.toContain('---');
  });

  it('applies inline formatting inside table cells', () => {
    const md = '| col |\n| --- |\n| **bold** |';
    const wiki = markdownToWiki(md);
    expect(wiki).toContain('|*bold*|');
  });
});

describe('markdownToWiki — integration', () => {
  it('preserves paragraph structure', () => {
    const md = '# Title\n\nFirst para.\n\nSecond para.';
    const wiki = markdownToWiki(md);
    expect(wiki).toContain('h1. Title');
    expect(wiki).toContain('First para.');
    expect(wiki).toContain('Second para.');
  });

  it('handles a mixed document', () => {
    const md = [
      '## Section',
      '',
      'With **bold** and `code`.',
      '',
      '- item one',
      '- item two',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n');
    const wiki = markdownToWiki(md);
    expect(wiki).toContain('h2. Section');
    expect(wiki).toContain('*bold*');
    expect(wiki).toContain('{{code}}');
    expect(wiki).toContain('* item one');
    expect(wiki).toContain('||a||b||');
    expect(wiki).toContain('|1|2|');
  });
});
