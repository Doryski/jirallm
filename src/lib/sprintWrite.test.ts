import { describe, expect, it, vi } from 'vitest';
import {
  resolveSprintFieldWrite,
  withResolvedSprint,
  type SprintResolveClient,
} from './sprintWrite.js';
import type { JiraBoard, JiraPage, JiraSprint } from './jiraClient.js';

function page<T>(values: T[]): JiraPage<T> {
  return { values, startAt: 0, maxResults: 50, total: values.length, isLast: true };
}

const board = (id: number, name: string): JiraBoard => ({ id, name, type: 'scrum' });
const sprint = (id: number, state: JiraSprint['state']): JiraSprint =>
  ({ id, state, name: `S${id}`, self: '' });

function makeClient(over: Partial<SprintResolveClient> = {}): SprintResolveClient {
  return {
    detectSprintFieldId: vi.fn(async () => 'customfield_10020'),
    listBoards: vi.fn(async () => page([board(1, 'Scrum Board')])),
    findBoardByName: vi.fn(async () => board(9, 'Named')),
    listSprints: vi.fn(async () => page([sprint(42, 'active')])),
    ...over,
  };
}

describe('resolveSprintFieldWrite', () => {
  it('writes a numeric sprint id via the detected field', async () => {
    const client = makeClient();
    expect(await resolveSprintFieldWrite(client, '42', { projectKey: 'PROJ' })).toEqual({
      fieldId: 'customfield_10020',
      sprintId: 42,
    });
    expect(client.listBoards).not.toHaveBeenCalled();
  });

  it('clears the sprint on "none"', async () => {
    const client = makeClient();
    expect(await resolveSprintFieldWrite(client, 'none', { projectKey: 'PROJ' })).toEqual({
      fieldId: 'customfield_10020',
      sprintId: null,
    });
  });

  it('clears the sprint on "null"', async () => {
    const client = makeClient();
    expect(await resolveSprintFieldWrite(client, 'null', { projectKey: 'PROJ' })).toEqual({
      fieldId: 'customfield_10020',
      sprintId: null,
    });
  });

  it('resolves "active" to the single scrum board\'s active sprint', async () => {
    const client = makeClient({
      listBoards: vi.fn(async () => page([board(7, 'The Board')])),
      listSprints: vi.fn(async () => page([sprint(101, 'active')])),
    });
    expect(await resolveSprintFieldWrite(client, 'active', { projectKey: 'PROJ' })).toEqual({
      fieldId: 'customfield_10020',
      sprintId: 101,
    });
    expect(client.listSprints).toHaveBeenCalledWith(7, { state: 'active' });
  });

  it('uses --board to pick the board for "active"', async () => {
    const listBoards = vi.fn(async () => page<JiraBoard>([]));
    const client = makeClient({
      listBoards,
      findBoardByName: vi.fn(async () => board(55, 'Beta')),
      listSprints: vi.fn(async () => page([sprint(9, 'active')])),
    });
    const res = await resolveSprintFieldWrite(client, 'active', {
      projectKey: 'PROJ',
      board: 'Beta',
    });
    expect(res.sprintId).toBe(9);
    expect(client.findBoardByName).toHaveBeenCalledWith('Beta');
    expect(listBoards).not.toHaveBeenCalled();
  });

  it('errors when no scrum board exists for "active"', async () => {
    const client = makeClient({ listBoards: vi.fn(async () => page<JiraBoard>([])) });
    await expect(
      resolveSprintFieldWrite(client, 'active', { projectKey: 'PROJ' })
    ).rejects.toThrow(/No scrum board/);
  });

  it('errors on multiple boards without --board', async () => {
    const client = makeClient({
      listBoards: vi.fn(async () => page([board(1, 'A'), board(2, 'B')])),
    });
    await expect(
      resolveSprintFieldWrite(client, 'active', { projectKey: 'PROJ' })
    ).rejects.toThrow(/Multiple scrum boards/);
  });

  it('errors when no active sprint is found', async () => {
    const client = makeClient({ listSprints: vi.fn(async () => page<JiraSprint>([])) });
    await expect(
      resolveSprintFieldWrite(client, 'active', { projectKey: 'PROJ' })
    ).rejects.toThrow(/No active sprint/);
  });

  it('prefers a configured sprint field id over detection', async () => {
    const detect = vi.fn(async () => 'customfield_99999');
    const client = makeClient({ detectSprintFieldId: detect });
    const res = await resolveSprintFieldWrite(client, '5', {
      projectKey: 'PROJ',
      customFieldDefs: { sprint: { id: 'customfield_10111', type: 'sprint' } },
    });
    expect(res.fieldId).toBe('customfield_10111');
    expect(detect).not.toHaveBeenCalled();
  });

  it('ignores a sentinel configured id and falls back to detection', async () => {
    const client = makeClient();
    const res = await resolveSprintFieldWrite(client, '5', {
      projectKey: 'PROJ',
      customFieldDefs: { sprint: { id: '__sprint__', type: 'sprint' } },
    });
    expect(res.fieldId).toBe('customfield_10020');
    expect(client.detectSprintFieldId).toHaveBeenCalled();
  });

  it('errors when the sprint field cannot be resolved', async () => {
    const client = makeClient({ detectSprintFieldId: vi.fn(async () => undefined) });
    await expect(resolveSprintFieldWrite(client, '5', { projectKey: 'PROJ' })).rejects.toThrow(
      /Could not detect the Sprint field/
    );
  });

  it('rejects a non-numeric, non-keyword value', async () => {
    const client = makeClient();
    await expect(
      resolveSprintFieldWrite(client, 'banana', { projectKey: 'PROJ' })
    ).rejects.toThrow(/Invalid --sprint/);
  });
});

describe('withResolvedSprint', () => {
  it('is a no-op when sprint is undefined', async () => {
    const client = makeClient();
    const existing = { customfield_10050: { value: 'High' } };
    expect(await withResolvedSprint(client, existing, undefined, { projectKey: 'PROJ' })).toBe(
      existing
    );
    expect(client.detectSprintFieldId).not.toHaveBeenCalled();
  });

  it('merges the resolved sprint into existing fields', async () => {
    const client = makeClient();
    const res = await withResolvedSprint(
      client,
      { customfield_10050: { value: 'High' } },
      '42',
      { projectKey: 'PROJ' }
    );
    expect(res).toEqual({ customfield_10050: { value: 'High' }, customfield_10020: 42 });
  });

  it('starts a fresh map when there are no --field values', async () => {
    const client = makeClient();
    expect(await withResolvedSprint(client, undefined, 'none', { projectKey: 'PROJ' })).toEqual({
      customfield_10020: null,
    });
  });
});
