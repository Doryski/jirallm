import { describe, it, expect } from 'vitest';
import {
  splitIntoChunks,
  rebalanceLeadIns,
  findSafeSplitIndex,
  isInsideCodeFence,
  startsWithBlockElement,
} from './chunkMarkdown.js';

describe('isInsideCodeFence', () => {
  it('returns false outside fences', () => {
    const text = 'text\n\n```\ncode\n```\n\nmore';
    expect(isInsideCodeFence(text, 0)).toBe(false);
    expect(isInsideCodeFence(text, text.length)).toBe(false);
  });

  it('returns true between unbalanced fences', () => {
    const text = 'text\n```\ninside\n```';
    const insidePos = text.indexOf('inside');
    expect(isInsideCodeFence(text, insidePos)).toBe(true);
  });

  it('returns false after fences are closed', () => {
    const text = '```\na\n```\nout';
    const outPos = text.indexOf('out');
    expect(isInsideCodeFence(text, outPos)).toBe(false);
  });
});

describe('startsWithBlockElement', () => {
  it.each([
    ['| col |', true],
    ['- item', true],
    ['* item', true],
    ['+ item', true],
    ['1. item', true],
    ['```js', true],
    ['> quote', true],
    ['---', true],
    ['regular paragraph', false],
    ['## heading', false],
    ['plain text', false],
  ])('detects %j → %s', (line, expected) => {
    expect(startsWithBlockElement(line)).toBe(expected);
  });

  it('only inspects first line', () => {
    expect(startsWithBlockElement('plain\n- list')).toBe(false);
  });
});

describe('findSafeSplitIndex', () => {
  it('prefers --- separator over plain paragraph break', () => {
    const text = 'A'.repeat(40) + '\n\n---\n\n' + 'B'.repeat(40);
    const idx = findSafeSplitIndex(text, 80);
    expect(text.slice(idx).startsWith('---')).toBe(true);
  });

  it('prefers heading separator over paragraph break', () => {
    const text = 'paragraph one.\n\nmore prose here.\n\n## Section\n\nbody'.padEnd(80, '.');
    const idx = findSafeSplitIndex(text, 50);
    expect(text.slice(idx).startsWith('## ')).toBe(true);
  });

  it('does not split inside a code fence', () => {
    const fence = '```\n' + 'x'.repeat(60) + '\n```';
    const text = 'pre text here\n\n' + fence + '\n\npost text';
    const idx = findSafeSplitIndex(text, 30);
    expect(isInsideCodeFence(text, idx)).toBe(false);
  });

  it('falls back to maxChars when no separator found', () => {
    const text = 'a'.repeat(200);
    expect(findSafeSplitIndex(text, 50)).toBe(50);
  });

  it('preserves heading prefix in next chunk', () => {
    const text = 'intro paragraph one.\n\nintro paragraph two longer.\n\n## Heading\n\nbody text after'.padEnd(120, '.');
    const idx = findSafeSplitIndex(text, 60);
    const nextChunk = text.slice(idx);
    expect(nextChunk.startsWith('## Heading')).toBe(true);
  });
});

