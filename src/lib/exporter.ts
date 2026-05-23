import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { JiraClient, type JiraConfig, type JiraTaskData } from './jiraClient.js';
import { extractAndDeduplicateFrames, isVideoFile } from './videoFrameExtractor.js';

export type ExportOptions = {
  outputDir: string;
  includeSubtasks?: boolean;
  includeParentEpic?: boolean;
  videoFrames?: {
    enabled: boolean;
    fps?: number;
    quality?: number;
    maxFrames?: number;
    similarityThreshold?: number;
  };
};

export type ExportResult = {
  imported: string[];
  updated: string[];
  failed: Array<{ key: string; error: string }>;
};

const DEFAULT_VIDEO_OPTS = {
  fps: 5,
  quality: 85,
  maxFrames: 10,
  similarityThreshold: 0.0001,
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

function buildTaskMarkdown(task: JiraTaskData, taskDir: string): string {
  let md = `---\njiraKey: "${task.key}"\njiraStatus: "${task.status}"\n`;
  if (task.issueType) md += `jiraIssueType: "${task.issueType}"\n`;
  if (task.parent) md += `jiraParent: "${task.parent.key} - ${task.parent.title}"\n`;
  if (task.epic) md += `jiraEpic: "${task.epic.key} - ${task.epic.title}"\n`;
  if (task.subtasks?.length) {
    md += `jiraSubtasks:\n`;
    for (const s of task.subtasks) {
      md += `  - key: "${s.key}"\n    title: "${s.title}"\n    status: "${s.status}"\n`;
    }
  }
  md += `---\n\n# ${task.title}\n\n`;

  if (task.description?.trim()) {
    md += `## Description\n\n${addFrameLinksToContent(task.description, taskDir)}\n\n`;
  }

  if (task.history.length > 0) {
    md += `## History\n\n`;
    for (const entry of task.history) {
      const label = entry.type === 'comment' ? 'COMMENT' : 'STATUS CHANGE';
      const date = new Date(entry.date).toLocaleString();
      md += `---\n[${label}] ${entry.author} — ${date}:\n`;
      md += `${addFrameLinksToContent(entry.content, taskDir)}\n\n`;
    }
  }

  return md;
}

export class JiraExporter {
  private client: JiraClient;

  constructor(config: JiraConfig, apiToken: string) {
    this.client = new JiraClient(config, apiToken);
  }

  async exportIssue(issueKey: string, options: ExportOptions): Promise<string> {
    const task = await this.client.fetchIssueDetails(issueKey);

    if (options.includeSubtasks) {
      task.subtasks = await this.client.fetchIssueSubtasks(task.key);
    }

    const taskDir = join(options.outputDir, task.key.toLowerCase());
    mkdirSync(taskDir, { recursive: true });

    const taskMdPath = join(taskDir, 'task.md');
    writeFileSync(taskMdPath, buildTaskMarkdown(task, taskDir), 'utf-8');

    if (task.attachments.length > 0) {
      const attachmentsDir = join(taskDir, 'attachments');
      mkdirSync(attachmentsDir, { recursive: true });

      const downloaded = new Set<string>();
      const processedVideos = new Set<string>();

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
          const result = await extractAndDeduplicateFrames(attPath, framesDir, {
            fps: opts.fps,
            format: 'jpeg',
            quality: opts.quality,
            similarityThreshold: opts.similarityThreshold,
            maxFrames: opts.maxFrames,
          });

          if (result.success) {
            console.log(
              `  ✓ ${filename}: extracted ${result.frameCount} frames, kept ${result.dedupedCount}`
            );
          } else {
            console.warn(`  ⚠ ${filename}: ${result.error}`);
          }
          processedVideos.add(`${task.key}:${att.id}`);
        }
      }
    }

    const finalContent = readFileSync(taskMdPath, 'utf-8');
    const updated = addFrameLinksToContent(finalContent, taskDir);
    if (updated !== finalContent) writeFileSync(taskMdPath, updated, 'utf-8');

    return taskDir;
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
        await this.exportIssue(key, options);
        (existed ? result.updated : result.imported).push(key);
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
