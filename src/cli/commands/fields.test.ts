import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadProfile: vi.fn(async () => ({
    config: { baseUrl: 'https://x', userEmail: 'u@x', projectKey: 'PROJ' },
    project: { key: 'PROJ' },
    apiToken: 'tok',
  })),
}));

const listFieldsMock = vi.fn();
const getCreateFieldsMock = vi.fn();
vi.mock('../../lib/jiraClient.js', () => ({
  JiraClient: class {
    listFields = listFieldsMock;
    getCreateFields = getCreateFieldsMock;
  },
}));

import { runFields } from './fields.js';

let logs: string[];
let writes: string[];
const originalIsTTY = process.stdout.isTTY;

beforeEach(() => {
  logs = [];
  writes = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.map(String).join(' ')); });
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { writes.push(String(c)); return true; });
  listFieldsMock.mockReset();
  getCreateFieldsMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
});

describe('runFields (default)', () => {
  it('lists only custom fields with their ids', async () => {
    listFieldsMock.mockResolvedValue([
      { id: 'summary', name: 'Summary', custom: false },
      { id: 'customfield_10050', name: 'Severity', custom: true },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFields({ org: 'acme' });
    const out = logs.join('\n');
    expect(out).toContain('Severity [customfield_10050]');
    expect(out).not.toContain('Summary');
  });

  it('emits custom fields as JSON', async () => {
    listFieldsMock.mockResolvedValue([
      { id: 'customfield_10050', name: 'Severity', custom: true },
      { id: 'summary', name: 'Summary', custom: false },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFields({ org: 'acme', json: true });
    expect(JSON.parse(writes.join(''))).toEqual([
      { id: 'customfield_10050', name: 'Severity', custom: true },
    ]);
  });
});

describe('runFields (--type)', () => {
  it('shows createmeta custom fields with allowed values', async () => {
    getCreateFieldsMock.mockResolvedValue([
      {
        fieldId: 'customfield_10050',
        name: 'Severity',
        required: true,
        schemaType: 'option',
        allowedValues: ['High', 'Low'],
      },
      { fieldId: 'summary', name: 'Summary', required: true },
    ]);
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    await runFields({ org: 'acme', type: 'Bug' });
    expect(getCreateFieldsMock).toHaveBeenCalledWith('PROJ', 'Bug');
    const out = logs.join('\n');
    expect(out).toContain('Severity [customfield_10050] (required)');
    expect(out).toContain('options: High, Low');
    expect(out).not.toContain('Summary');
  });
});
