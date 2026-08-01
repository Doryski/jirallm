export type JiraADFContent = {
  type: string;
  content?: JiraADFContent[];
  text?: string;
  marks?: Array<{
    type: string;
    attrs?: { href?: string; [key: string]: unknown };
  }>;
  attrs?: {
    id?: string;
    type?: string;
    collection?: string;
    url?: string;
    alt?: string;
    language?: string;
    level?: number;
    state?: string;
  };
};

export type JiraADFDocument = {
  version: number;
  type: string;
  content: JiraADFContent[];
};

type JiraADFMark = NonNullable<JiraADFContent['marks']>[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const hasStringType = (value: unknown) => isRecord(value) && typeof value.type === 'string';

const isAdfNode = (value: unknown): value is JiraADFContent => hasStringType(value);

const isAdfMark = (value: unknown): value is JiraADFMark => hasStringType(value);

const childNodesOf = (node: { content?: unknown }) =>
  Array.isArray(node.content) ? node.content.filter(isAdfNode) : undefined;

/**
 * Converts a Jira ADF document to Markdown.
 *
 * When `attachments` is empty (the default), media and attachment references cannot be
 * resolved to filenames and degrade accordingly; everything else renders identically.
 *
 * Malformed input never throws: nodes that are not objects carrying a string `type`, and
 * `content` values that are not arrays, are skipped and traversal continues with siblings.
 */
export function convertADFToMarkdown(
  content: string | JiraADFDocument | null | undefined,
  attachments: Array<{ id: string; filename: string; url?: string }> = []
): string {
  if (!content) return '';
  if (typeof content === 'string') return content;

  const topLevelNodes = childNodesOf(content) ?? [];

  const filenameSet = new Set(attachments.map((att) => att.filename));
  const altMatchedFilenames = new Set<string>();
  const collectAltMatches = (node: JiraADFContent) => {
    if ((node.type === 'media' || node.type === 'mediaInline') && node.attrs?.alt) {
      if (filenameSet.has(node.attrs.alt)) altMatchedFilenames.add(node.attrs.alt);
    }
    childNodesOf(node)?.forEach(collectAltMatches);
  };
  topLevelNodes.forEach(collectAltMatches);
  const unmatchedAttachments = attachments.filter(
    (att) => !altMatchedFilenames.has(att.filename)
  );

  const formatMediaLink = (filename: string) => {
    const isImage = /\.(png|jpg|jpeg|gif|svg|webp|bmp|ico)$/i.test(filename);
    return isImage
      ? `![image](attachments/${filename})`
      : `[${filename}](attachments/${filename})`;
  };

  const applyMarks = (text: string, marks?: JiraADFContent['marks']) => {
    if (!Array.isArray(marks)) return text;
    for (const mark of marks.filter(isAdfMark)) {
      switch (mark.type) {
        case 'code':
          text = `\`${text}\``;
          break;
        case 'strong':
          text = `**${text}**`;
          break;
        case 'em':
          text = `*${text}*`;
          break;
        case 'strike':
          text = `~~${text}~~`;
          break;
        case 'link':
          if (mark.attrs?.href) text = `[${text}](${mark.attrs.href})`;
          break;
      }
    }
    return text;
  };

  const extractText = (node: unknown, isTopLevel = false, listIndex?: number): string => {
    if (!isAdfNode(node)) return '';
    const children = childNodesOf(node);

    if ((node.type === 'media' || node.type === 'mediaInline') && node.attrs) {
      const filename = node.attrs.alt;
      if (filename && filenameSet.has(filename)) return formatMediaLink(filename);
      if (unmatchedAttachments.length > 0) {
        const att = unmatchedAttachments.shift()!;
        return formatMediaLink(att.filename);
      }
      if (filename) return formatMediaLink(filename);
      const mediaId = node.attrs.id;
      return mediaId ? `![embedded media](media/${mediaId})` : '![embedded media]()';
    }

    if (node.type === 'mediaSingle' && children) {
      return children.map((child) => extractText(child)).join('');
    }

    if (node.type === 'mediaGroup' && children) {
      return children.map((child) => extractText(child)).join('\n');
    }

    if ((node.type === 'inlineCard' || node.type === 'blockCard') && node.attrs?.url) {
      const matched = attachments.find((att) => att.url && node.attrs!.url!.includes(att.id));
      if (matched) return `[${matched.filename}](attachments/${matched.filename})`;
      return node.attrs.url;
    }

    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'rule') return '---';

    if (node.text) return applyMarks(node.text, node.marks);

    if (node.type === 'heading' && children) {
      const level = node.attrs?.level ?? 1;
      const childContent = children.map((child) => extractText(child)).join('');
      return '#'.repeat(level) + ' ' + childContent;
    }

    if (node.type === 'codeBlock') {
      const lang = node.attrs?.language ?? '';
      const childContent = children?.map((child) => extractText(child)).join('') ?? '';
      return '```' + lang + '\n' + childContent + '\n```';
    }

    if (node.type === 'blockquote' && children) {
      const childContent = children.map((child) => extractText(child)).join('\n');
      return childContent
        .split('\n')
        .map((line) => '> ' + line)
        .join('\n');
    }

    if (node.type === 'bulletList' && children) {
      return children.map((child) => extractText(child, false, -1)).join('\n');
    }

    if (node.type === 'orderedList' && children) {
      return children.map((child, i) => extractText(child, false, i + 1)).join('\n');
    }

    if (node.type === 'listItem' && children) {
      const prefix = listIndex !== undefined && listIndex > 0 ? `${listIndex}. ` : '- ';
      const childContent = children.map((child) => extractText(child)).join('\n');
      return prefix + childContent.replace(/\n$/, '');
    }

    if (node.type === 'taskList' && children) {
      return children.map((child) => extractText(child)).join('\n');
    }

    if (node.type === 'taskItem') {
      const checked = node.attrs?.state === 'DONE' ? 'x' : ' ';
      const childContent = children?.map((child) => extractText(child)).join('') ?? '';
      return `- [${checked}] ${childContent}`;
    }

    if (node.type === 'table' && children) {
      const rows = children.filter((child) => child.type === 'tableRow');
      if (rows.length === 0) return '';

      const processRow = (row: JiraADFContent) => {
        const cells =
          childNodesOf(row)?.map((cell) =>
            (childNodesOf(cell) ?? [])
              .map((child) => extractText(child))
              .join('')
              .replace(/\n$/g, '')
          ) ?? [];
        return '| ' + cells.join(' | ') + ' |';
      };

      const headerRow = processRow(rows[0]);
      const colCount = childNodesOf(rows[0])?.length ?? 0;
      const separator = '| ' + Array(colCount).fill('---').join(' | ') + ' |';
      const bodyRows = rows.slice(1).map(processRow);

      return [headerRow, separator, ...bodyRows].join('\n');
    }

    if (node.type === 'tableRow' || node.type === 'tableCell' || node.type === 'tableHeader') {
      return children?.map((child) => extractText(child)).join('') ?? '';
    }

    if (children) {
      const childContent = children.map((child) => extractText(child)).join('');
      if (isTopLevel && node.type === 'paragraph') return childContent + '\n';
      return childContent;
    }

    return '';
  };

  return topLevelNodes.map((node) => extractText(node, true)).join('\n');
}