describe('rebalanceLeadIns', () => {
  it('moves trailing heading to next chunk', () => {
    const chunks = ['Body text.\n\n## Orphaned heading', 'Next section body.'];
    const result = rebalanceLeadIns(chunks);
    expect(result[0]).toBe('Body text.');
    expect(result[1].startsWith('## Orphaned heading')).toBe(true);
  });

  it('moves "lead-in:" paragraph before a table to next chunk', () => {
    const chunks = [
      'Some prose.\n\nDetails of fields:',
      '| col1 | col2 |\n| --- | --- |\n| a | b |',
    ];
    const result = rebalanceLeadIns(chunks);
    expect(result[0]).toBe('Some prose.');
    expect(result[1].startsWith('Details of fields:')).toBe(true);
  });

  it('moves "lead-in:" paragraph before a bullet list', () => {
    const chunks = ['Intro paragraph.\n\nOptions:', '- one\n- two'];
    const result = rebalanceLeadIns(chunks);
    expect(result[0]).toBe('Intro paragraph.');
    expect(result[1].startsWith('Options:')).toBe(true);
  });

  it('does not move ordinary trailing paragraph', () => {
    const chunks = ['Sentence one.\n\nSentence two with content.', 'Sentence three.'];
    const result = rebalanceLeadIns(chunks);
    expect(result[0]).toBe('Sentence one.\n\nSentence two with content.');
    expect(result[1]).toBe('Sentence three.');
  });

  it('does not move long trailing paragraph even if it ends with colon', () => {
    const longTail = 'word '.repeat(120) + 'final clause:';
    const chunks = [`Intro.\n\n${longTail}`, '- list item'];
    const result = rebalanceLeadIns(chunks);
    expect(result[0]).toBe(`Intro.\n\n${longTail}`);
  });

  it('does not move when next chunk does not start with block element', () => {
    const chunks = ['Intro.\n\nDetails:', 'Plain follow-up paragraph.'];
    const result = rebalanceLeadIns(chunks);
    expect(result[0]).toBe('Intro.\n\nDetails:');
  });

  it('handles single-chunk input', () => {
    expect(rebalanceLeadIns(['only one'])).toEqual(['only one']);
  });

  it('does not move heading when it is the only content in chunk (no preceding blank)', () => {
    const chunks = ['## Only heading here', 'Body following.'];
    const result = rebalanceLeadIns(chunks);
    expect(result).toEqual(chunks);
  });
});

describe('splitIntoChunks', () => {
  it('returns single chunk when body fits', () => {
    expect(splitIntoChunks('short', 100)).toEqual(['short']);
  });

  it('splits into multiple chunks respecting maxChars', () => {
    const sections = Array.from({ length: 6 }, (_, i) => `## Section ${i + 1}\n\nBody ${i + 1}.`).join('\n\n');
    const chunks = splitIntoChunks(sections, 40);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(120);
    }
  });

  it('keeps headings attached to following body via rebalance', () => {
    const body =
      'Intro paragraph that is moderately long to push past the limit.\n\n' +
      '## Important Section\n\n' +
      'Body of the important section continues here with more content.';
    const chunks = splitIntoChunks(body, 70);
    const headingChunk = chunks.find((c) => c.includes('## Important Section'));
    expect(headingChunk).toBeDefined();
    expect(headingChunk!.includes('Body of the important')).toBe(true);
  });

  it('moves "Details:" lead-in to chunk with following table', () => {
    const body =
      'First section content that takes up space here.\n\n' +
      '## Second\n\n' +
      'Some prose explaining things in detail here.\n\n' +
      'Details below:\n\n' +
      '| h1 | h2 |\n| --- | --- |\n| a | b |';
    const chunks = splitIntoChunks(body, 100);
    const tableChunk = chunks.find((c) => c.includes('| h1 | h2 |'));
    expect(tableChunk).toBeDefined();
    expect(tableChunk!.includes('Details below:')).toBe(true);
  });

  it('preserves all original content when reassembled', () => {
    const body = Array.from({ length: 20 }, (_, i) => `## Sec ${i}\n\nBody ${i} with some words.`).join('\n\n');
    const chunks = splitIntoChunks(body, 80);
    const rejoinedWordCount = chunks.join(' ').replace(/\s+/g, ' ').trim().split(' ').length;
    const originalWordCount = body.replace(/\s+/g, ' ').trim().split(' ').length;
    expect(rejoinedWordCount).toBe(originalWordCount);
  });

  it('does not split inside a code fence', () => {
    const body =
      'intro paragraph one here.\n\n' +
      'intro paragraph two here.\n\n' +
      '```js\n' +
      'function example() {\n' +
      '  return ' + '"x".repeat(40)' + ';\n' +
      '}\n' +
      '```\n\n' +
      'closing paragraph.';
    const chunks = splitIntoChunks(body, 60);
    for (const chunk of chunks) {
      const fenceCount = (chunk.match(/^```/gm) || []).length;
      expect(fenceCount % 2).toBe(0);
    }
  });
});
