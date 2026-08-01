import { createWriteStream } from 'fs';
import { mkdir, readFile, stat } from 'fs/promises';
import { basename, dirname } from 'path';
import { pipeline } from 'stream/promises';
import type { CustomFieldDefs } from './exportFields.js';
import { COMMON_EPIC_FIELDS, PROJECTABLE_FIELDS, projectIssueFields } from './fieldProjection.js';
import type { AdfDocument } from './adfMedia.js';
import { markdownToWiki } from './markdownToWiki.js';

export type JiraConfig = {
  baseUrl: string;
  projectKey?: string;
  userEmail: string;
  /** Overrides for which redirects this client will follow. See {@link RedirectPolicy}. */
  redirects?: RedirectPolicy;
};

export type JiraUser = {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  active?: boolean;
  accountType?: string;
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
      fields: {
        summary: string;
        status?: { name: string };
        issuetype?: { name: string };
        priority?: { name: string };
      };
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
  renderedBody?: string;
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

export type UploadedAttachment = {
  id: string;
  filename: string;
  size: number;
  self?: string;
  mimeType?: string;
  created?: string;
  content?: string;
  thumbnail?: string;
  author?: { accountId?: string; displayName?: string; emailAddress?: string };
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

export type ParentRef = {
  key: string;
  title: string;
  status?: string;
  issueType?: string;
  priority?: string;
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
  parent?: ParentRef;
  epic?: { key: string; title: string };
  subtasks?: SubtaskSummary[];
  customFields?: Record<string, unknown>;
  attachments: Array<{ id: string; filename: string; url: string; size: number }>;
  history: HistoryEntry[];
  comments?: Array<{ id: string; author: string; created: string; body: string }>;
  worklogs?: WorklogSummary[];
};

export type RawIssue = {
  key: string;
  fields: Record<string, unknown>;
  names?: Record<string, string>;
  renderedFields?: Record<string, unknown>;
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
  parent?: ParentRef;
  epic?: { key: string; title: string };
  subtasks?: SubtaskSummary[];
};

export type JiraApiErrorInit = {
  status: number;
  statusText: string;
  body: string;
  headers: Record<string, string>;
  url?: string;
};

// Tolerates responses that are not real `Response` objects (test doubles,
// proxies) — a missing header bag must never mask the underlying HTTP error.
const headersToRecord = (headers: Headers | undefined): Record<string, string> => {
  const record: Record<string, string> = {};
  if (typeof headers?.forEach !== 'function') return record;
  headers.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return record;
};

const parseErrorMessages = (body: string): string[] | undefined => {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const { errorMessages, errors } = parsed as {
      errorMessages?: unknown;
      errors?: unknown;
    };
    const fromArray = Array.isArray(errorMessages)
      ? errorMessages.filter((entry): entry is string => typeof entry === 'string')
      : [];
    const fromFields =
      errors && typeof errors === 'object'
        ? Object.values(errors as Record<string, unknown>).filter(
            (entry): entry is string => typeof entry === 'string'
          )
        : [];
    const all = [...fromArray, ...fromFields];
    return all.length > 0 ? all : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Thrown for every non-2xx Jira response. Extends `Error` with a byte-identical
 * `message` to the plain errors this client used to throw, so string-matching
 * consumers keep working, while exposing the response data they previously had
 * no way to read — notably `retry-after` and `x-authentication-denied-reason`.
 *
 * `headers` is a plain lowercase-keyed record rather than a `Headers` instance:
 * consumers frequently bundle this package (esbuild `noExternal`) or cross an
 * ESM/CJS boundary, and a POJO survives that, structured cloning and JSON
 * serialisation, whereas a `Headers` realm mismatch does not.
 */
export class JiraApiError extends Error {
  /** Duck-type brand — reliable where `instanceof` is not (bundled/duplicated copies). */
  readonly isJiraApiError = true as const;
  readonly status: number;
  readonly statusText: string;
  readonly body: string;
  readonly headers: Record<string, string>;
  readonly errorMessages?: string[];
  readonly url?: string;

  constructor(message: string, init: JiraApiErrorInit) {
    super(message);
    // `instanceof` across a bundle boundary is unreliable, and transpiled
    // `extends Error` can lose the prototype entirely — pin it explicitly.
    Object.setPrototypeOf(this, JiraApiError.prototype);
    this.name = 'JiraApiError';
    this.status = init.status;
    this.statusText = init.statusText;
    this.body = init.body;
    this.headers = init.headers;
    this.url = init.url;
    this.errorMessages = parseErrorMessages(init.body);
  }

  /** First message Jira itself reported, if its error body was JSON. */
  get firstErrorMessage(): string | undefined {
    return this.errorMessages?.[0];
  }

  /** `Retry-After` in seconds, accepting both the delta and HTTP-date forms. */
  get retryAfterSeconds(): number | undefined {
    const raw = this.headers['retry-after'];
    if (!raw) return undefined;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds;
    const asDate = Date.parse(raw);
    if (Number.isNaN(asDate)) return undefined;
    return Math.max(0, Math.round((asDate - Date.now()) / 1000));
  }

  /**
   * Atlassian's captcha challenge header — the only signal telling a user they
   * must log into Jira in a browser once before the API will answer again.
   */
  get deniedReason(): string | undefined {
    return this.headers['x-authentication-denied-reason'];
  }

  /**
   * Structural check that works across duplicated/bundled copies of this class,
   * where `instanceof` silently returns false.
   */
  static isJiraApiError(error: unknown): error is JiraApiError {
    return (
      error instanceof Error &&
      (error as Partial<JiraApiError>).isJiraApiError === true &&
      typeof (error as Partial<JiraApiError>).status === 'number'
    );
  }

  /** Consumes the response body and builds the error with the legacy message. */
  static async fromResponse(response: Response, prefix: string): Promise<JiraApiError> {
    const body = await response.text();
    return new JiraApiError(
      `${prefix}: ${response.status} ${response.statusText}\n${body}`,
      {
        status: response.status,
        statusText: response.statusText,
        body,
        headers: headersToRecord(response.headers),
        url: response.url || undefined,
      }
    );
  }
}

/** Standalone form of {@link JiraApiError.isJiraApiError}, for `import { isJiraApiError }`. */
export const isJiraApiError = (error: unknown): error is JiraApiError =>
  JiraApiError.isJiraApiError(error);

/**
 * Controls which redirects this client is willing to follow. Every HTTP call
 * runs with `redirect: 'manual'` so a redirect is a decision, not a default:
 * an allowlisted Jira host that answers `302 Location: http://169.254.169.254/`
 * must not turn into a request against the caller's internal network.
 */
export type RedirectPolicy = {
  /** Hops to follow before giving up. Default {@link DEFAULT_MAX_REDIRECTS}. */
  maxRedirects?: number;
  /**
   * Hosts a redirect may point at, on top of the request's own host and the
   * built-in Atlassian list ({@link ATLASSIAN_REDIRECT_HOSTS}). Needed for Jira
   * Data Center and custom domains that redirect to a sibling host (SSO, CDN).
   * An entry starting with `.` matches that domain and its subdomains
   * (`.example.com`); anything else must match the host exactly.
   */
  allowedRedirectHosts?: string[];
};

export const DEFAULT_MAX_REDIRECTS = 3;

/**
 * Atlassian-owned domains a Jira Cloud request legitimately bounces to.
 * `atlassianusercontent.com` / `atl-paas.net` / `media.atlassian.com` are where
 * `/rest/api/3/attachment/content/{id}` sends attachment downloads.
 */
export const ATLASSIAN_REDIRECT_HOSTS = [
  '.atlassian.net',
  '.atlassian.com',
  '.jira.com',
  '.atl-paas.net',
  '.atlassianusercontent.com',
] as const;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const normaliseHost = (hostname: string): string =>
  hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');

const isPrivateIpv4 = (hostname: string): boolean => {
  const parts = hostname.split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map(Number);
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return a >= 224;
};

/**
 * Literal addresses and names that must never be reached through a redirect.
 * Note this inspects the *name*, not what it resolves to — see the caveat on
 * {@link requestWithRedirectPolicy}.
 */
const isPrivateHost = (hostname: string): boolean => {
  const host = normaliseHost(hostname);
  if (host === 'localhost' || /\.(localhost|local|internal|home\.arpa)$/.test(host)) return true;
  if (isPrivateIpv4(host)) return true;
  if (!host.includes(':')) return false;
  // IPv6: loopback/unspecified, unique-local (fc00::/7), link-local (fe80::/10),
  // plus IPv4-mapped forms such as `::ffff:127.0.0.1`.
  if (host === '::1' || host === '::') return true;
  if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return true;
  if (/^fe[89ab][0-9a-f]?:/.test(host)) return true;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  return mapped ? isPrivateIpv4(mapped[1]) : false;
};

const isHostAllowed = (hostname: string, allowed: readonly string[]): boolean => {
  const host = normaliseHost(hostname);
  return allowed.some((raw) => {
    const entry = normaliseHost(raw.replace(/^\*/, ''));
    if (!entry) return false;
    if (!entry.startsWith('.')) return host === entry;
    return host === entry.slice(1) || host.endsWith(entry);
  });
};

const redirectRefused = (response: Response, location: string, reason: string): JiraApiError =>
  new JiraApiError(
    `Refused to follow redirect to ${location}: ${reason}`,
    {
      status: response.status,
      statusText: response.statusText,
      body: '',
      headers: headersToRecord(response.headers),
      url: response.url || undefined,
    }
  );

/** Case-insensitively drops credential headers before a cross-origin hop. */
const stripCredentialHeaders = (headers: HeadersInit | undefined): Record<string, string> => {
  const kept: Record<string, string> = {};
  const source = headers instanceof Headers || Array.isArray(headers)
    ? [...new Headers(headers).entries()]
    : Object.entries(headers ?? {});
  for (const [key, value] of source) {
    if (['authorization', 'cookie', 'proxy-authorization'].includes(key.toLowerCase())) continue;
    kept[key] = String(value);
  }
  return kept;
};

/**
 * `fetch` with an explicit redirect policy.
 *
 * **Protects against:** a compromised or hostile Jira host bouncing the client
 * onto an unrelated origin, a scheme downgrade to `http`, a literal private /
 * loopback / link-local / CGNAT / multicast address (IPv4 and IPv6, including
 * the decimal and `::ffff:` forms the WHATWG URL parser normalises), unbounded
 * redirect chains, and credential leakage — `Authorization` and `Cookie` are
 * dropped the moment the origin changes.
 *
 * **Does NOT protect against:** DNS rebinding or a hostname that simply
 * *resolves* to a private address. The check is on the redirect target's name;
 * an allowlisted host pointing its A record at `127.0.0.1` would still be
 * dialled. Closing that requires resolve-then-pin at the socket layer (a custom
 * undici dispatcher), which is out of scope here. It also does not inspect
 * response bodies, and it does not re-validate the *initial* URL — the caller
 * still owns first-hop validation of `baseUrl`.
 */
export const requestWithRedirectPolicy = async (
  input: string,
  init: RequestInit = {},
  policy: RedirectPolicy = {}
): Promise<Response> => {
  const maxRedirects = policy.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const allowedHosts = [...ATLASSIAN_REDIRECT_HOSTS, ...(policy.allowedRedirectHosts ?? [])];
  const origin = new URL(input);

  let currentUrl = input;
  let currentInit: RequestInit = { ...init, redirect: 'manual' };

  for (let hop = 0; ; hop++) {
    const response = await fetch(currentUrl, currentInit);
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers?.get?.('location');
    // A 3xx the caller is meant to see (300, 304, or a malformed redirect).
    if (!location) return response;

    if (hop >= maxRedirects) {
      throw redirectRefused(response, location, `exceeded ${maxRedirects} redirect hops`);
    }

    const from = new URL(currentUrl);
    let target: URL;
    try {
      target = new URL(location, currentUrl);
    } catch {
      throw redirectRefused(response, location, 'target is not a valid URL');
    }

    // The host the caller originally asked for is never an escalation — a Data
    // Center install on a private address must keep working.
    const isOriginHost = normaliseHost(target.hostname) === normaliseHost(origin.hostname);

    if (target.protocol !== 'https:' && !(isOriginHost && target.protocol === from.protocol)) {
      throw redirectRefused(response, target.href, `scheme "${target.protocol}" is not allowed`);
    }
    if (!isOriginHost && isPrivateHost(target.hostname)) {
      throw redirectRefused(response, target.href, 'target is a private or loopback address');
    }
    if (!isOriginHost && !isHostAllowed(target.hostname, allowedHosts)) {
      throw redirectRefused(
        response,
        target.href,
        `host "${target.hostname}" is not in the allowed redirect hosts`
      );
    }

    const crossOrigin = target.origin !== from.origin;
    const method = (currentInit.method ?? 'GET').toUpperCase();
    // Per the fetch spec: 303 always becomes GET, and 301/302 do for POST.
    const downgradeToGet =
      response.status === 303 || (response.status !== 307 && response.status !== 308 && method === 'POST');

    const nextHeaders = crossOrigin ? stripCredentialHeaders(currentInit.headers) : currentInit.headers;
    currentInit = downgradeToGet
      ? { ...currentInit, method: 'GET', body: undefined, headers: nextHeaders, redirect: 'manual' }
      : { ...currentInit, headers: nextHeaders, redirect: 'manual' };
    currentUrl = target.href;
  }
};

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

  /**
   * Single HTTP entry point for the whole client. Every request goes through
   * {@link requestWithRedirectPolicy}, so no call site can silently inherit
   * `fetch`'s default `redirect: 'follow'`.
   */
  private httpRequest(url: string, init: RequestInit = {}): Promise<Response> {
    return requestWithRedirectPolicy(url, init, this.config.redirects);
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
        if (filename) return formatMediaLink(filename);
        const mediaId = node.attrs.id;
        return mediaId ? `![embedded media](media/${mediaId})` : '![embedded media]()';
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
    const response = await this.httpRequest(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw await JiraApiError.fromResponse(response, 'Jira API request failed');
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

    if (includeComments) {
      task.comments = comments.map((comment) => ({
        id: comment.id,
        author: comment.author.displayName,
        created: comment.created,
        body: this.convertADFToMarkdown(comment.body, attachmentMetadata),
      }));
    }

    if (options.includeWorklog) task.worklogs = await this.fetchIssueWorklogs(issueKey);

    return task;
  }

  async fetchIssueRaw(issueKey: string, expand: string[] = ['names']): Promise<RawIssue> {
    const params = new URLSearchParams({ fields: '*all', expand: expand.join(',') });
    return this.makeRequest<RawIssue>(`/issue/${issueKey}?${params.toString()}`);
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
    const selectedKeys = [...PROJECTABLE_FIELDS, ...Object.keys(ctx.customFieldDefs)];
    const projected = projectIssueFields(f, selectedKeys, ctx);

    return {
      key: response.key,
      title: f.summary,
      ...projected,
      status: projected.status || 'Unknown',
      description: this.convertADFToMarkdown(f.description, attachmentMetadata),
      attachments:
        f.attachment?.map((att) => ({
          id: att.id,
          filename: att.filename,
          url: att.content,
          size: att.size,
        })) || [],
      history,
    };
  }

  async fetchIssueComments(
    issueKey: string,
    opts: { rendered?: boolean } = {}
  ): Promise<JiraComment[]> {
    const allComments: JiraComment[] = [];
    const maxResults = 100;
    let startAt = 0;
    let total: number;

    do {
      const params = new URLSearchParams({
        startAt: String(startAt),
        maxResults: String(maxResults),
      });
      if (opts.rendered) params.set('expand', 'renderedBody');
      const response = await this.makeRequest<JiraCommentsResponse>(
        `/issue/${issueKey}/comment?${params.toString()}`
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
    const response = await this.httpRequest(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw await JiraApiError.fromResponse(response, 'Jira addComment failed');
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
    const response = await this.httpRequest(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw await JiraApiError.fromResponse(response, 'Jira addWorklog failed');
    }
    const json = (await response.json()) as { id: string; issueId: string };
    return { id: json.id, issueId: json.issueId };
  }

  async updateComment(issueKey: string, commentId: string, wikiBody: string): Promise<void> {
    const url = `${this.config.baseUrl}/rest/api/2/issue/${issueKey}/comment/${commentId}`;
    const response = await this.httpRequest(url, {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: wikiBody }),
    });
    if (!response.ok) {
      throw await JiraApiError.fromResponse(response, 'Jira updateComment failed');
    }
  }

  async updateCommentAdf(issueKey: string, commentId: string, adf: AdfDocument): Promise<void> {
    const url = `${this.config.baseUrl}/rest/api/3/issue/${issueKey}/comment/${commentId}`;
    const response = await this.httpRequest(url, {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: adf }),
    });
    if (!response.ok) {
      throw await JiraApiError.fromResponse(response, 'Jira updateCommentAdf failed');
    }
  }

  async getIssueDescriptionAdf(issueKey: string): Promise<unknown> {
    const response = await this.makeRequest<{ fields: { description?: unknown } }>(
      `/issue/${issueKey}?fields=description`
    );
    return response.fields.description;
  }

  async updateIssueDescriptionAdf(issueKey: string, adf: AdfDocument): Promise<void> {
    const url = `${this.config.baseUrl}/rest/api/3/issue/${issueKey}`;
    const response = await this.httpRequest(url, {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields: { description: adf } }),
    });
    if (!response.ok && response.status !== 204) {
      throw await JiraApiError.fromResponse(response, 'Jira updateIssueDescriptionAdf failed');
    }
  }

  async deleteComment(issueKey: string, commentId: string): Promise<void> {
    const url = `${this.config.baseUrl}/rest/api/2/issue/${issueKey}/comment/${commentId}`;
    const response = await this.httpRequest(url, {
      method: 'DELETE',
      headers: { Authorization: this.authHeader, Accept: 'application/json' },
    });
    if (!response.ok && response.status !== 204) {
      throw await JiraApiError.fromResponse(response, 'Jira deleteComment failed');
    }
  }

  private async makeAgileRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.baseUrl}/rest/agile/1.0${endpoint}`;
    const response = await this.httpRequest(url, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!response.ok) {
      throw await JiraApiError.fromResponse(response, 'Jira Agile API request failed');
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
    const response = await this.httpRequest(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transition: { id: match.id } }),
    });
    if (!response.ok && response.status !== 204) {
      throw await JiraApiError.fromResponse(response, 'Jira transition failed');
    }
    return { name: match.name, id: match.id };
  }

  async createIssue(input: {
    projectKey: string;
    issueType: string;
    summary: string;
    descriptionMarkdown?: string;
    noWiki?: boolean;
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
      fields.description = input.noWiki
        ? input.descriptionMarkdown
        : markdownToWiki(input.descriptionMarkdown);
    }
    if (input.assigneeAccountId) fields.assignee = { accountId: input.assigneeAccountId };
    if (input.labels) fields.labels = input.labels;
    if (input.priority) fields.priority = { name: input.priority };
    if (input.parentKey) fields.parent = { key: input.parentKey };
    if (input.components) fields.components = input.components.map((name) => ({ name }));
    if (input.customFields) Object.assign(fields, input.customFields);

    const url = `${this.config.baseUrl}/rest/api/2/issue`;
    const response = await this.httpRequest(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });
    if (!response.ok) {
      throw await JiraApiError.fromResponse(response, 'Jira createIssue failed');
    }
    return response.json() as Promise<{ id: string; key: string; self: string }>;
  }

  async editIssue(
    issueKey: string,
    input: {
      summary?: string;
      descriptionMarkdown?: string;
      noWiki?: boolean;
      assigneeAccountId?: string | null;
      labels?: string[];
      priority?: string;
      parentKey?: string;
      dueDate?: string;
      components?: string[];
      customFields?: Record<string, unknown>;
    }
  ): Promise<void> {
    const fields: Record<string, unknown> = {};
    if (input.summary !== undefined) fields.summary = input.summary;
    if (input.descriptionMarkdown !== undefined) {
      fields.description = input.noWiki
        ? input.descriptionMarkdown
        : markdownToWiki(input.descriptionMarkdown);
    }
    if (input.assigneeAccountId !== undefined) {
      fields.assignee = input.assigneeAccountId === null
        ? null
        : { accountId: input.assigneeAccountId };
    }
    if (input.labels !== undefined) fields.labels = input.labels;
    if (input.priority !== undefined) fields.priority = { name: input.priority };
    if (input.parentKey !== undefined) fields.parent = { key: input.parentKey };
    if (input.dueDate !== undefined) fields.duedate = input.dueDate;
    if (input.components !== undefined) fields.components = input.components.map((name) => ({ name }));
    if (input.customFields !== undefined) Object.assign(fields, input.customFields);

    if (Object.keys(fields).length === 0) {
      throw new Error('editIssue called with no fields to update.');
    }

    const url = `${this.config.baseUrl}/rest/api/2/issue/${issueKey}`;
    const response = await this.httpRequest(url, {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    });
    if (!response.ok && response.status !== 204) {
      throw await JiraApiError.fromResponse(response, 'Jira editIssue failed');
    }
  }

  async assignIssue(issueKey: string, accountIdOrNull: string | null): Promise<void> {
    const url = `${this.config.baseUrl}/rest/api/3/issue/${issueKey}/assignee`;
    const response = await this.httpRequest(url, {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ accountId: accountIdOrNull }),
    });
    if (!response.ok && response.status !== 204) {
      throw await JiraApiError.fromResponse(response, 'Jira assignIssue failed');
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
    const response = await this.httpRequest(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok && response.status !== 201) {
      throw await JiraApiError.fromResponse(response, 'Jira linkIssues failed');
    }
  }

  async removeIssueLink(linkId: string): Promise<void> {
    const url = `${this.config.baseUrl}/rest/api/3/issueLink/${linkId}`;
    const response = await this.httpRequest(url, {
      method: 'DELETE',
      headers: { Authorization: this.authHeader, Accept: 'application/json' },
    });
    if (!response.ok && response.status !== 204) {
      throw await JiraApiError.fromResponse(response, 'Jira removeIssueLink failed');
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
    const response = await this.httpRequest(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(accountId),
    });
    if (!response.ok && response.status !== 204) {
      throw await JiraApiError.fromResponse(response, 'Jira addWatcher failed');
    }
  }

  async removeWatcher(issueKey: string, accountId: string): Promise<void> {
    const url = `${this.config.baseUrl}/rest/api/3/issue/${issueKey}/watchers?accountId=${encodeURIComponent(accountId)}`;
    const response = await this.httpRequest(url, {
      method: 'DELETE',
      headers: { Authorization: this.authHeader, Accept: 'application/json' },
    });
    if (!response.ok && response.status !== 204) {
      throw await JiraApiError.fromResponse(response, 'Jira removeWatcher failed');
    }
  }

  async uploadAttachment(issueKey: string, filePath: string): Promise<UploadedAttachment[]> {
    await stat(filePath);
    const buf = await readFile(filePath);
    const form = new FormData();
    const arr = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    form.append('file', new Blob([arr]), basename(filePath));

    const url = `${this.config.baseUrl}/rest/api/3/issue/${issueKey}/attachments`;
    const response = await this.httpRequest(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'X-Atlassian-Token': 'no-check',
      },
      body: form,
    });
    if (!response.ok) {
      throw await JiraApiError.fromResponse(response, 'Jira uploadAttachment failed');
    }
    return response.json() as Promise<UploadedAttachment[]>;
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
    const response = await this.httpRequest(url, {
      method: 'DELETE',
      headers: { Authorization: this.authHeader, Accept: 'application/json' },
    });
    if (!response.ok && response.status !== 204) {
      throw await JiraApiError.fromResponse(response, 'Jira deleteAttachment failed');
    }
  }

  async downloadAttachment(attachmentUrl: string, outputPath: string): Promise<void> {
    await mkdir(dirname(outputPath), { recursive: true });

    const response = await this.httpRequest(attachmentUrl, {
      headers: { Authorization: this.authHeader },
    });

    if (!response.ok) {
      // Body is intentionally not consumed here (it is the file stream), so the
      // message keeps its historical shape without a trailing body section.
      throw new JiraApiError(
        `Failed to download attachment: ${response.status} ${response.statusText}`,
        {
          status: response.status,
          statusText: response.statusText,
          body: '',
          headers: headersToRecord(response.headers),
          url: response.url || undefined,
        }
      );
    }
    if (!response.body) throw new Error('Response body is null');

    const fileStream = createWriteStream(outputPath);
    await pipeline(response.body as unknown as NodeJS.ReadableStream, fileStream);
  }
}
