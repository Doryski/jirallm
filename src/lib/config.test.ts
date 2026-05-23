import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./credentials.js', () => ({
  getToken: vi.fn(async (_name: string) => 'fake-token'),
}));

import {
  findOrgsByProjectKey,
  loadProfile,
  readConfig,
  upsertOrg,
  upsertProject,
} from './config.js';
import { getToken } from './credentials.js';
const mockedGetToken = vi.mocked(getToken);

let tmpDir: string;
let configPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'jirallm-cfg-'));
  configPath = join(tmpDir, 'config.toml');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const SAMPLE_CONFIG = `[orgs.widgets]
base_url = "https://widgets.atlassian.net"
user_email = "user@widgets.example"

[orgs.widgets.projects.WID]
output_dir = "~/jira/widgets"

[orgs.acme]
base_url = "https://acme.atlassian.net"
user_email = "user@acme.example"

[orgs.acme.projects.PROJ]
output_dir = "~/jira/acme/proj"

[orgs.acme.projects.DOCS]
output_dir = "~/jira/acme/docs"

[orgs.acme.projects.LIB]
`;

describe('loadProfile', () => {
  it('throws helpful error when nothing is configured', async () => {
    await expect(loadProfile({ configPath })).rejects.toThrow(/--org/);
  });

  it('resolves org and project selectors', async () => {
    writeFileSync(configPath, SAMPLE_CONFIG);
    const r = await loadProfile({ org: 'acme', project: 'DOCS', configPath });
    expect(r.org.name).toBe('acme');
    expect(r.project.key).toBe('DOCS');
    expect(r.config.projectKey).toBe('DOCS');
    expect(r.config.baseUrl).toBe('https://acme.atlassian.net');
    expect(r.project.outputDir).toMatch(/jira\/acme\/docs$/);
    expect(r.project.outputDir?.startsWith('~')).toBe(false);
  });

  it('errors when no project is provided', async () => {
    writeFileSync(configPath, SAMPLE_CONFIG);
    await expect(loadProfile({ org: 'widgets', configPath })).rejects.toThrow(
      /No project specified/
    );
  });

  it('errors when no org is provided', async () => {
    writeFileSync(configPath, SAMPLE_CONFIG);
    await expect(loadProfile({ configPath })).rejects.toThrow(/--org/);
  });

  it('errors when org has no token', async () => {
    writeFileSync(configPath, SAMPLE_CONFIG);
    mockedGetToken.mockResolvedValueOnce(undefined);
    await expect(loadProfile({ org: 'acme', project: 'PROJ', configPath })).rejects.toThrow(
      /No API token/
    );
  });

  it('errors on missing org', async () => {
    writeFileSync(configPath, SAMPLE_CONFIG);
    await expect(loadProfile({ org: 'nope', project: 'PROJ', configPath })).rejects.toThrow(
      /not found/
    );
  });

  it('errors on missing project under known org', async () => {
    writeFileSync(configPath, SAMPLE_CONFIG);
    await expect(loadProfile({ org: 'acme', project: 'NOPE', configPath })).rejects.toThrow(
      /not found in org/
    );
  });
});

describe('upsertOrg + upsertProject', () => {
  it('writes and round-trips an org with projects', () => {
    upsertOrg(
      {
        name: 'fresh',
        baseUrl: 'https://fresh.example',
        userEmail: 'f@x.example',
        videoFrames: { enabled: true, fps: 7, maxFrames: 20 },
        projects: {},
      },
      configPath
    );
    upsertProject('fresh', { key: 'FR', outputDir: '/tmp/fr' }, configPath);
    upsertProject('fresh', { key: 'FR2' }, configPath);

    const raw = readConfig(configPath);
    expect(raw.orgs?.fresh.base_url).toBe('https://fresh.example');
    expect(raw.orgs?.fresh.video_frames?.fps).toBe(7);
    expect(raw.orgs?.fresh.projects?.FR.output_dir).toBe('/tmp/fr');
    expect(raw.orgs?.fresh.projects?.FR2).toBeDefined();
  });

  it('upsertProject errors if org missing', () => {
    expect(() => upsertProject('nope', { key: 'X' }, configPath)).toThrow(/not found/);
  });
});

