import { mkdirSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { JiraClient, type JiraConfig, type JiraTaskData } from './jiraClient.js';
import { extractFrames, isVideoFile } from 'framewise';
import {
  resolveFieldSet,
  type CustomFieldDefs,
  type FieldSelector,
} from './exportFields.js';
import {
  assertNotSymlink,
  assertRealPathInside,
  assignAttachmentFilenames,
  ensureRealDirectory,
  entryExists,
  framesDirName,
  isRealDirectory,
  isRegularFile,
  isSafeIssueKey,
  removeEntry,
  resolveContainedPath,
  writeFileAtomic,
  writeViaTempFile,
} from './safePath.js';
import {
  createNonce,
  isControlChar,
  toSingleLine,
  untrustedNotice,
  wrapUntrusted,
} from './untrusted.js';
import { readVideoDuration, type VideoDurationProbe } from './videoSize.js';

export type ExportOptions = {
  outputDir: string;
  includeSubtasks?: boolean;
  includeParent?: boolean;
  fieldSelector?: FieldSelector;
  customFieldDefs?: CustomFieldDefs;
  withHistory?: boolean;
  withWorklog?: boolean;
  videoFrames?: {
    enabled: boolean;
    fps?: number;
    quality?: number;
    maxFrames?: number;
    maxDurationSeconds?: number;
  };
};

export type VideoExtractionInfo = {
  filename: string;
  frameCount: number;
  dedupedCount: number;
  error?: string;
};

export type ExportedItem = {
  key: string;
  path: string;
  attachmentCount: number;
  videos: VideoExtractionInfo[];
};

export type ExportResult = {
  imported: ExportedItem[];
  updated: ExportedItem[];
  failed: Array<{ key: string; error: string }>;
};

type ExportIssueOutcome = {
  taskDir: string;
  taskMdPath: string;
  attachmentCount: number;
  videos: VideoExtractionInfo[];
  canonicalKey: string;
  existed: boolean;
  parentKey?: string;
};

type QueueEntry = {
  key: string;
  requested: boolean;
};

const DEFAULT_VIDEO_OPTS = {
  fps: 5,
  quality: 85,
  maxFrames: 10,
} as const;

export const DEFAULT_MAX_VIDEO_DURATION_SECONDS = 30 * 60;

const ATTACHMENTS_DIR = 'attachments';
const TASK_MD = 'task.md';

type FrameCounts = ReadonlyMap<string, number>;

type RenderContext = {
  selectedKeys: Set<string>;
  nonce: string;
  frameCounts: FrameCounts;
};

const VIDEO_LINK_REGEX =
  /!\[([^\]]*)\]\(attachments\/([^)]+\.(?:mp4|mov|avi|webm|mkv|m4v|flv|wmv|mpg|mpeg))\)(?:\n📁 \[View \d+ extracted frames\]\(attachments\/[^)]+\))?/gi;

function addFrameLinksToContent(content: string, frameCounts: FrameCounts): string {
  return content.replace(VIDEO_LINK_REGEX, (_match: string, alt: string, filename: string) => {
    const videoLink = `![${alt}](${ATTACHMENTS_DIR}/${filename})`;
    const count = frameCounts.get(filename) ?? 0;
    if (count === 0) return videoLink;
    return `${videoLink}\n📁 [View ${count} extracted frames](${ATTACHMENTS_DIR}/${framesDirName(filename)}/)`;
  });
}

function countFrames(framesDir: string): number {
  if (!isRealDirectory(framesDir)) return 0;
  return readdirSync(framesDir).filter((f) => f.startsWith('frame-') && f.endsWith('.jpg')).length;
}

function readFrameCounts(attachmentsDir: string, filenames: readonly string[]): FrameCounts {
  if (!isRealDirectory(attachmentsDir)) return new Map();
  return new Map(
    filenames
      .filter((name) => isVideoFile(name))
      .map((name) => [name, countFrames(join(attachmentsDir, framesDirName(name)))] as const)
  );
}

const YAML_ESCAPES = new Map([
  ['\\', '\\\\'],
  ['"', '\\"'],
  ['\n', '\\n'],
  ['\r', '\\r'],
  ['\t', '\\t'],
  ['\u0085', '\\N'],
  [' ', '\\L'],
  [' ', '\\P'],
]);

