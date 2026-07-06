import { createWriteStream } from 'fs';
import { mkdir, readFile, stat } from 'fs/promises';
import { basename, dirname } from 'path';
import { pipeline } from 'stream/promises';
import type { CustomFieldDefs } from './exportFields.js';
import { markdownToWiki } from './markdownToWiki.js';

export type JiraConfig = {
  baseUrl: string;
  projectKey?: string;
  userEmail: string;
};

export type JiraUser = {
  accountId: string;
  displayName: string;
  emailAddress?: string;
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

export type JiraComment = {
  id: string;
  author: { displayName: string; accountId?: string };
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
  type: 'comment' | 'status_change' | 'field_change';
  author: string;
  date: string;
  content: string;
  field?: string;
  id?: string;
  authorAccountId?: string;
};

export type WorklogSummary = {
  author: string;
  started: string;
  timeSpent: string;
  comment?: string;
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

export type JiraSearchPage<T> = {
  issues: T[];
  nextPageToken?: string;
  isLast: boolean;
};

export type JiraProject = {
  id: string;
  key: string;
  name: string;
  projectTypeKey?: string;
  simplified?: boolean;
  style?: string;
  lead?: { accountId: string; displayName: string };
};

export type JiraSprint = {
  id: number;
  self: string;
  state: 'active' | 'future' | 'closed' | string;
  name: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
  originBoardId?: number;
  goal?: string;
};

export type JiraIssueType = {
  id: string;
  name: string;
  description?: string;
  iconUrl?: string;
  subtask: boolean;
  hierarchyLevel?: number;
};

export type JiraIssueLinkType = {
  id: string;
  name: string;
  inward: string;
  outward: string;
};

export type JiraPriority = {
  id: string;
  name: string;
  iconUrl?: string;
  description?: string;
};

export type JiraStatus = {
  id: string;
  name: string;
  description?: string;
  statusCategory?: { id: number; key: string; name: string; colorName?: string };
};

export type JiraComponent = {
  id: string;
  name: string;
  description?: string;
};

export type JiraCreateField = {
  fieldId: string;
  name: string;
  required: boolean;
  schemaType?: string;
  allowedValues?: string[];
};

export type JiraWatcher = {
  accountId: string;
  displayName: string;
  active?: boolean;
};

export type JiraIssueLink = {
  id: string;
  self?: string;
  type: { id?: string; name: string; inward: string; outward: string };
  inwardIssue?: { key: string };
  outwardIssue?: { key: string };
};

export type JiraPage<T> = {
  values: T[];
  startAt: number;
  maxResults: number;
  isLast: boolean;
  total?: number;
};

type SubtaskSummary = {
  key: string;
  title: string;
  status: string;
};

export type IssueLinkSummary = {
  id: string;
  type: string;
  key: string;
  title: string;
  status?: string;
};

export type TimeTrackingSummary = {
  originalEstimate?: string;
  remainingEstimate?: string;
  timeSpent?: string;
};

export type JiraTaskData = {
  key: string;
  title: string;
  status: string;
  description: string;
  issueType?: string;
  priority?: string;
  resolution?: string;
  assignee?: string;
  reporter?: string;
  creator?: string;
  createdAt?: string;
  updatedAt?: string;
  dueDate?: string;
  resolutionDate?: string;
  components?: string[];
  labels?: string[];
  fixVersions?: string[];
  versions?: string[];
  sprint?: string;
  storyPoints?: number;
  timetracking?: TimeTrackingSummary;
  issueLinks?: IssueLinkSummary[];
  parent?: { key: string; title: string; status?: string };
  epic?: { key: string; title: string };
  subtasks?: SubtaskSummary[];
  customFields?: Record<string, unknown>;
  attachments: Array<{ id: string; filename: string; url: string; size: number }>;
  history: HistoryEntry[];
  worklogs?: WorklogSummary[];
};

export type FetchIssueDetailsOptions = {
  jiraFieldIds?: string[];
  customFieldDefs?: CustomFieldDefs;
  includeComments?: boolean;
  includeChangelog?: boolean;
  includeWorklog?: boolean;
  includeLinks?: boolean;
  fullChangelog?: boolean;
};

type JiraFieldMeta = {
  id: string;
  name: string;
  custom: boolean;
  schema?: { type?: string; custom?: string; items?: string };
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

function extractActiveSprintName(raw: unknown): string | undefined {
  if (!raw) return undefined;
  const arr = Array.isArray(raw) ? raw : [raw];
  type SprintLike = { name?: string; state?: string };
  const items: SprintLike[] = arr
    .map((entry): SprintLike | undefined => {
      if (entry && typeof entry === 'object') return entry as SprintLike;
      if (typeof entry === 'string') {
        const nameMatch = entry.match(/name=([^,\]]+)/);
        const stateMatch = entry.match(/state=([^,\]]+)/);
        return {
          name: nameMatch?.[1],
          state: stateMatch?.[1],
        };
      }
      return undefined;
    })
    .filter((x): x is SprintLike => Boolean(x));
  const active = items.find((s) => s.state?.toLowerCase() === 'active');
  return (active ?? items[items.length - 1])?.name;
}

function extractCustomFieldValue(raw: unknown, type: string): unknown {
  if (raw === null || raw === undefined) return undefined;
  switch (type) {
    case 'scalar':
      return typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'
        ? raw
        : undefined;
    case 'number':
      return typeof raw === 'number' ? raw : undefined;
    case 'select':
      if (typeof raw === 'object' && raw !== null && 'value' in raw) {
        return (raw as { value: unknown }).value;
      }
      return undefined;
    case 'user':
      if (typeof raw === 'object' && raw !== null && 'displayName' in raw) {
        return (raw as { displayName: unknown }).displayName;
      }
      return undefined;
    case 'sprint':
      return extractActiveSprintName(raw);
    case 'array':
      if (!Array.isArray(raw)) return undefined;
      return raw
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && 'value' in item) {
            return (item as { value: unknown }).value;
          }
          if (item && typeof item === 'object' && 'name' in item) {
            return (item as { name: unknown }).name;
          }
          return undefined;
        })
        .filter((x) => x !== undefined);
    default:
      return undefined;
  }
}

