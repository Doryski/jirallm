import type { CustomFieldDefs } from './exportFields.js';
import type { JiraBoard, JiraPage, JiraSprint } from './jiraClient.js';

/** The subset of JiraClient that sprint resolution needs — keeps this unit testable. */
export type SprintResolveClient = {
  detectSprintFieldId(): Promise<string | undefined>;
  listBoards(opts: { projectKey?: string; type?: 'scrum' }): Promise<JiraPage<JiraBoard>>;
  findBoardByName(name: string): Promise<JiraBoard>;
  listSprints(
    boardId: number,
    opts: { state?: 'active' }
  ): Promise<JiraPage<JiraSprint>>;
};

const CUSTOM_FIELD_ID_RE = /^customfield_\d+$/;

/** `--sprint none` / `--sprint null` takes the issue out of its sprint. */
function isClearToken(value: string): boolean {
  return value === 'none' || value === 'null';
}

async function resolveBoardId(
  client: SprintResolveClient,
  projectKey: string,
  boardName?: string
): Promise<number> {
  if (boardName) {
    const board = await client.findBoardByName(boardName);
    return board.id;
  }
  const boards = (await client.listBoards({ projectKey, type: 'scrum' })).values;
  if (boards.length === 0) {
    throw new Error(
      `No scrum board found for project ${projectKey} to resolve --sprint active. Pass --board <name>.`
    );
  }
  if (boards.length > 1) {
    const names = boards.map((b) => b.name).join(', ');
    throw new Error(
      `Multiple scrum boards for project ${projectKey}: ${names}. Pass --board <name> to pick one.`
    );
  }
  return boards[0].id;
}

async function resolveActiveSprintId(
  client: SprintResolveClient,
  projectKey: string,
  boardName?: string
): Promise<number> {
  const boardId = await resolveBoardId(client, projectKey, boardName);
  const page = await client.listSprints(boardId, { state: 'active' });
  const active = page.values.find((s) => s.state === 'active') ?? page.values[0];
  if (!active) {
    throw new Error(`No active sprint on board ${boardId}.`);
  }
  return active.id;
}

export type SprintFieldWrite = { fieldId: string; sprintId: number | null };

/**
 * Resolve a `--sprint <id|active|none>` value into the Sprint field id and the value to write.
 * - numeric id → that sprint id
 * - `active` → the (single, or --board-selected) scrum board's active sprint id
 * - `none` / `null` → `null` (clears the sprint)
 * The Sprint field id comes from a configured `sprint` custom-field def, else greenhopper detection.
 */
export async function resolveSprintFieldWrite(
  client: SprintResolveClient,
  value: string,
  opts: { projectKey: string; board?: string; customFieldDefs?: CustomFieldDefs }
): Promise<SprintFieldWrite> {
  const configured = opts.customFieldDefs?.sprint?.id;
  const fieldId =
    configured && CUSTOM_FIELD_ID_RE.test(configured)
      ? configured
      : await client.detectSprintFieldId();
  if (!fieldId) {
    throw new Error(
      'Could not detect the Sprint field. Configure it under [orgs.<org>.export.custom_fields] ' +
        'as `sprint = { id = "customfield_NNNNN", type = "sprint" }`, or set it via ' +
        '--field customfield_NNNNN:number=<id>.'
    );
  }

  if (isClearToken(value)) {
    return { fieldId, sprintId: null };
  }
  if (value === 'active') {
    const sprintId = await resolveActiveSprintId(client, opts.projectKey, opts.board);
    return { fieldId, sprintId };
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid --sprint "${value}". Expected a sprint id, "active", or "none".`);
  }
  return { fieldId, sprintId: n };
}

/**
 * Merge a resolved `--sprint` write into an existing `--field` custom-field map.
 * No-op when `sprint` is undefined; `--sprint` wins over any `--field` targeting the same id.
 */
export async function withResolvedSprint(
  client: SprintResolveClient,
  customFields: Record<string, unknown> | undefined,
  sprint: string | undefined,
  opts: { projectKey: string; board?: string; customFieldDefs?: CustomFieldDefs }
): Promise<Record<string, unknown> | undefined> {
  if (sprint === undefined) return customFields;
  const { fieldId, sprintId } = await resolveSprintFieldWrite(client, sprint, opts);
  return { ...(customFields ?? {}), [fieldId]: sprintId };
}