const SAFE_YAML_KEY = /^[A-Za-z0-9_.-]+$/;

function escapeYamlChar(ch: string): string {
  const named = YAML_ESCAPES.get(ch);
  if (named) return named;
  if (!isControlChar(ch)) return ch;
  return `\\u${(ch.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`;
}

function yamlQuote(value: string): string {
  return `"${[...value].map(escapeYamlChar).join('')}"`;
}

function yamlKey(key: string): string {
  return SAFE_YAML_KEY.test(key) ? key : yamlQuote(key);
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

function serializeYamlValue(value: unknown, indent: string): string {
  if (typeof value === 'string') return yamlQuote(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
      const items = value.map((v) => (typeof v === 'string' ? yamlQuote(v) : String(v)));
      return `[${items.join(', ')}]`;
    }
    let out = '';
    for (const item of value) {
      out += `\n${indent}- ${serializeYamlObjectInline(item, `${indent}  `)}`;
    }
    return out;
  }
  if (typeof value === 'object' && value !== null) {
    let out = '';
    for (const [k, v] of Object.entries(value)) {
      if (isEmpty(v)) continue;
      const serialized = serializeYamlValue(v, `${indent}  `);
      const needsBlock = typeof v === 'object' && v !== null && !Array.isArray(v) && !serialized.startsWith('\n');
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
        out += `\n${indent}${yamlKey(k)}:`;
        out += serialized.startsWith('\n') ? serialized : `\n${indent}  ${serialized}`;
      } else if (Array.isArray(v) && !serialized.startsWith('[')) {
        out += `\n${indent}${yamlKey(k)}:${serialized}`;
      } else {
        out += `\n${indent}${yamlKey(k)}: ${serialized}`;
      }
      void needsBlock;
    }
    return out;
  }
  return '';
}

function serializeYamlObjectInline(obj: unknown, indent: string): string {
  if (typeof obj !== 'object' || obj === null) {
    return serializeYamlValue(obj, indent);
  }
  const entries = Object.entries(obj).filter(([, v]) => !isEmpty(v));
  if (entries.length === 0) return '{}';
  const [firstKey, firstVal] = entries[0];
  let out = `${yamlKey(firstKey)}: ${serializeYamlValue(firstVal, indent)}`;
  for (const [k, v] of entries.slice(1)) {
    const serialized = serializeYamlValue(v, indent);
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      out += `\n${indent}${yamlKey(k)}:${serialized.startsWith('\n') ? serialized : `\n${indent}  ${serialized}`}`;
    } else {
      out += `\n${indent}${yamlKey(k)}: ${serialized}`;
    }
  }
  return out;
}

function formatIssueRef(ref: { key: string; title?: string }): string {
  if (!ref.title) return ref.key;
  return `${ref.key} - ${ref.title}`;
}

