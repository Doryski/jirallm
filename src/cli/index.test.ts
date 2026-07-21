import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from 'commander';

const runInitMock = vi.fn();
const runAuthSetMock = vi.fn();
const runAuthRmMock = vi.fn();
const runAuthListMock = vi.fn();
const runAuthStatusMock = vi.fn();
const runOrgsListMock = vi.fn();
const runOrgsRemoveMock = vi.fn();
const runProjectRemoveMock = vi.fn();
const runDoctorMock = vi.fn();
const runSetupMock = vi.fn();
const runCommentMock = vi.fn();
const runCommentListMock = vi.fn();
const runDeleteCommentMock = vi.fn();
const runBoardIssuesMock = vi.fn();
const runTransitionMock = vi.fn();
const runWorklogMock = vi.fn();
const runSearchMock = vi.fn();
const runProjectsMock = vi.fn();
const runBoardsMock = vi.fn();
const runSprintsMock = vi.fn();
const runIssueTypesMock = vi.fn();
const runComponentsMock = vi.fn();
const runFieldsMock = vi.fn();
const runLinkTypesMock = vi.fn();
const runMeMock = vi.fn();
const runUsersMock = vi.fn();
const runFetchMock = vi.fn();
const runCreateMock = vi.fn();
const runEditMock = vi.fn();
const runAssignMock = vi.fn();
const runLinkMock = vi.fn();
const runLinkRemoveMock = vi.fn();
const runAttachMock = vi.fn();
const runAttachRemoveMock = vi.fn();
const runWatchersMock = vi.fn();
const runUpgradeMock = vi.fn();
const exportIssuesMock = vi.fn();
const listOrgsMock = vi.fn();
const loadProfileMock = vi.fn();
const resolveOrgInteractiveMock = vi.fn();

vi.mock('./commands/init.js', () => ({ runInit: (...a: unknown[]) => runInitMock(...a) }));
vi.mock('./commands/auth.js', () => ({
  runAuthSet: (...a: unknown[]) => runAuthSetMock(...a),
  runAuthRm: (...a: unknown[]) => runAuthRmMock(...a),
  runAuthList: (...a: unknown[]) => runAuthListMock(...a),
  runAuthStatus: (...a: unknown[]) => runAuthStatusMock(...a),
}));
vi.mock('./commands/orgs.js', () => ({
  runOrgsList: (...a: unknown[]) => runOrgsListMock(...a),
  runOrgsRemove: (...a: unknown[]) => runOrgsRemoveMock(...a),
  runProjectRemove: (...a: unknown[]) => runProjectRemoveMock(...a),
}));
vi.mock('./commands/doctor.js', () => ({ runDoctor: (...a: unknown[]) => runDoctorMock(...a) }));
vi.mock('./commands/setup.js', () => ({ runSetup: (...a: unknown[]) => runSetupMock(...a) }));
vi.mock('./commands/comment.js', () => ({
  runComment: (...a: unknown[]) => runCommentMock(...a),
  runCommentList: (...a: unknown[]) => runCommentListMock(...a),
  runDeleteComment: (...a: unknown[]) => runDeleteCommentMock(...a),
}));
vi.mock('./commands/board.js', () => ({ runBoardIssues: (...a: unknown[]) => runBoardIssuesMock(...a) }));
vi.mock('./commands/transition.js', () => ({ runTransition: (...a: unknown[]) => runTransitionMock(...a) }));
vi.mock('./commands/worklog.js', () => ({ runWorklog: (...a: unknown[]) => runWorklogMock(...a) }));
vi.mock('./commands/search.js', () => ({ runSearch: (...a: unknown[]) => runSearchMock(...a) }));
vi.mock('./commands/projects.js', () => ({ runProjects: (...a: unknown[]) => runProjectsMock(...a) }));
vi.mock('./commands/boards.js', () => ({ runBoards: (...a: unknown[]) => runBoardsMock(...a) }));
vi.mock('./commands/sprints.js', () => ({ runSprints: (...a: unknown[]) => runSprintsMock(...a) }));
vi.mock('./commands/issuetypes.js', () => ({ runIssueTypes: (...a: unknown[]) => runIssueTypesMock(...a) }));
vi.mock('./commands/components.js', () => ({ runComponents: (...a: unknown[]) => runComponentsMock(...a) }));
vi.mock('./commands/fields.js', () => ({ runFields: (...a: unknown[]) => runFieldsMock(...a) }));
vi.mock('./commands/linktypes.js', () => ({ runLinkTypes: (...a: unknown[]) => runLinkTypesMock(...a) }));
vi.mock('./commands/me.js', () => ({ runMe: (...a: unknown[]) => runMeMock(...a) }));
vi.mock('./commands/users.js', () => ({ runUsers: (...a: unknown[]) => runUsersMock(...a) }));
vi.mock('./commands/fetch.js', () => ({ runFetch: (...a: unknown[]) => runFetchMock(...a) }));
vi.mock('./commands/create.js', () => ({ runCreate: (...a: unknown[]) => runCreateMock(...a) }));
vi.mock('./commands/edit.js', () => ({ runEdit: (...a: unknown[]) => runEditMock(...a) }));
vi.mock('./commands/assign.js', () => ({ runAssign: (...a: unknown[]) => runAssignMock(...a) }));
vi.mock('./commands/link.js', () => ({
  runLink: (...a: unknown[]) => runLinkMock(...a),
  runLinkRemove: (...a: unknown[]) => runLinkRemoveMock(...a),
}));
vi.mock('./commands/attach.js', () => ({
  runAttach: (...a: unknown[]) => runAttachMock(...a),
  runAttachRemove: (...a: unknown[]) => runAttachRemoveMock(...a),
}));
vi.mock('./commands/watchers.js', () => ({ runWatchers: (...a: unknown[]) => runWatchersMock(...a) }));
vi.mock('./commands/upgrade.js', () => ({ runUpgrade: (...a: unknown[]) => runUpgradeMock(...a) }));
vi.mock('../lib/exporter.js', () => ({
  JiraExporter: class {
    exportIssues = exportIssuesMock;
  },
}));
vi.mock('../lib/config.js', async () => {
  const actual = await vi.importActual<typeof import('../lib/config.js')>('../lib/config.js');
  return {
    ...actual,
    listOrgs: (...a: unknown[]) => listOrgsMock(...a),
    loadProfile: (...a: unknown[]) => loadProfileMock(...a),
  };
});
vi.mock('./resolveOrg.js', () => ({
  resolveOrgInteractive: (...a: unknown[]) => resolveOrgInteractiveMock(...a),
}));
vi.mock('update-notifier', () => ({
  default: () => ({ notify: vi.fn() }),
}));

