import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { JiraClient, type JiraConfig, type JiraTaskData } from './jiraClient.js';
import { extractFrames, isVideoFile } from 'framewise';
import {
  resolveFieldSet,
  type CustomFieldDefs,
  type FieldSelector,
} from './exportFields.js';

export type ExportOptions = {
  outputDir: string;
  includeSubtasks?: boolean;
  includeParentEpic?: boolean;
  fieldSelector?: FieldSelector;
  customFieldDefs?: CustomFieldDefs;
  withHistory?: boolean;
  withWorklog?: boolean;
  videoFrames?: {
    enabled: boolean;
    fps?: number;
    quality?: number;
    maxFrames?: number;
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
};

const DEFAULT_VIDEO_OPTS = {
  fps: 5,
  quality: 85,
  maxFrames: 10,
};

function addFrameLinksToContent(content: string, taskDir: string): string {
  const videoLinkRegex =
    /!\[([^\]]*)\]\((attachments\/[^)]+\.(mp4|mov|avi|webm|mkv|m4v|flv|wmv|mpg|mpeg))\)(?:\n📁 \[View \d+ extracted frames\]\(attachments\/[^)]+\))?/gi;

  return content.replace(videoLinkRegex, (match: string, _alt: string, videoPath: string) => {
    const filename = videoPath.split('/').pop();
    if (!filename) return match;

    const framesDirName = `${filename}-frames`;
    const framesDir = join(taskDir, 'attachments', framesDirName);

    const videoLinkMatch = match.match(
      /!\[[^\]]*\]\(attachments\/[^)]+\.(mp4|mov|avi|webm|mkv|m4v|flv|wmv|mpg|mpeg)\)/i
    );
    const videoLinkPart = videoLinkMatch ? videoLinkMatch[0] : match;

    if (existsSync(framesDir)) {
      const frameFiles = readdirSync(framesDir)
        .filter((f) => f.startsWith('frame-') && f.endsWith('.jpg'))
        .sort();
      if (frameFiles.length > 0) {
        return `${videoLinkPart}\n📁 [View ${frameFiles.length} extracted frames](attachments/${framesDirName}/)`;
      }
    }

    return videoLinkPart;
  });
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
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
        out += `\n${indent}${k}:`;
        out += serialized.startsWith('\n') ? serialized : `\n${indent}  ${serialized}`;
      } else if (Array.isArray(v) && !serialized.startsWith('[')) {
        out += `\n${indent}${k}:${serialized}`;
      } else {
        out += `\n${indent}${k}: ${serialized}`;
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
  let out = `${firstKey}: ${serializeYamlValue(firstVal, indent)}`;
  for (const [k, v] of entries.slice(1)) {
    const serialized = serializeYamlValue(v, indent);
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      out += `\n${indent}${k}:${serialized.startsWith('\n') ? serialized : `\n${indent}  ${serialized}`}`;
    } else {
      out += `\n${indent}${k}: ${serialized}`;
    }
  }
  return out;
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
    jira.parent = `${task.parent.key} - ${task.parent.title}`;
  }
  if (selectedKeys.has('epic') && task.epic) {
    jira.epic = `${task.epic.key} - ${task.epic.title}`;
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
  if (entry.type === 'field_change') return `CHANGE (${entry.field})`;
  return 'STATUS CHANGE';
}