function buildFrontmatterBlock(task: JiraTaskData, selectedKeys: Set<string>): string {
  const pickIfSelected = <T,>(key: string, val: T | undefined): T | undefined =>
    selectedKeys.has(key) && !isEmpty(val) ? val : undefined;

  const jira: Record<string, unknown> = {};
  // 'key' is implicit/always present
  jira.key = task.key;

  const status = pickIfSelected('status', task.status);
  if (status) jira.status = status;
  const issueType = pickIfSelected('issueType', task.issueType);
  if (issueType) jira.issueType = issueType;
  const priority = pickIfSelected('priority', task.priority);
  if (priority) jira.priority = priority;
  const resolution = pickIfSelected('resolution', task.resolution);
  if (resolution) jira.resolution = resolution;
  const assignee = pickIfSelected('assignee', task.assignee);
  if (assignee) jira.assignee = assignee;
  const reporter = pickIfSelected('reporter', task.reporter);
  if (reporter) jira.reporter = reporter;
  const creator = pickIfSelected('creator', task.creator);
  if (creator) jira.creator = creator;
  const createdAt = pickIfSelected('createdAt', task.createdAt);
  if (createdAt) jira.createdAt = createdAt;
  const updatedAt = pickIfSelected('updatedAt', task.updatedAt);
  if (updatedAt) jira.updatedAt = updatedAt;
  const dueDate = pickIfSelected('dueDate', task.dueDate);
  if (dueDate) jira.dueDate = dueDate;
  const resolutionDate = pickIfSelected('resolutionDate', task.resolutionDate);
  if (resolutionDate) jira.resolutionDate = resolutionDate;
  const components = pickIfSelected('components', task.components);
  if (components) jira.components = components;
  const labels = pickIfSelected('labels', task.labels);
  if (labels) jira.labels = labels;
  const fixVersions = pickIfSelected('fixVersions', task.fixVersions);
  if (fixVersions) jira.fixVersions = fixVersions;
  const versions = pickIfSelected('versions', task.versions);
  if (versions) jira.versions = versions;
  const sprint = pickIfSelected('sprint', task.sprint);
  if (sprint) jira.sprint = sprint;
  const storyPoints = pickIfSelected('storyPoints', task.storyPoints);
  if (storyPoints !== undefined) jira.storyPoints = storyPoints;
  const timetracking = pickIfSelected('timetracking', task.timetracking);
  if (timetracking) jira.timetracking = timetracking;

  if (selectedKeys.has('parent') && task.parent) {
    jira.parent = formatIssueRef(task.parent);
  }
  if (selectedKeys.has('epic') && task.epic) {
    jira.epic = formatIssueRef(task.epic);
  }
  if (selectedKeys.has('subtasks') && task.subtasks?.length) {
    jira.subtasks = task.subtasks.map((s) => ({
      key: s.key,
      title: s.title,
      status: s.status,
    }));
  }
  if (selectedKeys.has('issueLinks') && task.issueLinks?.length) {
    jira.issueLinks = task.issueLinks;
  }
  if (task.customFields && Object.keys(task.customFields).length > 0) {
    jira.customFields = task.customFields;
  }

  const body = serializeYamlValue(jira, '');
  return body.startsWith('\n') ? body.slice(1) : body;
}

function historyLabel(entry: JiraTaskData['history'][number]): string {
  if (entry.type === 'comment') return 'COMMENT';
  if (entry.type === 'field_change') return `CHANGE (${toSingleLine(String(entry.field))})`;
  return 'STATUS CHANGE';
}

const formatDate = (value: string) => toSingleLine(new Date(value).toLocaleString());

const renderUntrusted = (content: string, ctx: RenderContext) =>
  wrapUntrusted(addFrameLinksToContent(content, ctx.frameCounts), ctx.nonce);

function buildDescriptionSection(task: JiraTaskData, ctx: RenderContext): string {
  if (!task.description?.trim()) return '';
  return `## Description\n\n${renderUntrusted(task.description, ctx)}\n\n`;
}

function buildHistorySection(task: JiraTaskData, ctx: RenderContext): string {
  if (task.history.length === 0) return '';
  const entries = task.history.map(
    (entry) =>
      `---\n[${historyLabel(entry)}] ${toSingleLine(entry.author)} — ${formatDate(entry.date)}:\n` +
      `${renderUntrusted(entry.content, ctx)}\n\n`
  );
  return `## History\n\n${entries.join('')}`;
}

function buildWorklogEntry(
  worklog: NonNullable<JiraTaskData['worklogs']>[number],
  ctx: RenderContext
): string {
  const header = `---\n[WORKLOG] ${toSingleLine(worklog.author)} — ${formatDate(worklog.started)}: ${toSingleLine(worklog.timeSpent)}\n`;
  if (!worklog.comment) return `${header}\n`;
  return `${header}${renderUntrusted(worklog.comment, ctx)}\n\n`;
}

function buildWorklogSection(task: JiraTaskData, ctx: RenderContext): string {
  if (!task.worklogs?.length) return '';
  return `## Worklog\n\n${task.worklogs.map((worklog) => buildWorklogEntry(worklog, ctx)).join('')}`;
}

function buildTaskMarkdown(task: JiraTaskData, ctx: RenderContext): string {
  const frontmatterBody = buildFrontmatterBlock(task, ctx.selectedKeys);
  return (
    `---\n${frontmatterBody}\n---\n\n${untrustedNotice(ctx.nonce)}\n\n# ${toSingleLine(task.title)}\n\n` +
    buildDescriptionSection(task, ctx) +
    buildHistorySection(task, ctx) +
    buildWorklogSection(task, ctx)
  );
}