import { buildProgram } from './index.js';

const run = (args: string[]): Promise<Command> =>
  buildProgram().exitOverride().parseAsync(args, { from: 'user' });

const firstArg = (mock: ReturnType<typeof vi.fn>): unknown => mock.mock.calls[0][0];
const argAt = (mock: ReturnType<typeof vi.fn>, index: number): unknown => mock.mock.calls[0][index];

let logs: string[];
let errs: string[];
const originalArgv = process.argv;

beforeEach(() => {
  vi.clearAllMocks();
  logs = [];
  errs = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(console, 'error').mockImplementation((...a) => { errs.push(a.map(String).join(' ')); });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.argv = originalArgv;
});

describe('create command wiring', () => {
  it('maps -o/-t/-s and --dry-run, leaving -P (projectKey) undefined', async () => {
    await run(['create', '-o', 'acme', '-t', 'Task', '-s', 'x', '--dry-run']);
    expect(runCreateMock).toHaveBeenCalledTimes(1);
    expect(firstArg(runCreateMock)).toMatchObject({
      org: 'acme',
      projectKey: undefined,
      type: 'Task',
      summary: 'x',
      dryRun: true,
    });
  });

  it('maps -P to projectKey and collects repeatable --field/--components', async () => {
    await run([
      'create', '-o', 'acme', '-P', 'PROJ', '-t', 'Bug', '-s', 'y',
      '-F', 'a=1', '-F', 'b=2',
      '--components', 'Web', '--components', 'Foo, Bar & Baz',
    ]);
    expect(firstArg(runCreateMock)).toMatchObject({
      projectKey: 'PROJ',
      field: ['a=1', 'b=2'],
      components: ['Web', 'Foo, Bar & Baz'],
    });
  });

  it('errors via commander when the required -t option is missing', async () => {
    await expect(run(['create', '-s', 'x'])).rejects.toThrow();
    expect(runCreateMock).not.toHaveBeenCalled();
  });

  it('defaults noWiki to false', async () => {
    await run(['create', '-o', 'acme', '-t', 'Task', '-s', 'x', '-d', 'body']);
    expect(firstArg(runCreateMock)).toMatchObject({ noWiki: false });
  });

  it('sets noWiki when --no-wiki is passed', async () => {
    await run(['create', '-o', 'acme', '-t', 'Task', '-s', 'x', '-d', 'body', '--no-wiki']);
    expect(firstArg(runCreateMock)).toMatchObject({ noWiki: true });
  });
});