function buildTaskMarkdown(
  task: JiraTaskData,
  taskDir: string,
  selectedKeys: Set<string>
): string {
  const frontmatterBody = buildFrontmatterBlock(task, selectedKeys);
  let md = `---\n${frontmatterBody}\n---\n\n# ${task.title}\n\n`;

  if (task.description?.trim()) {
    md += `## Description\n\n${addFrameLinksToContent(task.description, taskDir)}\n\n`;
  }

  if (task.history.length > 0) {
    md += `## History\n\n`;
    for (const entry of task.history) {
      const label = historyLabel(entry);
      const date = new Date(entry.date).toLocaleString();
      md += `---\n[${label}] ${entry.author} — ${date}:\n`;
      md += `${addFrameLinksToContent(entry.content, taskDir)}\n\n`;
    }
  }

  if (task.worklogs?.length) {
    md += `## Worklog\n\n`;
    for (const worklog of task.worklogs) {
      const date = new Date(worklog.started).toLocaleString();
      md += `---\n[WORKLOG] ${worklog.author} — ${date}: ${worklog.timeSpent}\n`;
      if (worklog.comment) {
        md += `${addFrameLinksToContent(worklog.comment, taskDir)}\n`;
      }
      md += `\n`;
    }
  }

  return md;
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

    if (options.includeSubtasks) {
      task.subtasks = await this.client.fetchIssueSubtasks(task.key);
    }

    const taskDir = join(options.outputDir, task.key.toLowerCase());
    mkdirSync(taskDir, { recursive: true });

    const selectedKeys = new Set(resolved.friendlyKeys);
    const taskMdPath = join(taskDir, 'task.md');
    writeFileSync(taskMdPath, buildTaskMarkdown(task, taskDir, selectedKeys), 'utf-8');

    const videos: VideoExtractionInfo[] = [];
    if (task.attachments.length > 0) {
      const attachmentsDir = join(taskDir, 'attachments');
      mkdirSync(attachmentsDir, { recursive: true });

      const downloaded = new Set<string>();
      const processedVideos = new Set<string>();

      console.log(`  ↓ ${task.key}: downloading ${task.attachments.length} attachment(s)...`);

      for (const att of task.attachments) {
        let filename = att.filename;
        let counter = 1;
        while (downloaded.has(filename)) {
          const dot = att.filename.lastIndexOf('.');
          if (dot !== -1) {
            filename = `${att.filename.substring(0, dot)}-${counter}${att.filename.substring(dot)}`;
          } else {
            filename = `${att.filename}-${counter}`;
          }
          counter++;
        }
        downloaded.add(filename);

        const attPath = join(attachmentsDir, filename);
        if (!existsSync(attPath)) {
          await this.client.downloadAttachment(att.url, attPath);
        }

        if (
          options.videoFrames?.enabled &&
          isVideoFile(filename) &&
          existsSync(attPath) &&
          !processedVideos.has(`${task.key}:${att.id}`)
        ) {
          const framesDir = join(attachmentsDir, `${filename}-frames`);
          const opts = { ...DEFAULT_VIDEO_OPTS, ...options.videoFrames };
          console.log(
            `  🎬 ${filename}: extracting frames (fps=${opts.fps}, max=${opts.maxFrames})...`
          );
          try {
            const result = await extractFrames(attPath, framesDir, {
              fps: opts.fps,
              format: 'jpeg',
              quality: opts.quality,
              maxFrames: opts.maxFrames,
            });
            console.log(
              `  ✓ ${filename}: extracted ${result.extractedCount} frames, kept ${result.keptCount}`
            );
            videos.push({
              filename,
              frameCount: result.extractedCount,
              dedupedCount: result.keptCount,
            });
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`  ⚠ ${filename}: ${msg}`);
            videos.push({
              filename,
              frameCount: 0,
              dedupedCount: 0,
              error: msg,
            });
          }
          processedVideos.add(`${task.key}:${att.id}`);
        }
      }
    }

    const finalContent = readFileSync(taskMdPath, 'utf-8');
    const updated = addFrameLinksToContent(finalContent, taskDir);
    if (updated !== finalContent) writeFileSync(taskMdPath, updated, 'utf-8');

    return {
      taskDir,
      taskMdPath,
      attachmentCount: task.attachments.length,
      videos,
    };
  }

  async exportIssues(issueKeys: string[], options: ExportOptions): Promise<ExportResult> {
    const result: ExportResult = { imported: [], updated: [], failed: [] };

    if (!existsSync(options.outputDir)) {
      mkdirSync(options.outputDir, { recursive: true });
    }

    const gitignorePath = join(options.outputDir, '.gitignore');
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, '*\n', 'utf-8');
    }

    for (const key of issueKeys) {
      try {
        const taskDir = join(options.outputDir, key.toLowerCase());
        const existed = existsSync(taskDir);
        const outcome = await this.exportIssue(key, options);
        (existed ? result.updated : result.imported).push({
          key,
          path: outcome.taskMdPath,
          attachmentCount: outcome.attachmentCount,
          videos: outcome.videos,
        });
      } catch (error) {
        result.failed.push({
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  }
}
