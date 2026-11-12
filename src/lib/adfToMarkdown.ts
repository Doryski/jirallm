import { assignAttachmentFilenames, sanitizeAttachmentFilename } from './safePath.js';

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

const MIN_FENCE_LENGTH = 3;
const SAFE_CODE_LANGUAGE = /^[A-Za-z0-9_+#.-]{1,32}$/;
const HEADING_LEVEL = { min: 1, max: 6 } as const;
const UNSAFE_MEDIA_ID_CHARS = /[^A-Za-z0-9_-]/g;

const longestBacktickRun = (text: string) =>
  (text.match(/`+/g) ?? []).reduce((longest, run) => Math.max(longest, run.length), 0);

const codeFence = (body: string) =>
  '`'.repeat(Math.max(MIN_FENCE_LENGTH, longestBacktickRun(body) + 1));

const safeCodeLanguage = (language: unknown) =>
  typeof language === 'string' && SAFE_CODE_LANGUAGE.test(language) ? language : '';

const clampHeadingLevel = (level: unknown) => {
  if (typeof level !== 'number' || !Number.isFinite(level)) return HEADING_LEVEL.min;
  return Math.min(HEADING_LEVEL.max, Math.max(HEADING_LEVEL.min, Math.trunc(level)));
};

const safeMediaId = (id: unknown) =>
  typeof id === 'string' ? id.replace(UNSAFE_MEDIA_ID_CHARS, '') : '';

function firstSavedNameByFilename(
  attachments: ReadonlyArray<{ filename: string; savedName: string }>
): Map<string, string> {
  const byFilename = new Map<string, string>();
  for (const att of attachments) {
    if (!byFilename.has(att.filename)) byFilename.set(att.filename, att.savedName);
  }
  return byFilename;
}

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

  const savedNames = assignAttachmentFilenames(attachments);
  const savedAttachments = attachments.map((att, index) => ({
    ...att,
    savedName: savedNames[index],
  }));
  const savedNameByFilename = firstSavedNameByFilename(savedAttachments);
  const altMatchedFilenames = new Set<string>();
  const collectAltMatches = (node: JiraADFContent) => {
    if ((node.type === 'media' || node.type === 'mediaInline') && node.attrs?.alt) {
      if (savedNameByFilename.has(node.attrs.alt)) altMatchedFilenames.add(node.attrs.alt);
    }
    childNodesOf(node)?.forEach(collectAltMatches);
  };
  topLevelNodes.forEach(collectAltMatches);
  const unmatchedAttachments = savedAttachments.filter(
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
      const matchedName = filename ? savedNameByFilename.get(filename) : undefined;
      if (matchedName) return formatMediaLink(matchedName);
      const nextUnmatched = unmatchedAttachments.shift();
      if (nextUnmatched) return formatMediaLink(nextUnmatched.savedName);
      if (filename) return formatMediaLink(sanitizeAttachmentFilename(filename, node.attrs.id));
      const mediaId = safeMediaId(node.attrs.id);
      return mediaId ? `![embedded media](media/${mediaId})` : '![embedded media]()';
    }

    if (node.type === 'mediaSingle' && children) {
      return children.map((child) => extractText(child)).join('');
    }

    if (node.type === 'mediaGroup' && children) {
      return children.map((child) => extractText(child)).join('\n');
    }

    if ((node.type === 'inlineCard' || node.type === 'blockCard') && node.attrs?.url) {
      const matched = savedAttachments.find((att) => att.url && node.attrs!.url!.includes(att.id));
      if (matched) return `[${matched.savedName}](attachments/${matched.savedName})`;
      return node.attrs.url;
    }

    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'rule') return '---';

    if (node.text) return applyMarks(node.text, node.marks);

    if (node.type === 'heading' && children) {
      const level = clampHeadingLevel(node.attrs?.level);
      const childContent = children.map((child) => extractText(child)).join('');
      return '#'.repeat(level) + ' ' + childContent;
    }

    if (node.type === 'codeBlock') {
      const lang = safeCodeLanguage(node.attrs?.language);
      const childContent = children?.map((child) => extractText(child)).join('') ?? '';
      const fence = codeFence(childContent);
      return fence + lang + '\n' + childContent + '\n' + fence;
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