describe('edit command wiring', () => {
  it('maps the <issue-key> positional and --summary/--dry-run flags', async () => {
    await run(['edit', 'PROJ-1', '-s', 'new title', '--dry-run']);
    expect(firstArg(runEditMock)).toMatchObject({
      issueKey: 'PROJ-1',
      summary: 'new title',
      dryRun: true,
    });
  });

  it('defaults noWiki to false', async () => {
    await run(['edit', 'PROJ-1', '-d', 'body']);
    expect(firstArg(runEditMock)).toMatchObject({ issueKey: 'PROJ-1', noWiki: false });
  });

  it('sets noWiki when --no-wiki is passed', async () => {
    await run(['edit', 'PROJ-1', '-d', 'body', '--no-wiki']);
    expect(firstArg(runEditMock)).toMatchObject({ issueKey: 'PROJ-1', noWiki: true });
  });
});

describe('assign command wiring', () => {
  it('maps <issue-key> and <assignee> positionals plus --json', async () => {
    await run(['assign', 'PROJ-1', 'me', '--json']);
    expect(firstArg(runAssignMock)).toMatchObject({
      issueKey: 'PROJ-1',
      assignee: 'me',
      json: true,
    });
  });
});

describe('link command wiring', () => {
  it('maps <inward> <type> <outward> positionals', async () => {
    await run(['link', 'FOO-1', 'Blocks', 'FOO-2', '--dry-run']);
    expect(firstArg(runLinkMock)).toMatchObject({
      inwardKey: 'FOO-1',
      type: 'Blocks',
      outwardKey: 'FOO-2',
      dryRun: true,
    });
  });
});

describe('link:rm command wiring', () => {
  it('uses the [issue-key] positional as linkId together with --to', async () => {
    await run(['link:rm', 'PROJ-1', '--to', 'PROJ-2']);
    expect(firstArg(runLinkRemoveMock)).toMatchObject({
      linkId: 'PROJ-1',
      to: 'PROJ-2',
    });
  });

  it('accepts a bare numeric link id with -o and no --to', async () => {
    await run(['link:rm', '10042', '-o', 'acme']);
    expect(firstArg(runLinkRemoveMock)).toMatchObject({
      linkId: '10042',
      to: undefined,
      org: 'acme',
    });
  });

  it('throws when neither a target nor --to is provided', async () => {
    await expect(run(['link:rm'])).rejects.toThrow('exit:1');
    expect(runLinkRemoveMock).not.toHaveBeenCalled();
    expect(errs.join('\n')).toContain('Provide a link id');
  });
});

describe('attach command wiring', () => {
  it('maps <issue-key> and variadic [files...]', async () => {
    await run(['attach', 'PROJ-1', './a.png', './b.png', '--json']);
    expect(firstArg(runAttachMock)).toMatchObject({
      issueKey: 'PROJ-1',
      files: ['./a.png', './b.png'],
      json: true,
    });
  });

  it('errors (exit 1) when no files are given', async () => {
    await expect(run(['attach', 'PROJ-1'])).rejects.toThrow('exit:1');
    expect(runAttachMock).not.toHaveBeenCalled();
    expect(errs.join('\n')).toContain('At least one file is required');
  });
});

describe('attach:rm command wiring', () => {
  it('maps [target] and [filename] positionals', async () => {
    await run(['attach:rm', 'PROJ-1', 'screenshot.png']);
    expect(firstArg(runAttachRemoveMock)).toMatchObject({
      target: 'PROJ-1',
      filename: 'screenshot.png',
    });
  });
});

describe('worklog command wiring', () => {
  it('maps the [issue-key] [duration] quick-form positionals', async () => {
    await run(['worklog', 'PROJ-1', '1h 30m', '--dry-run']);
    expect(firstArg(runWorklogMock)).toMatchObject({
      issueKey: 'PROJ-1',
      duration: '1h 30m',
      dryRun: true,
      noWiki: false,
    });
  });
});