function durationSkipReason(probe: VideoDurationProbe, maxSeconds: number): string | undefined {
  if (probe.status !== 'known') return undefined;
  if (probe.seconds <= maxSeconds) return undefined;
  return `video duration ${Math.round(probe.seconds)}s exceeds the ${maxSeconds}s limit`;
}

function prepareTaskDir(outputDir: string, taskDir: string): void {
  mkdirSync(outputDir, { recursive: true });
  ensureRealDirectory(taskDir);
  assertRealPathInside(outputDir, taskDir);
}

const FRAME_ARTIFACT_RE = /^(frame-\d+|raw-(\d+|first|last))\.[a-z0-9]+$/i;

function prepareFramesDir(framesDir: string): void {
  assertNotSymlink(framesDir);
  if (!entryExists(framesDir)) return;
  if (!isRealDirectory(framesDir)) {
    throw new Error(`Refusing to extract frames: ${framesDir} is not a directory`);
  }
  readdirSync(framesDir)
    .filter((name) => FRAME_ARTIFACT_RE.test(name))
    .forEach((name) => removeEntry(join(framesDir, name)));
}

function writeGitignore(outputDir: string): void {
  const gitignorePath = join(outputDir, '.gitignore');
  if (entryExists(gitignorePath)) return;
  try {
    writeFileSync(gitignorePath, '*\n', { encoding: 'utf-8', flag: 'wx' });
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
  }
}

const isAlreadyExistsError = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'EEXIST';

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

type VideoFrameSettings = {
  fps: number;
  quality: number;
  maxFrames: number;
  maxDurationSeconds?: number;
};

async function extractVideoFrames(
  attPath: string,
  attachmentsDir: string,
  filename: string,
  settings: VideoFrameSettings
): Promise<VideoExtractionInfo> {
  const maxSeconds = settings.maxDurationSeconds ?? DEFAULT_MAX_VIDEO_DURATION_SECONDS;
  const skipReason = durationSkipReason(await readVideoDuration(attPath), maxSeconds);
  if (skipReason) {
    console.warn(`  ⚠ ${filename}: skipping frame extraction, ${skipReason}`);
    return {
      filename,
      frameCount: 0,
      dedupedCount: 0,
      error: `Frame extraction skipped: ${skipReason}`,
    };
  }

  const framesDir = resolveContainedPath(attachmentsDir, framesDirName(filename));
  prepareFramesDir(framesDir);
  console.log(
    `  🎬 ${filename}: extracting frames (fps=${settings.fps}, max=${settings.maxFrames})...`
  );
  try {
    const result = await extractFrames(attPath, framesDir, {
      fps: settings.fps,
      format: 'jpeg',
      quality: settings.quality,
      maxFrames: settings.maxFrames,
    });
    console.log(
      `  ✓ ${filename}: extracted ${result.extractedCount} frames, kept ${result.keptCount}`
    );
    return { filename, frameCount: result.extractedCount, dedupedCount: result.keptCount };
  } catch (error: unknown) {
    const msg = errorMessage(error);
    console.warn(`  ⚠ ${filename}: ${msg}`);
    return { filename, frameCount: 0, dedupedCount: 0, error: msg };
  }
}

function enqueueParent(queue: QueueEntry[], parentKey: string): void {
  if (!isSafeIssueKey(parentKey)) {
    console.warn(`Skipping parent with invalid issue key ${JSON.stringify(parentKey)}`);
    return;
  }
  queue.push({ key: parentKey, requested: false });
}

export class JiraExporter {
  private client: JiraClient;

  constructor(config: JiraConfig, apiToken: string) {
    this.client = new JiraClient(config, apiToken);
  }