const COMMON_EPIC_FIELDS = [
  'customfield_10014',
  'customfield_10008',
  'customfield_10001',
  'customfield_10011',
];

export class JiraClient {
  private config: JiraConfig;
  private authHeader: string;
  private fieldsCache?: JiraFieldMeta[];
  private sprintFieldIdCache?: string | null;
  private storyPointsFieldIdCache?: string | null;

  constructor(config: JiraConfig, apiToken: string) {
    this.config = config;
    this.authHeader = `Basic ${Buffer.from(`${config.userEmail}:${apiToken}`).toString('base64')}`;
  }

  async listFields(): Promise<JiraFieldMeta[]> {
    if (this.fieldsCache) return this.fieldsCache;
    const all = await this.makeRequest<JiraFieldMeta[]>('/field');
    this.fieldsCache = all;
    return all;
  }

  async detectSprintFieldId(): Promise<string | undefined> {
    if (this.sprintFieldIdCache !== undefined) return this.sprintFieldIdCache ?? undefined;
    try {
      const fields = await this.listFields();
      const match = fields.find(
        (f) =>
          f.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint' ||
          f.name?.toLowerCase() === 'sprint'
      );
      this.sprintFieldIdCache = match?.id ?? null;
      return match?.id;
    } catch {
      this.sprintFieldIdCache = null;
      return undefined;
    }
  }