describe('search command wiring', () => {
  it('aliases --next-page-token onto cursor and drops nextPageToken', async () => {
    await run(['search', 'project = PROJ', '-o', 'acme', '--next-page-token', 'tok']);
    const arg = firstArg(runSearchMock) as Record<string, unknown>;
    expect(arg).toMatchObject({ jql: 'project = PROJ', org: 'acme', cursor: 'tok' });
    expect(arg).not.toHaveProperty('nextPageToken');
  });

  it('prefers --cursor over --next-page-token', async () => {
    await run(['search', 'project = PROJ', '--cursor', 'c1', '--next-page-token', 'c2']);
    expect(firstArg(runSearchMock)).toMatchObject({ cursor: 'c1' });
  });
});

describe('transition command wiring', () => {
  it('maps <issue-key> and --to', async () => {
    await run(['transition', 'PROJ-1', '--to', 'In Review']);
    expect(runTransitionMock).toHaveBeenCalledWith(
      'PROJ-1',
      expect.objectContaining({ to: 'In Review' })
    );
  });

  it('exits when neither --to nor --list is provided', async () => {
    await expect(run(['transition', 'PROJ-1'])).rejects.toThrow('exit:1');
    expect(runTransitionMock).not.toHaveBeenCalled();
    expect(errs.join('\n')).toContain('Either --to');
  });
});

describe('comment command wiring', () => {
  it('maps <issue-key>, -t and derives noWiki/noThread defaults', async () => {
    await run(['comment', 'PROJ-1', '-t', 'hi', '--dry-run']);
    expect(runCommentMock).toHaveBeenCalledWith(
      'PROJ-1',
      expect.objectContaining({ text: 'hi', dryRun: true, noWiki: false, noThread: false })
    );
  });

  it('sets noWiki when --no-wiki is passed', async () => {
    await run(['comment', 'PROJ-1', '-t', 'hi', '--no-wiki']);
    expect(argAt(runCommentMock, 1)).toMatchObject({ noWiki: true });
  });
});

describe('comment:rm command wiring', () => {
  it('maps <issue-key> <comment-id> and --yes', async () => {
    await run(['comment:rm', 'PROJ-1', '26215', '--yes']);
    expect(runDeleteCommentMock).toHaveBeenCalledWith(
      'PROJ-1',
      '26215',
      expect.objectContaining({ yes: true })
    );
  });
});

describe('comment:ls command wiring', () => {
  it('maps <issue-key> and --json', async () => {
    await run(['comment:ls', 'PROJ-1', '--json']);
    expect(runCommentListMock).toHaveBeenCalledWith('PROJ-1', expect.objectContaining({ json: true }));
  });
});

describe('board:issues command wiring', () => {
  it('maps -b/-c/-o/-a/--json onto the options object', async () => {
    await run(['board:issues', '-b', 'My Board', '-o', 'acme', '-c', 'Done', '-a', 'me', '--json']);
    expect(firstArg(runBoardIssuesMock)).toMatchObject({
      board: 'My Board',
      org: 'acme',
      column: 'Done',
      assignee: 'me',
      json: true,
    });
  });
});

describe('watchers command wiring', () => {
  it('maps <issue-key>, --add and --rm', async () => {
    await run(['watchers', 'PROJ-1', '--add', 'me', '--rm', 'x', '--json']);
    expect(firstArg(runWatchersMock)).toMatchObject({
      issueKey: 'PROJ-1',
      add: 'me',
      rm: 'x',
      json: true,
    });
  });
});

describe('fetch command wiring', () => {
  it('maps <issue-key> plus --full/--with-comments flags', async () => {
    await run(['fetch', 'PROJ-1', '--full', '--with-comments']);
    expect(firstArg(runFetchMock)).toMatchObject({
      issueKey: 'PROJ-1',
      full: true,
      withComments: true,
    });
  });
});

describe('init command wiring', () => {
  it('maps --org and -y', async () => {
    await run(['init', '--org', 'acme', '-y']);
    expect(firstArg(runInitMock)).toMatchObject({ org: 'acme', yes: true });
  });
});

