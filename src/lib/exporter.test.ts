import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('framewise', () => ({
  isVideoFile: vi.fn(() => false),
  extractFrames: vi.fn(),
}));

import { extractFrames, isVideoFile } from 'framewise';
import { JiraExporter } from './exporter.js';
import type { JiraTaskData } from './jiraClient.js';

const FAKE_CONFIG = {
  baseUrl: 'https://example.atlassian.net',
  projectKey: 'PROJ',
  userEmail: 'user@example.com',
};

const FULL_TASK: JiraTaskData = {
  key: 'PROJ-1',
  title: 'Sample',
  status: 'In Progress',
  description: 'Hello world.',
  issueType: 'Story',
  priority: 'High',
  resolution: 'Done',
  assignee: 'Jane Doe',
  reporter: 'John Smith',
  creator: 'John Smith',
  createdAt: '2026-05-20T10:00:00.000+0200',
  updatedAt: '2026-05-23T08:30:00.000+0200',
  dueDate: '2026-06-01',
  resolutionDate: '2026-05-23T09:00:00.000+0200',
  components: ['backend', 'auth'],
  labels: ['tech-debt', 'p1'],
  fixVersions: ['1.4.0'],
  versions: ['1.3.0'],
  sprint: 'Sprint 42',
  storyPoints: 5,
  timetracking: { originalEstimate: '1d', remainingEstimate: '4h', timeSpent: '4h' },
  parent: { key: 'PROJ-100', title: 'Parent', status: 'Open' },
  epic: { key: 'PROJ-50', title: 'Epic' },
  subtasks: [{ key: 'PROJ-2', title: 'Sub', status: 'Done' }],
  issueLinks: [
    { id: '10501', type: 'blocks', key: 'PROJ-200', title: 'Blocked one', status: 'To Do' },
  ],
  customFields: { severity: 'S2' },
  attachments: [],
  history: [],
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'jirallm-exp-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.mocked(isVideoFile).mockReturnValue(false);
  vi.mocked(extractFrames).mockReset();
});

function makeExporter(
  task: JiraTaskData,
  clientOverride?: Record<string, unknown>
): JiraExporter {
  const exporter = new JiraExporter(FAKE_CONFIG, 'fake-token');
  // @ts-expect-error injecting fake client
  exporter.client = {
    fetchIssueDetails: vi.fn(async () => task),
    fetchIssueSubtasks: vi.fn(async () => []),
    downloadAttachment: vi.fn(async () => {}),
    ...clientOverride,
  };
  return exporter;
}

