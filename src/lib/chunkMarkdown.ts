export function isInsideCodeFence(text: string, position: number): boolean {
  const before = text.slice(0, position);
  const fenceMatches = before.match(/^```/gm);
  return fenceMatches !== null && fenceMatches.length % 2 === 1;
}

export function findSafeSplitIndex(text: string, maxChars: number): number {
  const separators = [
    '\n\n---\n\n',
    '\n\n# ',
    '\n\n## ',
    '\n\n### ',
    '\n\n#### ',
    '\n\n',
    '\n',
  ];
  const preserveSeparator = (sep: string) => sep.startsWith('\n\n#') || sep.startsWith('\n\n---');

  for (const sep of separators) {
    let searchEnd = maxChars;
    while (searchEnd > maxChars * 0.4) {
      const idx = text.lastIndexOf(sep, searchEnd);
      if (idx <= maxChars * 0.4) break;
      const splitAt = preserveSeparator(sep) ? idx + 2 : idx + sep.length;
      if (!isInsideCodeFence(text, splitAt)) return splitAt;
      searchEnd = idx - 1;
    }
  }
  return maxChars;
}

export function startsWithBlockElement(text: string): boolean {
  const firstLine = text.split('\n', 1)[0].trim();
  return (
    /^\|/.test(firstLine) ||
    /^[-*+]\s/.test(firstLine) ||
    /^\d+\.\s/.test(firstLine) ||
    /^```/.test(firstLine) ||
    /^>\s/.test(firstLine) ||
    /^---+$/.test(firstLine)
  );
}

export function rebalanceLeadIns(chunks: string[]): string[] {
  for (let i = 0; i < chunks.length - 1; i++) {
    const cur = chunks[i].replace(/\s+$/, '');
    const next = chunks[i + 1].replace(/^\s+/, '');
    const lastBlankIdx = cur.lastIndexOf('\n\n');
    const tail = lastBlankIdx === -1 ? cur : cur.slice(lastBlankIdx + 2);
    const tailTrim = tail.trim();

    const tailIsHeading = /^#{1,6}\s/.test(tailTrim);
    const tailEndsWithColon = tailTrim.endsWith(':');
    const tailIsShort = tail.length < 500;
    const nextIsBlock = startsWithBlockElement(next);

    const shouldMove =
      tailIsShort && (tailIsHeading || (tailEndsWithColon && nextIsBlock));

    if (shouldMove && lastBlankIdx !== -1) {
      chunks[i] = cur.slice(0, lastBlankIdx).replace(/\s+$/, '');
      chunks[i + 1] = tail + '\n\n' + next;
    }
  }
  return chunks.filter((c) => c.trim() !== '');
}

export function splitIntoChunks(body: string, maxChars: number): string[] {
  if (body.length <= maxChars) return [body];

  const chunks: string[] = [];
  let remaining = body;
  while (remaining.length > maxChars) {
    const splitIdx = findSafeSplitIndex(remaining, maxChars);
    chunks.push(remaining.slice(0, splitIdx).trimEnd());
    remaining = remaining.slice(splitIdx).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return rebalanceLeadIns(chunks);
}