describe('export field config', () => {
  it('parses export.fields and export.custom_fields from TOML', async () => {
    writeFileSync(
      configPath,
      `[orgs.acme]
base_url = "https://acme.atlassian.net"
user_email = "u@x.example"

[orgs.acme.projects.PROJ]

[orgs.acme.export.fields]
preset = "default"
include = ["sprint", "storyPoints"]
exclude = ["creator"]

[orgs.acme.export.custom_fields.severity]
id = "customfield_12345"
type = "select"

[orgs.acme.export.custom_fields.team]
id = "customfield_67890"
type = "scalar"
`
    );
    const r = await loadProfile({ org: 'acme', project: 'PROJ', configPath });
    expect(r.org.export?.fieldSelector?.preset).toBe('default');
    expect(r.org.export?.fieldSelector?.include).toEqual(['sprint', 'storyPoints']);
    expect(r.org.export?.fieldSelector?.exclude).toEqual(['creator']);
    expect(r.org.export?.customFieldDefs?.severity).toEqual({
      id: 'customfield_12345',
      type: 'select',
    });
    expect(r.org.export?.customFieldDefs?.team).toEqual({
      id: 'customfield_67890',
      type: 'scalar',
    });
  });

  it('rejects an invalid custom_fields.type', () => {
    writeFileSync(
      configPath,
      `[orgs.acme]
base_url = "https://acme.atlassian.net"
user_email = "u@x.example"

[orgs.acme.export.custom_fields.severity]
id = "customfield_12345"
type = "nope"
`
    );
    expect(() => readConfig(configPath)).toThrow(/custom_fields\.severity\.type/);
  });

  it('round-trips an org with export config through upsertOrg', () => {
    upsertOrg(
      {
        name: 'acme',
        baseUrl: 'https://acme.example',
        userEmail: 'u@x.example',
        export: {
          fieldSelector: { preset: 'all', include: ['sprint'], exclude: ['creator'] },
          customFieldDefs: {
            severity: { id: 'customfield_12345', type: 'select' },
          },
        },
        projects: {},
      },
      configPath
    );
    const raw = readConfig(configPath);
    expect(raw.orgs?.acme.export?.fields?.preset).toBe('all');
    expect(raw.orgs?.acme.export?.fields?.include).toEqual(['sprint']);
    expect(raw.orgs?.acme.export?.custom_fields?.severity).toEqual({
      id: 'customfield_12345',
      type: 'select',
    });
  });
});

describe('findOrgsByProjectKey', () => {
  it('returns empty when no match', () => {
    writeFileSync(configPath, SAMPLE_CONFIG);
    expect(findOrgsByProjectKey('NOPE', readConfig(configPath))).toEqual([]);
  });

  it('returns the single org when only one matches', () => {
    writeFileSync(configPath, SAMPLE_CONFIG);
    expect(findOrgsByProjectKey('WID', readConfig(configPath))).toEqual(['widgets']);
  });

  it('returns multiple orgs when several share the project key', () => {
    writeFileSync(
      configPath,
      `${SAMPLE_CONFIG}\n[orgs.widgets.projects.PROJ]\noutput_dir = "~/jira/widgets/proj"\n`
    );
    const matches = findOrgsByProjectKey('PROJ', readConfig(configPath));
    expect(matches.sort()).toEqual(['acme', 'widgets']);
  });
});

describe('config validation (Zod)', () => {
  it('rejects missing base_url with field path', () => {
    writeFileSync(
      configPath,
      `[orgs.acme]\nuser_email = "u@x.example"\n`
    );
    expect(() => readConfig(configPath)).toThrow(/orgs\.acme\.base_url/);
  });

  it('rejects wrong type for video_frames.fps', () => {
    writeFileSync(
      configPath,
      `[orgs.acme]\nbase_url = "https://x.example"\nuser_email = "u@x.example"\n[orgs.acme.video_frames]\nfps = "five"\n`
    );
    expect(() => readConfig(configPath)).toThrow(/orgs\.acme\.video_frames\.fps/);
  });

  it('rejects unknown keys at the org level', () => {
    writeFileSync(
      configPath,
      `[orgs.acme]\nbase_url = "https://x.example"\nuser_email = "u@x.example"\nbasee_url = "typo"\n`
    );
    expect(() => readConfig(configPath)).toThrow(/orgs\.acme/);
  });

  it('accepts an empty file', () => {
    writeFileSync(configPath, '');
    expect(() => readConfig(configPath)).not.toThrow();
    expect(readConfig(configPath)).toEqual({});
  });
});