  async exportIssue(issueKey: string, options: ExportOptions): Promise<ExportIssueOutcome> {
    const customFieldDefs = options.customFieldDefs ?? {};
    const resolved = resolveFieldSet(options.fieldSelector, customFieldDefs);

    const task = await this.client.fetchIssueDetails(issueKey, {
      jiraFieldIds: resolved.jiraFieldIds,
      customFieldDefs,
      fullChangelog: options.withHistory ?? false,
      includeWorklog: options.withWorklog ?? false,
    });

    if (!isSafeIssueKey(task.key)) {
      throw new Error(
        `Refusing to export: Jira returned an invalid issue key ${JSON.stringify(task.key)}`
      );
    }

    if (options.includeSubtasks) {
      task.subtasks = await this.client.fetchIssueSubtasks(task.key);
    }

    const taskDir = join(options.outputDir, task.key.toLowerCase());
    const existed = entryExists(taskDir);
    prepareTaskDir(options.outputDir, taskDir);

    const attachmentsDir = join(taskDir, ATTACHMENTS_DIR);
    const attachmentNames = assignAttachmentFilenames(task.attachments);
    const taskMdPath = join(taskDir, TASK_MD);
    const baseContext = { selectedKeys: new Set(resolved.friendlyKeys), nonce: createNonce() };
    const render = () =>
      buildTaskMarkdown(task, {
        ...baseContext,
        frameCounts: readFrameCounts(attachmentsDir, attachmentNames),
      });

    const initialContent = render();
    writeFileAtomic(taskMdPath, initialContent);

    const videos =
      task.attachments.length > 0
        ? await this.exportAttachments(task, attachmentsDir, attachmentNames, options)
        : [];

    const finalContent = render();
    if (finalContent !== initialContent) writeFileAtomic(taskMdPath, finalContent);

    return {
      taskDir,
      taskMdPath,
      attachmentCount: task.attachments.length,
      videos,
      canonicalKey: task.key,
      existed,
      parentKey: task.parent?.key,
    };
  }

  private async exportAttachments(
    task: JiraTaskData,
    attachmentsDir: string,
    attachmentNames: readonly string[],
    options: ExportOptions
  ): Promise<VideoExtractionInfo[]> {
    ensureRealDirectory(attachmentsDir);
    console.log(`  ↓ ${task.key}: downloading ${task.attachments.length} attachment(s)...`);

    const videos: VideoExtractionInfo[] = [];
    const processedVideos = new Set<string>();

    for (const [index, att] of task.attachments.entries()) {
      const filename = attachmentNames[index];
      const attPath = resolveContainedPath(attachmentsDir, filename);
      await this.ensureAttachment(att.url, attPath);

      const videoKey = `${task.key}:${att.id}`;
      if (!options.videoFrames?.enabled || !isVideoFile(filename) || processedVideos.has(videoKey)) {
        continue;
      }
      processedVideos.add(videoKey);
      videos.push(
        await extractVideoFrames(attPath, attachmentsDir, filename, {
          ...DEFAULT_VIDEO_OPTS,
          ...options.videoFrames,
        })
      );
    }

    return videos;
  }

  private async ensureAttachment(url: string, attPath: string): Promise<void> {
    assertNotSymlink(attPath);
    if (isRegularFile(attPath)) return;
    await writeViaTempFile(attPath, (tempPath) => this.client.downloadAttachment(url, tempPath));
  }

  async exportIssues(issueKeys: string[], options: ExportOptions): Promise<ExportResult> {
    const result: ExportResult = { imported: [], updated: [], failed: [] };

    mkdirSync(options.outputDir, { recursive: true });
    writeGitignore(options.outputDir);

    const seen = new Set<string>();
    const queue: QueueEntry[] = issueKeys.map((key) => ({ key, requested: true }));

    for (let i = 0; i < queue.length; i++) {
      const { key, requested } = queue[i];
      const dedupeKey = key.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      try {
        const outcome = await this.exportIssue(key, options);
        seen.add(outcome.canonicalKey.toLowerCase());
        (outcome.existed ? result.updated : result.imported).push({
          key,
          path: outcome.taskMdPath,
          attachmentCount: outcome.attachmentCount,
          videos: outcome.videos,
        });
        if (options.includeParent && outcome.parentKey) {
          enqueueParent(queue, outcome.parentKey);
        }
      } catch (error) {
        const message = errorMessage(error);
        if (!requested) {
          console.warn(`Failed to fetch parent ${key}: ${message}`);
          continue;
        }
        result.failed.push({ key, error: message });
      }
    }

    return result;
  }
}
