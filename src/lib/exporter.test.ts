import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./videoFrameExtractor.js', () => ({
  isVideoFile: () => false,
  extractAndDeduplicateFrames: vi.fn(),
}));

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
    { type: 'blocks', key: 'PROJ-200', title: 'Blocked one', status: 'To Do' },
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
});

function makeExporter(task: JiraTaskData): JiraExporter {
  const exporter = new JiraExporter(FAKE_CONFIG, 'fake-token');
  // @ts-expect-error injecting fake client
  exporter.client = {
    fetchIssueDetails: vi.fn(async () => task),
    fetchIssueSubtasks: vi.fn(async () => []),
    downloadAttachment: vi.fn(async () => {}),
  };
  return exporter;
}

describe('JiraExporter.exportIssue frontmatter', () => {
  it('emits a nested jira: block with default preset fields', async () => {
    const exporter = makeExporter(FULL_TASK);
    await exporter.exportIssue('PROJ-1', { outputDir: tmpDir });
    const content = readFileSync(join(tmpDir, 'proj-1', 'task.md'), 'utf-8');

    expect(content).toMatch(/^---\njira:\n/);
    expect(content).toMatch(/^ {2}key: "PROJ-1"$/m);
    expect(content).toMatch(/^ {2}status: "In Progress"$/m);
    expect(content).toMatch(/^ {2}priority: "High"$/m);
    expect(content).toMatch(/^ {2}assignee: "Jane Doe"$/m);
    expect(content).toMatch(/^ {2}labels: \["tech-debt", "p1"\]$/m);
    expect(content).toMatch(/^ {2}sprint: "Sprint 42"$/m);
    expect(content).toMatch(/^ {2}parent: "PROJ-100 - Parent"$/m);
    expect(content).toMatch(/^ {2}epic: "PROJ-50 - Epic"$/m);
    // Old flat keys must not appear.
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

    expect(content).toMatch(/^ {2}key: "PROJ-9"$/m);
    expect(content).toMatch(/^ {2}status: "Open"$/m);
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
    expect(content).toMatch(/issueLinks:\n\s+- type: "blocks"/);
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
});
