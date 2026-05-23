import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { pipeline } from 'stream/promises';

export type JiraConfig = {
  baseUrl: string;
  projectKey: string;
  userEmail: string;
};

type JiraADFContent = {
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

type JiraADFDocument = {
  version: number;
  type: string;
  content: JiraADFContent[];
};

type JiraIssue = {
  key: string;
  fields: {
    summary: string;
    description?: string | JiraADFDocument | null;
    status?: { name: string };
    issuetype?: { name: string };
    parent?: {
      key: string;
      fields: { summary: string; status?: { name: string } };
    };
    attachment?: Array<{ id: string; filename: string; content: string; size: number }>;
    [key: string]: unknown;
  };
};

type JiraComment = {
  id: string;
  author: { displayName: string };
  created: string;
  body: string | JiraADFDocument;
};

type JiraCommentsResponse = {
  comments: JiraComment[];
  startAt: number;
  maxResults: number;
  total: number;
};

type JiraChangelogItem = {
  field: string;
  fromString: string | null;
  toString: string | null;
};

type JiraChangelogHistory = {
  id: string;
  author: { displayName: string };
  created: string;
  items: JiraChangelogItem[];
};

type HistoryEntry = {
  type: 'comment' | 'status_change';
  author: string;
  date: string;
  content: string;
};

export type JiraBoard = { id: number; name: string; type: string };

export type JiraBoardConfiguration = {
  columnConfig: {
    columns: Array<{ name: string; statuses: Array<{ id: string; self: string }> }>;
  };
};

export type JiraTransition = {
  id: string;
  name: string;
  to: { id: string; name: string };
};

export type JqlIssue = { key: string; fields: Record<string, unknown> };

type SubtaskSummary = {
  key: string;
  title: string;
  status: string;
};

export type JiraTaskData = {
  key: string;
  title: string;
  status: string;
  description: string;
  issueType?: string;
  parent?: { key: string; title: string; status?: string };
  epic?: { key: string; title: string };
  subtasks?: SubtaskSummary[];
  attachments: Array<{ id: string; filename: string; url: string; size: number }>;
  history: HistoryEntry[];
};

export type JiraTaskSummary = {
  key: string;
  title: string;
  status: string;
  issueType?: string;
  parent?: { key: string; title: string; status?: string };
  epic?: { key: string; title: string };
  subtasks?: SubtaskSummary[];
};

const COMMON_EPIC_FIELDS = [
  'customfield_10014',
  'customfield_10008',
  'customfield_10001',
  'customfield_10011',
];

export class JiraClient {
  private config: JiraConfig;
  private authHeader: string;

  constructor(config: JiraConfig, apiToken: string) {
    this.config = config;
    this.authHeader = `Basic ${Buffer.from(`${config.userEmail}:${apiToken}`).toString('base64')}`;
  }

  private extractEpicFromFields(
    fields: Record<string, unknown>
  ): { key: string; title: string } | undefined {
    for (const fieldId of COMMON_EPIC_FIELDS) {
      const epicField = fields[fieldId] as { key: string; fields: { summary: string } } | undefined;
      if (epicField?.key && epicField.fields?.summary) {
        return { key: epicField.key, title: epicField.fields.summary };
      }
    }
    return undefined;
  }

  convertADFToMarkdown(
    content: string | JiraADFDocument | null | undefined,
    attachments: Array<{ id: string; filename: string; url?: string }> = []
  ): string {
    if (!content) return '';
    if (typeof content === 'string') return content;

    const filenameSet = new Set(attachments.map((att) => att.filename));
    const altMatchedFilenames = new Set<string>();
    const collectAltMatches = (node: JiraADFContent) => {
      if ((node.type === 'media' || node.type === 'mediaInline') && node.attrs?.alt) {
        if (filenameSet.has(node.attrs.alt)) altMatchedFilenames.add(node.attrs.alt);
      }
      node.content?.forEach(collectAltMatches);
    };
    content.content.forEach(collectAltMatches);
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
      if (!marks) return text;
      for (const mark of marks) {
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

    const extractText = (node: JiraADFContent, isTopLevel = false, listIndex?: number): string => {
      if ((node.type === 'media' || node.type === 'mediaInline') && node.attrs) {
        const filename = node.attrs.alt;
        if (filename && filenameSet.has(filename)) return formatMediaLink(filename);
        if (unmatchedAttachments.length > 0) {
          const att = unmatchedAttachments.shift()!;
          return formatMediaLink(att.filename);
        }
        return '';
      }

      if (node.type === 'mediaSingle' && node.content) {
        return node.content.map((child) => extractText(child)).join('');
      }

      if (node.type === 'mediaGroup' && node.content) {
        return node.content.map((child) => extractText(child)).join('\n');
      }

      if ((node.type === 'inlineCard' || node.type === 'blockCard') && node.attrs?.url) {
        const matched = attachments.find((att) => att.url && node.attrs!.url!.includes(att.id));
        if (matched) return `[${matched.filename}](attachments/${matched.filename})`;
        return node.attrs.url;
      }

      if (node.type === 'hardBreak') return '\n';
      if (node.type === 'rule') return '---';

      if (node.text) return applyMarks(node.text, node.marks);

      if (node.type === 'heading' && node.content) {
        const level = node.attrs?.level ?? 1;
        const childContent = node.content.map((child) => extractText(child)).join('');
        return '#'.repeat(level) + ' ' + childContent;
      }

      if (node.type === 'codeBlock') {
        const lang = node.attrs?.language ?? '';
        const childContent = node.content?.map((child) => extractText(child)).join('') ?? '';
        return '```' + lang + '\n' + childContent + '\n```';
      }

      if (node.type === 'blockquote' && node.content) {
        const childContent = node.content.map((child) => extractText(child)).join('\n');
        return childContent
          .split('\n')
          .map((line) => '> ' + line)
          .join('\n');
      }

      if (node.type === 'bulletList' && node.content) {
        return node.content.map((child) => extractText(child, false, -1)).join('\n');
      }

      if (node.type === 'orderedList' && node.content) {
        return node.content.map((child, i) => extractText(child, false, i + 1)).join('\n');
      }

      if (node.type === 'listItem' && node.content) {
        const prefix = listIndex !== undefined && listIndex > 0 ? `${listIndex}. ` : '- ';
        const childContent = node.content.map((child) => extractText(child)).join('\n');
        return prefix + childContent.replace(/\n$/, '');
      }

      if (node.type === 'taskList' && node.content) {
        return node.content.map((child) => extractText(child)).join('\n');
      }

      if (node.type === 'taskItem') {
        const checked = node.attrs?.state === 'DONE' ? 'x' : ' ';
        const childContent = node.content?.map((child) => extractText(child)).join('') ?? '';
        return `- [${checked}] ${childContent}`;
      }

      if (node.type === 'table' && node.content) {
        const rows = node.content.filter((child) => child.type === 'tableRow');
        if (rows.length === 0) return '';

        const processRow = (row: JiraADFContent) => {
          const cells =
            row.content?.map((cell) => {
              const cellText =
                cell.content
                  ?.map((child) => extractText(child))
                  .join('')
                  .replace(/\n$/g, '') ?? '';
              return cellText;
            }) ?? [];
          return '| ' + cells.join(' | ') + ' |';
        };

        const headerRow = processRow(rows[0]);
        const colCount = rows[0].content?.length ?? 0;
        const separator = '| ' + Array(colCount).fill('---').join(' | ') + ' |';
        const bodyRows = rows.slice(1).map(processRow);

        return [headerRow, separator, ...bodyRows].join('\n');
      }

      if (node.type === 'tableRow' || node.type === 'tableCell' || node.type === 'tableHeader') {
        return node.content?.map((child) => extractText(child)).join('') ?? '';
      }

      if (node.content) {
        const childContent = node.content.map((child) => extractText(child)).join('');
        if (isTopLevel && node.type === 'paragraph') return childContent + '\n';
        return childContent;
      }

      return '';
    };

    return content.content.map((node) => extractText(node, true)).join('\n');
  }

  private mergeHistory(
    comments: JiraComment[],
    changelog: JiraChangelogHistory[],
    attachmentMetadata: Array<{ id: string; filename: string; url?: string }> = []
  ): HistoryEntry[] {
    const history: HistoryEntry[] = [];

    for (const comment of comments) {
      history.push({
        type: 'comment',
        author: comment.author.displayName,
        date: comment.created,
        content: this.convertADFToMarkdown(comment.body, attachmentMetadata),
      });
    }

    for (const change of changelog) {
      const statusChange = change.items.find((item) => item.field === 'status');
      if (statusChange) {
        history.push({
          type: 'status_change',
          author: change.author.displayName,
          date: change.created,
          content: `${statusChange.fromString || 'None'} → ${statusChange.toString}`,
        });
      }
    }

    history.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return history;
  }

  private async makeRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.baseUrl}/rest/api/3${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Jira API request failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }

    return response.json() as Promise<T>;
  }

  async getCurrentUser(): Promise<{
    accountId: string;
    emailAddress?: string;
    displayName: string;
  }> {
    return this.makeRequest<{ accountId: string; emailAddress?: string; displayName: string }>(
      '/myself'
    );
  }

  async fetchIssueDetails(issueKey: string): Promise<JiraTaskData> {
    const fields = [
      'summary',
      'description',
      'status',
      'parent',
      'attachment',
      'issuetype',
      ...COMMON_EPIC_FIELDS,
    ].join(',');

    const response = await this.makeRequest<JiraIssue>(`/issue/${issueKey}?fields=${fields}`);

    const comments = await this.fetchIssueComments(issueKey);
    const changelog = await this.fetchIssueChangelog(issueKey);

    const attachmentMetadata =
      response.fields.attachment?.map((att) => ({
        id: att.id,
        filename: att.filename,
        url: att.content,
      })) || [];

    const history = this.mergeHistory(comments, changelog, attachmentMetadata);

    return {
      key: response.key,
      title: response.fields.summary,
      status: response.fields.status?.name || 'Unknown',
      description: this.convertADFToMarkdown(response.fields.description, attachmentMetadata),
      issueType: response.fields.issuetype?.name,
      parent: response.fields.parent
        ? {
            key: response.fields.parent.key,
            title: response.fields.parent.fields.summary,
            status: response.fields.parent.fields.status?.name,
          }
        : undefined,
      epic: this.extractEpicFromFields(response.fields),
      attachments:
        response.fields.attachment?.map((att) => ({
          id: att.id,
          filename: att.filename,
          url: att.content,
          size: att.size,
        })) || [],
      history,
    };
  }

  async fetchIssueComments(issueKey: string): Promise<JiraComment[]> {
    const allComments: JiraComment[] = [];
    const maxResults = 100;
    let startAt = 0;
    let total: number;

    do {
      const response = await this.makeRequest<JiraCommentsResponse>(
        `/issue/${issueKey}/comment?startAt=${startAt}&maxResults=${maxResults}`
      );
      allComments.push(...response.comments);
      total = response.total;
      startAt += response.maxResults;
    } while (startAt < total);

    return allComments;
  }

  async fetchIssueChangelog(issueKey: string): Promise<JiraChangelogHistory[]> {
    const response = await this.makeRequest<{
      changelog: { histories: JiraChangelogHistory[] };
    }>(`/issue/${issueKey}?expand=changelog&fields=none`);
    return response.changelog.histories;
  }

  async fetchIssueSubtasks(parentKey: string): Promise<SubtaskSummary[]> {
    const jql = `parent = ${parentKey} ORDER BY key ASC`;
    try {
      const response = await this.makeRequest<{ issues: JiraIssue[] }>(`/search/jql`, {
        method: 'POST',
        body: JSON.stringify({ jql, fields: ['summary', 'status'] }),
      });
      return response.issues.map((issue) => ({
        key: issue.key,
        title: issue.fields.summary,
        status: issue.fields.status?.name || 'Unknown',
      }));
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to fetch subtasks for ${parentKey}: ${errorMessage}`);
      return [];
    }
  }

  async addComment(
    issueKey: string,
    wikiBody: string,
    parentCommentId?: string
  ): Promise<{ id: string }> {
    const url = `${this.config.baseUrl}/rest/api/2/issue/${issueKey}/comment`;
    const payload: Record<string, unknown> = { body: wikiBody };
    if (parentCommentId) payload.parentId = parentCommentId;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Jira addComment failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }
    const json = (await response.json()) as { id: string };
    return { id: json.id };
  }

  async addWorklog(
    issueKey: string,
    payload: {
      started: string;
      timeSpentSeconds: number;
      comment?: string;
      visibility?: { type: 'group' | 'role'; value: string };
    }
  ): Promise<{ id: string; issueId: string }> {
    const url = `${this.config.baseUrl}/rest/api/2/issue/${issueKey}/worklog`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Jira addWorklog failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }
    const json = (await response.json()) as { id: string; issueId: string };
    return { id: json.id, issueId: json.issueId };
  }

  async deleteComment(issueKey: string, commentId: string): Promise<void> {
    const url = `${this.config.baseUrl}/rest/api/2/issue/${issueKey}/comment/${commentId}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: this.authHeader, Accept: 'application/json' },
    });
    if (!response.ok && response.status !== 204) {
      const errorText = await response.text();
      throw new Error(
        `Jira deleteComment failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }
  }

  private async makeAgileRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.baseUrl}/rest/agile/1.0${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Jira Agile API request failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }
    return response.json() as Promise<T>;
  }

  async findBoardByName(name: string): Promise<JiraBoard> {
    const response = await this.makeAgileRequest<{ values: JiraBoard[] }>(
      `/board?name=${encodeURIComponent(name)}`
    );
    const exact = response.values.find((b) => b.name === name);
    if (exact) return exact;
    if (response.values.length === 1) return response.values[0];
    if (response.values.length === 0) {
      throw new Error(`No board found matching "${name}".`);
    }
    throw new Error(
      `Multiple boards matched "${name}": ${response.values.map((b) => b.name).join(', ')}. Use the exact name.`
    );
  }

  async getBoardConfiguration(boardId: number): Promise<JiraBoardConfiguration> {
    return this.makeAgileRequest(`/board/${boardId}/configuration`);
  }

  async getBoardColumnStatusIds(boardName: string, columnName: string): Promise<string[]> {
    const board = await this.findBoardByName(boardName);
    const config = await this.getBoardConfiguration(board.id);
    const column = config.columnConfig.columns.find((c) => c.name === columnName);
    if (!column) {
      const available = config.columnConfig.columns.map((c) => c.name).join(', ');
      throw new Error(`Column "${columnName}" not found on board "${boardName}". Available: ${available}`);
    }
    return column.statuses.map((s) => s.id);
  }

  async searchByJql(
    jql: string,
    fields: string[] = ['summary', 'status', 'assignee', 'issuetype']
  ): Promise<JqlIssue[]> {
    const all: JqlIssue[] = [];
    let nextPageToken: string | undefined;
    do {
      const body: Record<string, unknown> = { jql, fields, maxResults: 100 };
      if (nextPageToken) body.nextPageToken = nextPageToken;
      const response = await this.makeRequest<{
        issues: JqlIssue[];
        nextPageToken?: string;
        isLast?: boolean;
      }>('/search/jql', { method: 'POST', body: JSON.stringify(body) });
      all.push(...response.issues);
      nextPageToken = response.isLast === false ? response.nextPageToken : undefined;
    } while (nextPageToken);
    return all;
  }

  async getIssueTransitions(issueKey: string): Promise<JiraTransition[]> {
    const response = await this.makeRequest<{ transitions: JiraTransition[] }>(
      `/issue/${issueKey}/transitions`
    );
    return response.transitions;
  }

  async transitionIssue(
    issueKey: string,
    targetStatus: string
  ): Promise<Pick<JiraTransition, 'id' | 'name'>> {
    const transitions = await this.getIssueTransitions(issueKey);
    const match =
      transitions.find((t) => t.to.name === targetStatus) ??
      transitions.find((t) => t.name === targetStatus);
    if (!match) {
      const available = transitions.map((t) => `"${t.name}" → "${t.to.name}"`).join(', ');
      throw new Error(
        `No transition to "${targetStatus}" available on ${issueKey}. Available: ${available}`
      );
    }
    const url = `${this.config.baseUrl}/rest/api/3/issue/${issueKey}/transitions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transition: { id: match.id } }),
    });
    if (!response.ok && response.status !== 204) {
      const errorText = await response.text();
      throw new Error(
        `Jira transition failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }
    return { name: match.name, id: match.id };
  }

  async downloadAttachment(attachmentUrl: string, outputPath: string): Promise<void> {
    await mkdir(dirname(outputPath), { recursive: true });

    const response = await fetch(attachmentUrl, {
      headers: { Authorization: this.authHeader },
    });

    if (!response.ok) {
      throw new Error(`Failed to download attachment: ${response.status} ${response.statusText}`);
    }
    if (!response.body) throw new Error('Response body is null');

    const fileStream = createWriteStream(outputPath);
    await pipeline(response.body as unknown as NodeJS.ReadableStream, fileStream);
  }
}
