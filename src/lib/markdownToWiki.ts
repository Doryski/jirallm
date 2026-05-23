type Placeholder = { token: string; value: string };

function placeholderize(text: string): { text: string; placeholders: Placeholder[] } {
  const placeholders: Placeholder[] = [];
  let counter = 0;
  const make = (value: string) => {
    const token = `\u0000PH${counter++}\u0000`;
    placeholders.push({ token, value });
    return token;
  };

  text = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_m, lang: string, body: string) => {
    const langPart = lang ? `:${lang}` : '';
    return make(`{code${langPart}}\n${body.replace(/\n$/, '')}\n{code}`);
  });

  text = text.replace(/`([^`\n]+)`/g, (_m, code: string) => make(`{{${code}}}`));

  return { text, placeholders };
}

function restorePlaceholders(text: string, placeholders: Placeholder[]): string {
  for (const { token, value } of placeholders) text = text.split(token).join(value);
  return text;
}

function convertInline(line: string): string {
  const bolds: string[] = [];
  line = line.replace(/\*\*([^*\n]+)\*\*/g, (_m, inner: string) => {
    bolds.push(inner);
    return `\u0001B${bolds.length - 1}\u0001`;
  });
  line = line.replace(/(^|[^*_\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, '$1_$2_');
  line = line.replace(/(^|[^_\w])_([^_\n]+)_(?=[^_\w]|$)/g, '$1_$2_');
  line = line.replace(/~~([^~\n]+)~~/g, '-$1-');
  line = line.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '[$1|$2]');
  // \u0001 sentinel chosen because it can't occur in markdown; protects bold runs from italic-pass rewriting
  // eslint-disable-next-line no-control-regex
  line = line.replace(/\u0001B(\d+)\u0001/g, (_m, idx: string) => `*${bolds[parseInt(idx, 10)]}*`);
  return line;
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?(\s*:?-+:?\s*\|?)+\s*$/.test(line) && /-/.test(line);
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line.trim()) || /^[^|\n]*\|[^|\n]*/.test(line.trim());
}

function splitTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((c) => c.trim());
}

function convertTable(lines: string[], startIdx: number): { wiki: string; nextIdx: number } | null {
  const headerLine = lines[startIdx];
  const sepLine = lines[startIdx + 1];
  if (!sepLine || !isTableSeparator(sepLine)) return null;

  const out: string[] = [];
  const headers = splitTableRow(headerLine).map(convertInline);
  out.push(`||${headers.join('||')}||`);

  let i = startIdx + 2;
  while (i < lines.length && isTableRow(lines[i]) && lines[i].includes('|')) {
    const cells = splitTableRow(lines[i]).map(convertInline);
    out.push(`|${cells.join('|')}|`);
    i++;
  }
  return { wiki: out.join('\n'), nextIdx: i };
}

export function markdownToWiki(input: string): string {
  const { text, placeholders } = placeholderize(input);
  const lines = text.split('\n');
  const out: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*\|/.test(line) && lines[i + 1] && isTableSeparator(lines[i + 1])) {
      const result = convertTable(lines, i);
      if (result) {
        out.push(result.wiki);
        i = result.nextIdx - 1;
        continue;
      }
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      out.push(`h${heading[1].length}. ${convertInline(heading[2])}`);
      continue;
    }

    if (/^\s*---+\s*$/.test(line) || /^\s*\*\*\*+\s*$/.test(line)) {
      out.push('----');
      continue;
    }

    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      const depth = Math.floor(bullet[1].length / 2) + 1;
      out.push(`${'*'.repeat(depth)} ${convertInline(bullet[2])}`);
      continue;
    }

    const ordered = /^(\s*)\d+\.\s+(.*)$/.exec(line);
    if (ordered) {
      const depth = Math.floor(ordered[1].length / 2) + 1;
      out.push(`${'#'.repeat(depth)} ${convertInline(ordered[2])}`);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      out.push(`bq. ${convertInline(quote[1])}`);
      continue;
    }

    out.push(convertInline(line));
  }

  return restorePlaceholders(out.join('\n'), placeholders);
}