describe('auth command wiring', () => {
  it('auth set passes only the org string', async () => {
    await run(['auth', 'set', '-o', 'acme']);
    expect(runAuthSetMock).toHaveBeenCalledWith('acme');
  });

  it('auth rm passes org and { yes }', async () => {
    await run(['auth', 'rm', '-o', 'acme', '-y']);
    expect(runAuthRmMock).toHaveBeenCalledWith('acme', { yes: true });
  });

  it('auth list takes no args', async () => {
    await run(['auth', 'list']);
    expect(runAuthListMock).toHaveBeenCalledTimes(1);
  });

  it('auth status passes the org string', async () => {
    await run(['auth', 'status', '-o', 'acme']);
    expect(runAuthStatusMock).toHaveBeenCalledWith('acme');
  });
});

describe('orgs command wiring', () => {
  it('orgs list maps --json', async () => {
    await run(['orgs', 'list', '--json']);
    expect(firstArg(runOrgsListMock)).toMatchObject({ json: true });
  });

  it('orgs rm uses the positional org', async () => {
    await run(['orgs', 'rm', 'acme', '--dry-run']);
    expect(runOrgsRemoveMock).toHaveBeenCalledWith('acme', expect.objectContaining({ dryRun: true }));
  });

  it('orgs rm falls back to --org when no positional given', async () => {
    await run(['orgs', 'rm', '--org', 'acme']);
    expect(argAt(runOrgsRemoveMock, 0)).toBe('acme');
  });

  it('orgs rm throws when no org is provided', async () => {
    await expect(run(['orgs', 'rm'])).rejects.toThrow(/Organization name is required/);
    expect(runOrgsRemoveMock).not.toHaveBeenCalled();
  });

  it('orgs project rm maps -o and -P', async () => {
    await run(['orgs', 'project', 'rm', '-o', 'acme', '-P', 'PROJ']);
    expect(runProjectRemoveMock).toHaveBeenCalledWith('acme', 'PROJ', expect.any(Object));
  });

  it('orgs project rm accepts the hidden -k alias for the project key', async () => {
    await run(['orgs', 'project', 'rm', '-o', 'acme', '-k', 'PROJ']);
    expect(argAt(runProjectRemoveMock, 1)).toBe('PROJ');
  });

  it('orgs project rm throws when the project key is missing', async () => {
    await expect(run(['orgs', 'project', 'rm', '-o', 'acme'])).rejects.toThrow(/Project key is required/);
    expect(runProjectRemoveMock).not.toHaveBeenCalled();
  });
});

describe('doctor command wiring', () => {
  it('maps -o/--strict/--json', async () => {
    await run(['doctor', '-o', 'acme', '--strict', '--json']);
    expect(firstArg(runDoctorMock)).toMatchObject({
      org: 'acme',
      project: undefined,
      strict: true,
      json: true,
    });
  });
});

describe('setup command wiring', () => {
  it('maps --yes/--allow-brew/--dry-run', async () => {
    await run(['setup', '--yes', '--allow-brew', '--dry-run']);
    expect(firstArg(runSetupMock)).toMatchObject({
      yes: true,
      allowBrew: true,
      dryRun: true,
    });
  });
});

describe('upgrade command wiring', () => {
  it('maps --check/--json', async () => {
    await run(['upgrade', '--check', '--json']);
    expect(firstArg(runUpgradeMock)).toMatchObject({ check: true, json: true });
  });
});