  async detectStoryPointsFieldId(): Promise<string | undefined> {
    if (this.storyPointsFieldIdCache !== undefined) return this.storyPointsFieldIdCache ?? undefined;
    try {
      const fields = await this.listFields();
      const match = fields.find(
        (f) =>
          f.schema?.custom === 'com.atlassian.jira.plugin.system.customfieldtypes:float' &&
          /story\s*points?/i.test(f.name ?? '')
      ) ?? fields.find((f) => /^story\s*points?$/i.test(f.name ?? ''));
      this.storyPointsFieldIdCache = match?.id ?? null;
      return match?.id;
    } catch {
      this.storyPointsFieldIdCache = null;
      return undefined;
    }
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
    attachmentMetadata: Array<{ id: string; filename: string; url?: string }> = [],
    fullChangelog = false
  ): HistoryEntry[] {
    const history: HistoryEntry[] = [];

    for (const comment of comments) {
      history.push({
        type: 'comment',
        author: comment.author.displayName,
        date: comment.created,
        content: this.convertADFToMarkdown(comment.body, attachmentMetadata),
        id: comment.id,
        authorAccountId: comment.author.accountId,
      });
    }

    for (const change of changelog) {
      for (const item of change.items) {
        if (item.field === 'status') {
          history.push({
            type: 'status_change',
            author: change.author.displayName,
            date: change.created,
            content: `${item.fromString || 'None'} → ${item.toString}`,
          });
          continue;
        }
        if (!fullChangelog) continue;
        history.push({
          type: 'field_change',
          field: item.field,
          author: change.author.displayName,
          date: change.created,
          content: `${item.field}: ${item.fromString || 'None'} → ${item.toString || 'None'}`,
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

  async searchAssignableUsers(opts: {
    query: string;
    issueKey?: string;
    project?: string;
    maxResults?: number;
  }): Promise<JiraUser[]> {
    const params = new URLSearchParams();
    params.set('query', opts.query);
    if (opts.issueKey) params.set('issueKey', opts.issueKey);
    if (opts.project) params.set('project', opts.project);
    params.set('maxResults', String(opts.maxResults ?? 50));
    return this.makeRequest<JiraUser[]>(`/user/assignable/search?${params.toString()}`);
  }

  async searchUsers(query: string, maxResults = 50): Promise<JiraUser[]> {
    const params = new URLSearchParams();
    params.set('query', query);
    params.set('maxResults', String(maxResults));
    return this.makeRequest<JiraUser[]>(`/user/search?${params.toString()}`);
  }

  async fetchIssueDetails(
    issueKey: string,
    options: FetchIssueDetailsOptions = {}
  ): Promise<JiraTaskData> {
    const baseFields = [
      'summary',
      'description',
      'status',
      'parent',
      'attachment',
      'issuetype',
      ...COMMON_EPIC_FIELDS,
    ];

    const sprintFieldId =
      options.customFieldDefs?.sprint?.id ?? (await this.detectSprintFieldId());
    const storyPointsFieldId =
      options.customFieldDefs?.storyPoints?.id ?? (await this.detectStoryPointsFieldId());

    const includeComments = options.includeComments ?? true;
    const includeChangelog = options.includeChangelog ?? true;

    const extraFields = options.jiraFieldIds ?? [];
    const fieldSet = new Set<string>([...baseFields, ...extraFields]);
    if (sprintFieldId) fieldSet.add(sprintFieldId);
    if (storyPointsFieldId) fieldSet.add(storyPointsFieldId);
    if (options.includeLinks) fieldSet.add('issuelinks');

    const fields = [...fieldSet].join(',');
    const response = await this.makeRequest<JiraIssue>(`/issue/${issueKey}?fields=${fields}`);

    const comments = includeComments ? await this.fetchIssueComments(issueKey) : [];
    const changelog = includeChangelog ? await this.fetchIssueChangelog(issueKey) : [];

    const attachmentMetadata =
      response.fields.attachment?.map((att) => ({
        id: att.id,
        filename: att.filename,
        url: att.content,
      })) || [];

    const history = this.mergeHistory(
      comments,
      changelog,
      attachmentMetadata,
      options.fullChangelog ?? false
    );

    const task = this.buildTaskData(response, attachmentMetadata, history, {
      sprintFieldId,
      storyPointsFieldId,
      customFieldDefs: options.customFieldDefs ?? {},
    });

    if (options.includeWorklog) task.worklogs = await this.fetchIssueWorklogs(issueKey);

    return task;
  }

  private buildTaskData(
    response: JiraIssue,
    attachmentMetadata: Array<{ id: string; filename: string; url?: string }>,
    history: HistoryEntry[],
    ctx: {
      sprintFieldId?: string;
      storyPointsFieldId?: string;
      customFieldDefs: CustomFieldDefs;
    }
  ): JiraTaskData {
    const f = response.fields;

    const data: JiraTaskData = {
      key: response.key,
      title: f.summary,
      status: f.status?.name || 'Unknown',
      description: this.convertADFToMarkdown(f.description, attachmentMetadata),
      issueType: f.issuetype?.name,
      parent: f.parent
        ? {
            key: f.parent.key,
            title: f.parent.fields.summary,
            status: f.parent.fields.status?.name,
          }
        : undefined,
      epic: this.extractEpicFromFields(f),
      attachments:
        f.attachment?.map((att) => ({
          id: att.id,
          filename: att.filename,
          url: att.content,
          size: att.size,
        })) || [],
      history,
    };

    const priority = f.priority as { name?: string } | undefined;
    if (priority?.name) data.priority = priority.name;

    const resolution = f.resolution as { name?: string } | undefined;
    if (resolution?.name) data.resolution = resolution.name;

    const assignee = f.assignee as { displayName?: string } | undefined;
    if (assignee?.displayName) data.assignee = assignee.displayName;
    const reporter = f.reporter as { displayName?: string } | undefined;
    if (reporter?.displayName) data.reporter = reporter.displayName;
    const creator = f.creator as { displayName?: string } | undefined;
    if (creator?.displayName) data.creator = creator.displayName;

    if (typeof f.created === 'string') data.createdAt = f.created;
    if (typeof f.updated === 'string') data.updatedAt = f.updated;
    if (typeof f.duedate === 'string' && f.duedate) data.dueDate = f.duedate;
    if (typeof f.resolutiondate === 'string' && f.resolutiondate) {
      data.resolutionDate = f.resolutiondate;
    }

    const components = f.components as Array<{ name: string }> | undefined;
    if (components?.length) data.components = components.map((c) => c.name);

    const labels = f.labels as string[] | undefined;
    if (labels?.length) data.labels = labels;

    const fixVersions = f.fixVersions as Array<{ name: string }> | undefined;
    if (fixVersions?.length) data.fixVersions = fixVersions.map((v) => v.name);
    const versions = f.versions as Array<{ name: string }> | undefined;
    if (versions?.length) data.versions = versions.map((v) => v.name);

    if (ctx.sprintFieldId) {
      const sprintField = f[ctx.sprintFieldId];
      const sprintName = extractActiveSprintName(sprintField);
      if (sprintName) data.sprint = sprintName;
    }
    if (ctx.storyPointsFieldId) {
      const sp = f[ctx.storyPointsFieldId];
      if (typeof sp === 'number') data.storyPoints = sp;
    }

    const tt = f.timetracking as
      | { originalEstimate?: string; remainingEstimate?: string; timeSpent?: string }
      | undefined;
    if (tt && (tt.originalEstimate || tt.remainingEstimate || tt.timeSpent)) {
      data.timetracking = {
        originalEstimate: tt.originalEstimate,
        remainingEstimate: tt.remainingEstimate,
        timeSpent: tt.timeSpent,
      };
    }

    const issueLinks = f.issuelinks as
      | Array<{
          id: string;
          type: { inward?: string; outward?: string; name?: string };
          inwardIssue?: { key: string; fields: { summary: string; status?: { name: string } } };
          outwardIssue?: { key: string; fields: { summary: string; status?: { name: string } } };
        }>
      | undefined;
    if (issueLinks?.length) {
      const mapped: IssueLinkSummary[] = [];
      for (const link of issueLinks) {
        if (link.inwardIssue) {
          mapped.push({
            id: link.id,
            type: link.type.inward ?? link.type.name ?? 'relates to',
            key: link.inwardIssue.key,
            title: link.inwardIssue.fields.summary,
            status: link.inwardIssue.fields.status?.name,
          });
        } else if (link.outwardIssue) {
          mapped.push({
            id: link.id,
            type: link.type.outward ?? link.type.name ?? 'relates to',
            key: link.outwardIssue.key,
            title: link.outwardIssue.fields.summary,
            status: link.outwardIssue.fields.status?.name,
          });
        }
      }
      if (mapped.length) data.issueLinks = mapped;
    }

    const customFieldDefs = ctx.customFieldDefs;
    if (Object.keys(customFieldDefs).length > 0) {
      const cf: Record<string, unknown> = {};
      for (const [friendly, def] of Object.entries(customFieldDefs)) {
        if (friendly === 'sprint' || friendly === 'storyPoints') continue;
        const raw = f[def.id];
        const value = extractCustomFieldValue(raw, def.type);
        if (value !== undefined && value !== null && value !== '') cf[friendly] = value;
      }
      if (Object.keys(cf).length > 0) data.customFields = cf;
    }

    return data;
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

  async getComment(issueKey: string, commentId: string): Promise<JiraComment> {
    return this.makeRequest<JiraComment>(`/issue/${issueKey}/comment/${commentId}`);
  }

  async fetchIssueWorklogs(issueKey: string): Promise<WorklogSummary[]> {
    const worklogs: WorklogSummary[] = [];
    const maxResults = 100;
    let startAt = 0;
    let total: number;

    do {
      const response = await this.makeRequest<{
        worklogs: Array<{
          author: { displayName: string };
          started: string;
          timeSpent: string;
          comment?: string | JiraADFDocument;
        }>;
        total: number;
        startAt: number;
        maxResults: number;
      }>(`/issue/${issueKey}/worklog?startAt=${startAt}&maxResults=${maxResults}`);

      for (const worklog of response.worklogs) {
        const entry: WorklogSummary = {
          author: worklog.author.displayName,
          started: worklog.started,
          timeSpent: worklog.timeSpent,
        };
        if (worklog.comment) entry.comment = this.convertADFToMarkdown(worklog.comment);
        worklogs.push(entry);
      }

      total = response.total;
      startAt += response.maxResults;
    } while (startAt < total);

    return worklogs;
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
    const exact = response.values.find((b) => b.name.toLowerCase() === name.toLowerCase());
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
    const column = config.columnConfig.columns.find(
      (c) => c.name.toLowerCase() === columnName.toLowerCase()
    );
    if (!column) {
      const available = config.columnConfig.columns.map((c) => c.name).join(', ');
      throw new Error(`Column "${columnName}" not found on board "${boardName}". Available: ${available}`);
    }
    return column.statuses.map((s) => s.id);
  }

  async getBoardColumnNames(boardName: string): Promise<string[]> {
    const board = await this.findBoardByName(boardName);
    const config = await this.getBoardConfiguration(board.id);
    return config.columnConfig.columns.map((c) => c.name);
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

  async searchIssues(
    jql: string,
    opts: { fields?: string[]; limit?: number; nextPageToken?: string } = {}
  ): Promise<JiraSearchPage<JqlIssue>> {
    const body: Record<string, unknown> = {
      jql,
      fields: opts.fields ?? ['summary', 'status', 'assignee', 'issuetype'],
      maxResults: opts.limit ?? 50,
    };
    if (opts.nextPageToken) body.nextPageToken = opts.nextPageToken;
    const response = await this.makeRequest<{
      issues: JqlIssue[];
      nextPageToken?: string;
      isLast?: boolean;
    }>('/search/jql', { method: 'POST', body: JSON.stringify(body) });
    return {
      issues: response.issues,
      nextPageToken: response.nextPageToken,
      isLast: response.isLast !== false,
    };
  }

  async listProjects(
    opts: { query?: string; startAt?: number; limit?: number } = {}
  ): Promise<JiraPage<JiraProject>> {
    const params = new URLSearchParams();
    if (opts.query) params.set('query', opts.query);
    if (opts.startAt !== undefined) params.set('startAt', String(opts.startAt));
    if (opts.limit !== undefined) params.set('maxResults', String(opts.limit));
    const qs = params.toString();
    return this.makeRequest<JiraPage<JiraProject>>(`/project/search${qs ? `?${qs}` : ''}`);
  }

  async listBoards(
    opts: {
      projectKey?: string;
      type?: 'scrum' | 'kanban' | 'simple';
      name?: string;
      startAt?: number;
      limit?: number;
    } = {}
  ): Promise<JiraPage<JiraBoard>> {
    const params = new URLSearchParams();
    if (opts.projectKey) params.set('projectKeyOrId', opts.projectKey);
    if (opts.type) params.set('type', opts.type);
    if (opts.name) params.set('name', opts.name);
    if (opts.startAt !== undefined) params.set('startAt', String(opts.startAt));
    if (opts.limit !== undefined) params.set('maxResults', String(opts.limit));
    const qs = params.toString();
    return this.makeAgileRequest<JiraPage<JiraBoard>>(`/board${qs ? `?${qs}` : ''}`);
  }

  async listSprints(
    boardId: number,
    opts: {
      state?: 'active' | 'future' | 'closed';
      startAt?: number;
      limit?: number;
    } = {}
  ): Promise<JiraPage<JiraSprint>> {
    const params = new URLSearchParams();
    if (opts.state) params.set('state', opts.state);
    if (opts.startAt !== undefined) params.set('startAt', String(opts.startAt));
    if (opts.limit !== undefined) params.set('maxResults', String(opts.limit));
    const qs = params.toString();
    return this.makeAgileRequest<JiraPage<JiraSprint>>(
      `/board/${boardId}/sprint${qs ? `?${qs}` : ''}`
    );
  }

  async listIssueTypes(projectKey?: string): Promise<JiraIssueType[]> {
    if (!projectKey) return this.makeRequest<JiraIssueType[]>('/issuetype');
    const project = await this.makeRequest<{ id: string }>(`/project/${projectKey}`);
    return this.makeRequest<JiraIssueType[]>(`/issuetype/project?projectId=${project.id}`);
  }

  async listComponents(projectKey: string): Promise<JiraComponent[]> {
    return this.makeRequest<JiraComponent[]>(`/project/${projectKey}/components`);
  }

  /**
   * Fetch the fields available on the create screen for a given issue type, including
   * allowedValues for select fields — helps users discover valid custom-field option strings.
   */
  async getCreateFields(projectKey: string, issueTypeName: string): Promise<JiraCreateField[]> {
    const types = await this.listIssueTypes(projectKey);
    const match = types.find((t) => t.name.toLowerCase() === issueTypeName.toLowerCase());
    if (!match) {
      throw new Error(
        `Issue type "${issueTypeName}" not found in project ${projectKey}. ` +
          `Available: ${types.map((t) => t.name).join(', ')}.`
      );
    }
    type RawAllowed = { value?: string; name?: string };
    type RawCreateField = {
      fieldId: string;
      name: string;
      required: boolean;
      schema?: { type?: string };
      allowedValues?: RawAllowed[];
    };
    const response = await this.makeRequest<{ fields: RawCreateField[] }>(
      `/issue/createmeta/${projectKey}/issuetypes/${match.id}`
    );
    return response.fields.map((f) => ({
      fieldId: f.fieldId,
      name: f.name,
      required: f.required,
      schemaType: f.schema?.type,
      allowedValues: f.allowedValues
        ?.map((v) => v.value ?? v.name)
        .filter((v): v is string => Boolean(v)),
    }));
  }

  async listLinkTypes(): Promise<JiraIssueLinkType[]> {
    const response = await this.makeRequest<{ issueLinkTypes: JiraIssueLinkType[] }>(
      '/issueLinkType'
    );
    return response.issueLinkTypes;
  }

  async listPriorities(): Promise<JiraPriority[]> {
    return this.makeRequest<JiraPriority[]>('/priority');
  }

  async listStatuses(projectKey?: string): Promise<JiraStatus[]> {
    if (!projectKey) return this.makeRequest<JiraStatus[]>('/status');
    const statuses = await this.makeRequest<
      Array<{ statuses: JiraStatus[] }>
    >(`/project/${projectKey}/statuses`);
    const seen = new Map<string, JiraStatus>();
    for (const entry of statuses) {
      for (const s of entry.statuses) seen.set(s.id, s);
    }
    return [...seen.values()];
  }

  async getIssueTransitions(issueKey: string): Promise<JiraTransition[]> {
    const response = await this.makeRequest<{ transitions: JiraTransition[] }>(
      `/issue/${issueKey}/transitions`
    );
    return response.transitions;
  }

  async resolveTransition(
    issueKey: string,
    targetStatus: string
  ): Promise<{ id: string; name: string; toName: string }> {
    const transitions = await this.getIssueTransitions(issueKey);
    const target = targetStatus.toLowerCase();
    const match =
      transitions.find((t) => t.to.name.toLowerCase() === target) ??
      transitions.find((t) => t.name.toLowerCase() === target);
    if (!match) {
      const available = transitions.map((t) => `"${t.name}" → "${t.to.name}"`).join(', ');
      throw new Error(
        `No transition to "${targetStatus}" available on ${issueKey}. Available: ${available}`
      );
    }
    return { id: match.id, name: match.name, toName: match.to.name };
  }

  async transitionIssue(
    issueKey: string,
    targetStatus: string,
    opts: { dryRun?: boolean } = {}
  ): Promise<Pick<JiraTransition, 'id' | 'name'>> {
    const match = await this.resolveTransition(issueKey, targetStatus);
    if (opts.dryRun) return { id: match.id, name: match.name };
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

  async createIssue(input: {
    projectKey: string;
    issueType: string;
    summary: string;
    descriptionMarkdown?: string;
    assigneeAccountId?: string;
    labels?: string[];
    priority?: string;
    parentKey?: string;
    components?: string[];
    customFields?: Record<string, unknown>;
  }): Promise<{ id: string; key: string; self: string }> {
    const fields: Record<string, unknown> = {
      project: { key: input.projectKey },
      issuetype: { name: input.issueType },
      summary: input.summary,
    };
    if (input.descriptionMarkdown !== undefined) {
      fields.description = markdownToWiki(input.descriptionMarkdown);
    }
    if (input.assigneeAccountId) fields.assignee = { accountId: input.assigneeAccountId };
    if (input.labels) fields.labels = input.labels;
    if (input.priority) fields.priority = { name: input.priority };
    if (input.parentKey) fields.parent = { key: input.parentKey };
    if (input.components) fields.components = input.components.map((name) => ({ name }));
    if (input.customFields) Object.assign(fields, input.customFields);

    const url = `${this.config.baseUrl}/rest/api/2/issue`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Jira createIssue failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }
    return response.json() as Promise<{ id: string; key: string; self: string }>;
  }

  async editIssue(
    issueKey: string,
    input: {
      summary?: string;
      descriptionMarkdown?: string;
      assigneeAccountId?: string | null;
      labels?: string[];
      priority?: string;
      components?: string[];
      customFields?: Record<string, unknown>;
    }
  ): Promise<void> {
    const fields: Record<string, unknown> = {};
    if (input.summary !== undefined) fields.summary = input.summary;
    if (input.descriptionMarkdown !== undefined) {
      fields.description = markdownToWiki(input.descriptionMarkdown);
    }
    if (input.assigneeAccountId !== undefined) {
      fields.assignee = input.assigneeAccountId === null
        ? null
        : { accountId: input.assigneeAccountId };
    }
    if (input.labels !== undefined) fields.labels = input.labels;
    if (input.priority !== undefined) fields.priority = { name: input.priority };
    if (input.components !== undefined) fields.components = input.components.map((name) => ({ name }));
    if (input.customFields !== undefined) Object.assign(fields, input.customFields);

    if (Object.keys(fields).length === 0) {
      throw new Error('editIssue called with no fields to update.');
    }

    const url = `${this.config.baseUrl}/rest/api/2/issue/${issueKey}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });
    if (!response.ok && response.status !== 204) {
      const errorText = await response.text();
      throw new Error(
        `Jira editIssue failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }
  }

  async assignIssue(issueKey: string, accountIdOrNull: string | null): Promise<void> {
    const url = `${this.config.baseUrl}/rest/api/3/issue/${issueKey}/assignee`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accountId: accountIdOrNull }),
    });
    if (!response.ok && response.status !== 204) {
      const errorText = await response.text();
      throw new Error(
        `Jira assignIssue failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }
  }

  async linkIssues(
    inwardKey: string,
    outwardKey: string,
    linkTypeName: string,
    comment?: string
  ): Promise<void> {
    const payload: Record<string, unknown> = {
      type: { name: linkTypeName },
      inwardIssue: { key: inwardKey },
      outwardIssue: { key: outwardKey },
    };
    if (comment) payload.comment = { body: markdownToWiki(comment) };
    const url = `${this.config.baseUrl}/rest/api/3/issueLink`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok && response.status !== 201) {
      const errorText = await response.text();
      throw new Error(
        `Jira linkIssues failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }
  }

  async removeIssueLink(linkId: string): Promise<void> {
    const url = `${this.config.baseUrl}/rest/api/3/issueLink/${linkId}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: this.authHeader, Accept: 'application/json' },
    });
    if (!response.ok && response.status !== 204) {
      const errorText = await response.text();
      throw new Error(
        `Jira removeIssueLink failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }
  }

  async listWatchers(issueKey: string): Promise<JiraWatcher[]> {
    const response = await this.makeRequest<{ watchers: JiraWatcher[] }>(
      `/issue/${issueKey}/watchers`
    );
    return response.watchers;
  }

  async addWatcher(issueKey: string, accountId: string): Promise<void> {
    const url = `${this.config.baseUrl}/rest/api/3/issue/${issueKey}/watchers`;
    // Jira quirk: body is a JSON string (account id in quotes), not an object
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(accountId),
    });
    if (!response.ok && response.status !== 204) {
      const errorText = await response.text();
      throw new Error(
        `Jira addWatcher failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }
  }

  async removeWatcher(issueKey: string, accountId: string): Promise<void> {
    const url = `${this.config.baseUrl}/rest/api/3/issue/${issueKey}/watchers?accountId=${encodeURIComponent(accountId)}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: this.authHeader, Accept: 'application/json' },
    });
    if (!response.ok && response.status !== 204) {
      const errorText = await response.text();
      throw new Error(
        `Jira removeWatcher failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }
  }

  async uploadAttachment(
    issueKey: string,
    filePath: string
  ): Promise<Array<{ id: string; filename: string; size: number; mimeType?: string }>> {
    await stat(filePath);
    const buf = await readFile(filePath);
    const form = new FormData();
    const arr = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    form.append('file', new Blob([arr]), basename(filePath));

    const url = `${this.config.baseUrl}/rest/api/3/issue/${issueKey}/attachments`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'X-Atlassian-Token': 'no-check',
      },
      body: form,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Jira uploadAttachment failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }
    return response.json() as Promise<
      Array<{ id: string; filename: string; size: number; mimeType?: string }>
    >;
  }

  async getAttachmentMeta(attachmentId: string): Promise<{
    id: string;
    filename: string;
    size: number;
    mimeType?: string;
    author?: string;
  }> {
    const meta = await this.makeRequest<{
      id: string;
      filename: string;
      size: number;
      mimeType?: string;
      author?: { displayName?: string };
    }>(`/attachment/${attachmentId}`);
    return {
      id: meta.id,
      filename: meta.filename,
      size: meta.size,
      mimeType: meta.mimeType,
      author: meta.author?.displayName,
    };
  }

  async deleteAttachment(attachmentId: string): Promise<void> {
    const url = `${this.config.baseUrl}/rest/api/3/attachment/${attachmentId}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: this.authHeader, Accept: 'application/json' },
    });
    if (!response.ok && response.status !== 204) {
      const errorText = await response.text();
      throw new Error(
        `Jira deleteAttachment failed: ${response.status} ${response.statusText}\n${errorText}`
      );
    }
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