describe('JiraExporter.exportIssue frontmatter', () => {
  it('emits a flat top-level frontmatter with default preset fields', async () => {
    const exporter = makeExporter(FULL_TASK);
    await exporter.exportIssue('PROJ-1', { outputDir: tmpDir });
    const content = readFileSync(join(tmpDir, 'proj-1', 'task.md'), 'utf-8');

    expect(content).toMatch(/^---\nkey: "PROJ-1"\n/);
    expect(content).toMatch(/^status: "In Progress"$/m);
    expect(content).toMatch(/^priority: "High"$/m);
    expect(content).toMatch(/^assignee: "Jane Doe"$/m);
    expect(content).toMatch(/^labels: \["tech-debt", "p1"\]$/m);
    expect(content).toMatch(/^sprint: "Sprint 42"$/m);
    expect(content).toMatch(/^parent: "PROJ-100 - Parent"$/m);
    expect(content).toMatch(/^epic: "PROJ-50 - Epic"$/m);
    // The old jira: namespace and legacy jiraKey/jiraStatus must not appear.
    expect(content).not.toMatch(/^jira:/m);
    expect(content).not.toMatch(/^jiraKey:/m);
    expect(content).not.toMatch(/^jiraStatus:/m);
  });

  it('omits empty / missing fields', async () => {
    const sparse: JiraTaskData = {
      key: 'PROJ-9',
      title: 'Sparse',
      status: 'Open',
      description: '',
      attachments: [],
      history: [],
    };
    const exporter = makeExporter(sparse);
    await exporter.exportIssue('PROJ-9', { outputDir: tmpDir });
    const content = readFileSync(join(tmpDir, 'proj-9', 'task.md'), 'utf-8');

    expect(content).toMatch(/^key: "PROJ-9"$/m);
    expect(content).toMatch(/^status: "Open"$/m);
    expect(content).not.toMatch(/labels:/);
    expect(content).not.toMatch(/components:/);
    expect(content).not.toMatch(/dueDate:/);
    expect(content).not.toMatch(/customFields:/);
  });

  it('honors minimal preset (legacy fields only)', async () => {
    const exporter = makeExporter(FULL_TASK);
    await exporter.exportIssue('PROJ-1', {
      outputDir: tmpDir,
      fieldSelector: { preset: 'minimal' },
    });
    const content = readFileSync(join(tmpDir, 'proj-1', 'task.md'), 'utf-8');
    expect(content).toMatch(/key: "PROJ-1"/);
    expect(content).toMatch(/status: "In Progress"/);
    expect(content).toMatch(/issueType: "Story"/);
    expect(content).toMatch(/parent: "PROJ-100 - Parent"/);
    expect(content).not.toMatch(/priority:/);
    expect(content).not.toMatch(/labels:/);
    expect(content).not.toMatch(/sprint:/);
  });

  it('serializes subtasks and issueLinks as block sequences', async () => {
    const exporter = makeExporter(FULL_TASK);
    await exporter.exportIssue('PROJ-1', {
      outputDir: tmpDir,
      fieldSelector: { preset: 'all' },
    });
    const content = readFileSync(join(tmpDir, 'proj-1', 'task.md'), 'utf-8');
    expect(content).toMatch(/subtasks:\n\s+- key: "PROJ-2"/);
    expect(content).toMatch(/issueLinks:\n\s+- id: "10501"\n\s+type: "blocks"/);
  });

  it('serializes timetracking as a nested mapping', async () => {
    const exporter = makeExporter(FULL_TASK);
    await exporter.exportIssue('PROJ-1', {
      outputDir: tmpDir,
      fieldSelector: { preset: 'all' },
    });
    const content = readFileSync(join(tmpDir, 'proj-1', 'task.md'), 'utf-8');
    expect(content).toMatch(/timetracking:\n\s+originalEstimate: "1d"/);
    expect(content).toMatch(/remainingEstimate: "4h"/);
  });

  it('emits customFields block when present', async () => {
    const exporter = makeExporter(FULL_TASK);
    await exporter.exportIssue('PROJ-1', { outputDir: tmpDir });
    const content = readFileSync(join(tmpDir, 'proj-1', 'task.md'), 'utf-8');
    expect(content).toMatch(/customFields:\n\s+severity: "S2"/);
  });

  it('escapes special chars in quoted YAML strings', async () => {
    const task: JiraTaskData = {
      ...FULL_TASK,
      assignee: 'Quote " and backslash \\ in name',
    };
    const exporter = makeExporter(task);
    await exporter.exportIssue('PROJ-1', { outputDir: tmpDir });
    const content = readFileSync(join(tmpDir, 'proj-1', 'task.md'), 'utf-8');
    expect(content).toMatch(/assignee: "Quote \\" and backslash \\\\ in name"/);
  });

  it('honors a bare-name --fields list (custom set)', async () => {
    const exporter = makeExporter(FULL_TASK);
    await exporter.exportIssue('PROJ-1', {
      outputDir: tmpDir,
      fieldSelector: { include: ['key', 'priority', 'labels'], exclude: [] },
    });
    const content = readFileSync(join(tmpDir, 'proj-1', 'task.md'), 'utf-8');
    expect(content).toMatch(/key: "PROJ-1"/);
    expect(content).toMatch(/priority: "High"/);
    expect(content).toMatch(/labels:/);
    expect(content).not.toMatch(/assignee:/);
    expect(content).not.toMatch(/status:/);
  });

  it('omits customFields when defs are configured but no values returned', async () => {
    const task: JiraTaskData = { ...FULL_TASK, customFields: undefined };
    const exporter = makeExporter(task);
    await exporter.exportIssue('PROJ-1', { outputDir: tmpDir });
    const content = readFileSync(join(tmpDir, 'proj-1', 'task.md'), 'utf-8');
    expect(content).not.toMatch(/customFields:/);
  });

  it('returns an outcome with taskMdPath, attachmentCount and videos', async () => {
    const taskWithAttachments: JiraTaskData = {
      ...FULL_TASK,
      attachments: [
        { id: '1', filename: 'doc.pdf', url: 'https://x.example/1', size: 100 },
        { id: '2', filename: 'image.png', url: 'https://x.example/2', size: 200 },
      ],
    };
    const exporter = makeExporter(taskWithAttachments);
    const outcome = await exporter.exportIssue('PROJ-1', { outputDir: tmpDir });
    expect(outcome.taskMdPath).toMatch(/proj-1\/task\.md$/);
    expect(outcome.attachmentCount).toBe(2);
    expect(outcome.videos).toEqual([]);
  });

  it('exportIssues result items include attachmentCount and videos', async () => {
    const taskWithAttachments: JiraTaskData = {
      ...FULL_TASK,
      attachments: [{ id: '1', filename: 'doc.pdf', url: 'https://x.example/1', size: 100 }],
    };
    const exporter = makeExporter(taskWithAttachments);
    const result = await exporter.exportIssues(['PROJ-1'], { outputDir: tmpDir });
    expect(result.imported).toHaveLength(1);
    expect(result.imported[0].key).toBe('PROJ-1');
    expect(result.imported[0].attachmentCount).toBe(1);
    expect(result.imported[0].videos).toEqual([]);
    expect(result.imported[0].path).toMatch(/proj-1\/task\.md$/);
  });

  it('emits inline scalar array for labels', async () => {
    const exporter = makeExporter(FULL_TASK);
    await exporter.exportIssue('PROJ-1', { outputDir: tmpDir });
    const content = readFileSync(join(tmpDir, 'proj-1', 'task.md'), 'utf-8');
    expect(content).toMatch(/labels: \["tech-debt", "p1"\]/);
    expect(content).toMatch(/components: \["backend", "auth"\]/);
  });

  it('preserves description and history sections', async () => {
    const task: JiraTaskData = {
      ...FULL_TASK,
      history: [
        {
          type: 'comment',
          author: 'Jane',
          date: '2026-05-22T10:00:00.000Z',
          content: 'A comment',
        },
      ],
    };
    const exporter = makeExporter(task);
    await exporter.exportIssue('PROJ-1', { outputDir: tmpDir });
    const content = readFileSync(join(tmpDir, 'proj-1', 'task.md'), 'utf-8');
    expect(content).toMatch(/# Sample/);
    expect(content).toMatch(/## Description\n\nHello world\./);
    expect(content).toMatch(/## History/);
    expect(content).toMatch(/\[COMMENT\] Jane/);
  });

  it('renders STATUS CHANGE and CHANGE (field) labels in history', async () => {
    const task: JiraTaskData = {
      ...FULL_TASK,
      history: [
        {
          type: 'status_change',
          author: 'Bob',
          date: '2026-05-22T10:00:00.000Z',
          content: 'None → In Progress',
        },
        {
          type: 'field_change',
          field: 'priority',
          author: 'Alice',
          date: '2026-05-22T11:00:00.000Z',
          content: 'priority: Low → High',
        },
      ],
    };
    const exporter = makeExporter(task);
    await exporter.exportIssue('PROJ-1', { outputDir: tmpDir });
    const content = readFileSync(join(tmpDir, 'proj-1', 'task.md'), 'utf-8');
    expect(content).toMatch(/\[STATUS CHANGE\] Bob/);
    expect(content).toMatch(/\[CHANGE \(priority\)\] Alice/);
  });

  it('renders a Worklog section when worklogs are present', async () => {
    const task: JiraTaskData = {
      ...FULL_TASK,
      worklogs: [
        {
          author: 'Jane Doe',
          started: '2026-05-22T10:00:00.000Z',
          timeSpent: '2h',
          comment: 'Worked on the thing',
        },
      ],
    };
    const exporter = makeExporter(task);
    await exporter.exportIssue('PROJ-1', { outputDir: tmpDir });
    const content = readFileSync(join(tmpDir, 'proj-1', 'task.md'), 'utf-8');
    expect(content).toMatch(/## Worklog/);
    expect(content).toMatch(/\[WORKLOG\] Jane Doe .*: 2h/);
    expect(content).toMatch(/Worked on the thing/);
  });

  it('omits the Worklog section when no worklogs are present', async () => {
    const exporter = makeExporter(FULL_TASK);
    await exporter.exportIssue('PROJ-1', { outputDir: tmpDir });
    const content = readFileSync(join(tmpDir, 'proj-1', 'task.md'), 'utf-8');
    expect(content).not.toMatch(/## Worklog/);
  });

  it('forwards withHistory and withWorklog to fetchIssueDetails', async () => {
    const exporter = makeExporter(FULL_TASK);
    // @ts-expect-error accessing injected fake client
    const fetchSpy = exporter.client.fetchIssueDetails;
    await exporter.exportIssue('PROJ-1', {
      outputDir: tmpDir,
      withHistory: true,
      withWorklog: true,
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'PROJ-1',
      expect.objectContaining({ fullChangelog: true, includeWorklog: true })
    );
  });

  it('defaults withHistory and withWorklog to false', async () => {
    const exporter = makeExporter(FULL_TASK);
    // @ts-expect-error accessing injected fake client
    const fetchSpy = exporter.client.fetchIssueDetails;
    await exporter.exportIssue('PROJ-1', { outputDir: tmpDir });
    expect(fetchSpy).toHaveBeenCalledWith(
      'PROJ-1',
      expect.objectContaining({ fullChangelog: false, includeWorklog: false })
    );
  });
});

describe('JiraExporter video frame extraction', () => {
  const VIDEO_TASK: JiraTaskData = {
    ...FULL_TASK,
    attachments: [{ id: '1', filename: 'demo.mp4', url: 'https://x.example/v', size: 1000 }],
  };

  function makeVideoExporter(task: JiraTaskData): JiraExporter {
    return makeExporter(task, {
      downloadAttachment: vi.fn(async (_url: string, attPath: string) => {
        writeFileSync(attPath, 'x');
      }),
    });
  }

  it('extracts frames with default options and records the outcome', async () => {
    vi.mocked(isVideoFile).mockReturnValue(true);
    vi.mocked(extractFrames).mockResolvedValue({
      outputDir: join(tmpDir, 'frames'),
      frames: [],
      extractedCount: 12,
      keptCount: 4,
      droppedDuplicates: 8,
      droppedBlurry: 0,
    });

    const exporter = makeVideoExporter(VIDEO_TASK);
    const outcome = await exporter.exportIssue('PROJ-1', {
      outputDir: tmpDir,
      videoFrames: { enabled: true },
    });

    expect(vi.mocked(extractFrames)).toHaveBeenCalledTimes(1);
    const [attPath, , opts] = vi.mocked(extractFrames).mock.calls[0];
    expect(attPath).toBe(join(tmpDir, 'proj-1', 'attachments', 'demo.mp4'));
    expect(opts).toEqual(
      expect.objectContaining({ fps: 5, format: 'jpeg', quality: 85, maxFrames: 10 })
    );
    expect(outcome.videos).toContainEqual({
      filename: 'demo.mp4',
      frameCount: 12,
      dedupedCount: 4,
    });
  });

  it('forwards custom video options, overriding defaults', async () => {
    vi.mocked(isVideoFile).mockReturnValue(true);
    vi.mocked(extractFrames).mockResolvedValue({
      outputDir: join(tmpDir, 'frames'),
      frames: [],
      extractedCount: 3,
      keptCount: 2,
      droppedDuplicates: 1,
      droppedBlurry: 0,
    });

    const exporter = makeVideoExporter(VIDEO_TASK);
    await exporter.exportIssue('PROJ-1', {
      outputDir: tmpDir,
      videoFrames: { enabled: true, fps: 3, quality: 70, maxFrames: 5 },
    });

    const [, , opts] = vi.mocked(extractFrames).mock.calls[0];
    expect(opts).toEqual(
      expect.objectContaining({ fps: 3, quality: 70, maxFrames: 5, format: 'jpeg' })
    );
  });

  it('records an error entry when extraction fails without throwing', async () => {
    vi.mocked(isVideoFile).mockReturnValue(true);
    vi.mocked(extractFrames).mockRejectedValue(new Error('ffmpeg exploded'));

    const exporter = makeVideoExporter(VIDEO_TASK);
    const outcome = await exporter.exportIssue('PROJ-1', {
      outputDir: tmpDir,
      videoFrames: { enabled: true },
    });

    expect(outcome.videos).toContainEqual({
      filename: 'demo.mp4',
      frameCount: 0,
      dedupedCount: 0,
      error: 'ffmpeg exploded',
    });
  });

  it('does not extract frames when videoFrames is disabled', async () => {
    vi.mocked(isVideoFile).mockReturnValue(true);

    const exporter = makeVideoExporter(VIDEO_TASK);
    const outcome = await exporter.exportIssue('PROJ-1', { outputDir: tmpDir });

    expect(vi.mocked(extractFrames)).not.toHaveBeenCalled();
    expect(outcome.videos).toEqual([]);
  });
});

describe('JiraExporter attachment filename deduplication', () => {
  it('disambiguates duplicate filenames, preserving extension when present', async () => {
    const task: JiraTaskData = {
      ...FULL_TASK,
      attachments: [
        { id: '1', filename: 'doc.pdf', url: 'https://x.example/1', size: 10 },
        { id: '2', filename: 'doc.pdf', url: 'https://x.example/2', size: 20 },
        { id: '3', filename: 'README', url: 'https://x.example/3', size: 30 },
        { id: '4', filename: 'README', url: 'https://x.example/4', size: 40 },
      ],
    };
    const downloadAttachment = vi.fn(async (_url: string, attPath: string) => {
      writeFileSync(attPath, 'x');
    });
    const exporter = makeExporter(task, { downloadAttachment });

    const outcome = await exporter.exportIssue('PROJ-1', { outputDir: tmpDir });

    expect(outcome.attachmentCount).toBe(4);
    const savedNames = downloadAttachment.mock.calls.map(([, attPath]) =>
      (attPath as string).split('/').pop()
    );
    expect(savedNames).toEqual(['doc.pdf', 'doc-1.pdf', 'README', 'README-1']);
  });
});

describe('JiraExporter.exportIssues', () => {
  it('creates the output directory when it does not exist', async () => {
    const nested = join(tmpDir, 'deep', 'nested', 'out');
    const exporter = makeExporter(FULL_TASK);

    const result = await exporter.exportIssues(['PROJ-1'], { outputDir: nested });

    expect(existsSync(nested)).toBe(true);
    expect(existsSync(join(nested, '.gitignore'))).toBe(true);
    expect(result.imported).toHaveLength(1);
  });

  it('captures per-issue failures without aborting the batch', async () => {
    const exporter = makeExporter(FULL_TASK, {
      fetchIssueDetails: vi.fn(async (key: string) => {
        if (key === 'PROJ-BAD') throw new Error('boom');
        return FULL_TASK;
      }),
    });

    const result = await exporter.exportIssues(['PROJ-1', 'PROJ-BAD'], {
      outputDir: tmpDir,
    });

    expect(result.imported.map((i) => i.key)).toEqual(['PROJ-1']);
    expect(result.failed).toEqual([{ key: 'PROJ-BAD', error: 'boom' }]);
  });

  it('reports a non-Error rejection as a stringified error', async () => {
    const exporter = makeExporter(FULL_TASK, {
      fetchIssueDetails: vi.fn(async () => {
        throw 'plain string failure';
      }),
    });

    const result = await exporter.exportIssues(['PROJ-1'], { outputDir: tmpDir });

    expect(result.imported).toHaveLength(0);
    expect(result.failed).toEqual([{ key: 'PROJ-1', error: 'plain string failure' }]);
  });
});