describe('list-style command wiring', () => {
  it('projects maps -o/--query', async () => {
    await run(['projects', '-o', 'acme', '--query', 'docs']);
    expect(firstArg(runProjectsMock)).toMatchObject({ org: 'acme', query: 'docs' });
  });

  it('boards maps -o/-P/-t', async () => {
    await run(['boards', '-o', 'acme', '-P', 'PROJ', '-t', 'scrum']);
    expect(firstArg(runBoardsMock)).toMatchObject({ org: 'acme', project: 'PROJ', type: 'scrum' });
  });

  it('sprints maps <board-id> positional and -o/--state', async () => {
    await run(['sprints', '42', '-o', 'acme', '--state', 'active']);
    expect(firstArg(runSprintsMock)).toMatchObject({ boardId: '42', org: 'acme', state: 'active' });
  });

  it('issuetypes maps -o/-P', async () => {
    await run(['issuetypes', '-o', 'acme', '-P', 'PROJ']);
    expect(firstArg(runIssueTypesMock)).toMatchObject({ org: 'acme', project: 'PROJ' });
  });

  it('components maps -o/-P', async () => {
    await run(['components', '-o', 'acme', '-P', 'PROJ']);
    expect(firstArg(runComponentsMock)).toMatchObject({ org: 'acme', project: 'PROJ' });
  });

  it('fields maps -o/-P/-t', async () => {
    await run(['fields', '-o', 'acme', '-P', 'PROJ', '-t', 'Bug']);
    expect(firstArg(runFieldsMock)).toMatchObject({ org: 'acme', project: 'PROJ', type: 'Bug' });
  });

  it('linktypes maps -o', async () => {
    await run(['linktypes', '-o', 'acme']);
    expect(firstArg(runLinkTypesMock)).toMatchObject({ org: 'acme' });
  });

  it('me maps -o', async () => {
    await run(['me', '-o', 'acme']);
    expect(firstArg(runMeMock)).toMatchObject({ org: 'acme' });
  });

  it('users maps the query plus -o/-P/--issue/--limit', async () => {
    await run(['users', 'jane@example.com', '-o', 'acme', '-P', 'PROJ', '--issue', 'PROJ-1', '--limit', '10']);
    expect(firstArg(runUsersMock)).toMatchObject({
      query: 'jane@example.com',
      org: 'acme',
      project: 'PROJ',
      issue: 'PROJ-1',
      limit: '10',
    });
  });

  it('exposes "user" as an alias of "users"', async () => {
    await run(['user', 'Jane Doe', '-o', 'acme']);
    expect(firstArg(runUsersMock)).toMatchObject({ query: 'Jane Doe', org: 'acme' });
  });
});

describe('error reporting branches', () => {
  it('prints a plain error message when a command fails without --json', async () => {
    runMeMock.mockRejectedValueOnce(new Error('boom'));
    await expect(run(['me', '-o', 'acme'])).rejects.toThrow('exit:1');
    expect(errs.join('\n')).toBe('boom');
  });

  it('prints a JSON error envelope when --json is active', async () => {
    process.argv = ['node', 'cli', 'me', '-o', 'acme', '--json'];
    runMeMock.mockRejectedValueOnce(new Error('kapow'));
    await expect(run(['me', '-o', 'acme', '--json'])).rejects.toThrow('exit:1');
    expect(JSON.parse(errs.join('\n'))).toEqual({ error: 'kapow' });
  });
});

describe('default export command', () => {
  it('prints the dry-run plan and never constructs an exporter', async () => {
    listOrgsMock.mockReturnValue(['acme']);
    resolveOrgInteractiveMock.mockResolvedValue('acme');
    loadProfileMock.mockResolvedValue({
      config: { baseUrl: 'https://x', userEmail: 'u@x' },
      org: {},
      project: { key: 'PROJ' },
      apiToken: 'tok',
    });
    await run(['PROJ-123', '--dry-run']);
    expect(exportIssuesMock).not.toHaveBeenCalled();
    const output = logs.join('\n');
    expect(output).toContain('Dry run');
    expect(output).toContain('PROJ-123');
  });

  it('performs the export and prints a summary when not a dry run', async () => {
    listOrgsMock.mockReturnValue(['acme']);
    resolveOrgInteractiveMock.mockResolvedValue('acme');
    loadProfileMock.mockResolvedValue({
      config: { baseUrl: 'https://x', userEmail: 'u@x' },
      org: {},
      project: { key: 'PROJ' },
      apiToken: 'tok',
    });
    exportIssuesMock.mockResolvedValue({
      imported: [{ key: 'PROJ-123', path: './out/PROJ-123.md', attachmentCount: 2 }],
      updated: [],
      failed: [],
    });
    await run(['PROJ-123']);
    expect(exportIssuesMock).toHaveBeenCalledTimes(1);
    expect(logs.join('\n')).toContain('Imported (1)');
    expect(logs.join('\n')).toContain('attachments: 2');
  });

  it('prints help and exits 0 when invoked bare with orgs configured', async () => {
    listOrgsMock.mockReturnValue(['acme']);
    await expect(run([])).rejects.toThrow('exit:0');
    expect(runInitMock).not.toHaveBeenCalled();
  });

  it('runs the init wizard when invoked bare with no orgs configured', async () => {
    listOrgsMock.mockReturnValue([]);
    await expect(run([])).rejects.toThrow('exit:0');
    expect(runInitMock).toHaveBeenCalledTimes(1);
  });
});
