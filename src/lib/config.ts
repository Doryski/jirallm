import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import TOML from '@iarna/toml';
import type { JiraConfig } from './jiraClient.js';
import { getToken } from './credentials.js';
import { parseConfig, type RawConfig, type RawOrg, type RawProject } from './configSchema.js';
import type { CustomFieldDefs, FieldSelector } from './exportFields.js';

export type VideoFramesConfig = {
  enabled?: boolean;
  fps?: number;
  quality?: number;
  maxFrames?: number;
};

export type Project = {
  key: string;
  outputDir?: string;
};

export type ExportConfig = {
  fieldSelector?: FieldSelector;
  customFieldDefs?: CustomFieldDefs;
};

export type Organization = {
  name: string;
  baseUrl: string;
  userEmail: string;
  includeSubtasks?: boolean;
  videoFrames?: VideoFramesConfig;
  export?: ExportConfig;
  projects: Record<string, Project>;
};

export type ResolvedProfile = {
  config: JiraConfig;
  org: Organization;
  project: Project;
  apiToken: string;
};

export type OrgProfile = {
  config: JiraConfig;
  org: Organization;
  apiToken: string;
};

export type LoadProfileOptions = {
  org?: string;
  project?: string;
  configPath?: string;
};

export function resolveConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, 'jirallm', 'config.toml');
  return join(homedir(), '.config', 'jirallm', 'config.toml');
}

function expandTilde(value: string | undefined): string | undefined {
  if (!value) return value;
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return value;
}

export function readConfig(path: string = resolveConfigPath()): RawConfig {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf-8');
  const parsed = TOML.parse(raw);
  return parseConfig(parsed, path);
}

export function writeConfig(config: RawConfig, path: string = resolveConfigPath()): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, TOML.stringify(config as unknown as TOML.JsonMap), 'utf-8');
}

function buildOrg(name: string, raw: RawConfig): Organization {
  const orgs = raw.orgs ?? {};
  const r = orgs[name];
  if (!r) {
    const known = Object.keys(orgs).join(', ') || '(none)';
    throw new Error(`Organization "${name}" not found in config. Known orgs: ${known}`);
  }

  const projects: Record<string, Project> = {};
  for (const [key, p] of Object.entries(r.projects ?? {})) {
    projects[key] = { key, outputDir: expandTilde(p.output_dir) };
  }

  return {
    name,
    baseUrl: r.base_url,
    userEmail: r.user_email,
    includeSubtasks: r.include_subtasks,
    videoFrames: r.video_frames
      ? {
          enabled: r.video_frames.enabled,
          fps: r.video_frames.fps,
          quality: r.video_frames.quality,
          maxFrames: r.video_frames.max_frames,
        }
      : undefined,
    export: r.export
      ? {
          fieldSelector: r.export.fields
            ? {
                preset: r.export.fields.preset,
                include: r.export.fields.include,
                exclude: r.export.fields.exclude,
              }
            : undefined,
          customFieldDefs: r.export.custom_fields,
        }
      : undefined,
    projects,
  };
}

function pickProject(org: Organization, projectKey?: string): Project {
  if (!projectKey) {
    const keys = Object.keys(org.projects);
    if (keys.length === 1) return org.projects[keys[0]];
    throw new Error(
      `No project specified for org "${org.name}". Pass --project. Available projects: ${keys.join(', ') || '(none)'}`
    );
  }
  const project = org.projects[projectKey];
  if (!project) {
    const keys = Object.keys(org.projects).join(', ') || '(none)';
    throw new Error(
      `Project "${projectKey}" not found in org "${org.name}". Available projects: ${keys}`
    );
  }
  return project;
}

export function resolveOptionalProjectKey(
  org: Organization,
  projectKey?: string
): string | undefined {
  if (projectKey) return pickProject(org, projectKey).key;
  const keys = Object.keys(org.projects);
  if (keys.length === 1) return keys[0];
  return undefined;
}

export function listOrgs(raw: RawConfig = readConfig()): string[] {
  return Object.keys(raw.orgs ?? {});
}

export function findOrgsByProjectKey(
  projectKey: string,
  raw: RawConfig = readConfig()
): string[] {
  const matches: string[] = [];
  for (const [name, org] of Object.entries(raw.orgs ?? {})) {
    if (org.projects && projectKey in org.projects) matches.push(name);
  }
  return matches;
}

export async function loadOrgProfile(
  opts: { org?: string; configPath?: string } = {}
): Promise<OrgProfile> {
  const path = opts.configPath ?? resolveConfigPath();
  const raw = readConfig(path);

  const orgName = opts.org;
  if (!orgName) {
    throw new Error(
      'No --org provided and the issue key prefix did not match a configured project. ' +
        'Pass --org or run `jirallm init`.'
    );
  }

  const org = buildOrg(orgName, raw);
  const apiToken = await getToken(orgName);
  if (!apiToken) {
    throw new Error(
      `No API token found for org "${orgName}". Run \`jirallm auth set --org ${orgName}\`.`
    );
  }
  return {
    org,
    apiToken,
    config: {
      baseUrl: org.baseUrl,
      userEmail: org.userEmail,
    },
  };
}

export async function loadProfile(opts: LoadProfileOptions = {}): Promise<ResolvedProfile> {
  const { org, apiToken } = await loadOrgProfile({
    org: opts.org,
    configPath: opts.configPath,
  });
  const project = pickProject(org, opts.project);
  return {
    org,
    project,
    apiToken,
    config: {
      baseUrl: org.baseUrl,
      userEmail: org.userEmail,
      projectKey: project.key,
    },
  };
}

function orgToRaw(org: Organization): RawOrg {
  const raw: RawOrg = {
    base_url: org.baseUrl,
    user_email: org.userEmail,
  };
  if (org.includeSubtasks !== undefined) raw.include_subtasks = org.includeSubtasks;
  if (org.videoFrames) {
    raw.video_frames = {
      enabled: org.videoFrames.enabled,
      fps: org.videoFrames.fps,
      quality: org.videoFrames.quality,
      max_frames: org.videoFrames.maxFrames,
    };
  }
  if (org.export) {
    raw.export = {};
    if (org.export.fieldSelector) {
      raw.export.fields = {
        preset: org.export.fieldSelector.preset,
        include: org.export.fieldSelector.include,
        exclude: org.export.fieldSelector.exclude,
      };
    }
    if (org.export.customFieldDefs) {
      raw.export.custom_fields = org.export.customFieldDefs;
    }
  }
  const projects: Record<string, RawProject> = {};
  for (const [key, p] of Object.entries(org.projects)) {
    const rp: RawProject = {};
    if (p.outputDir) rp.output_dir = p.outputDir;
    projects[key] = rp;
  }
  raw.projects = projects;
  return raw;
}

export function upsertOrg(
  org: Organization,
  configPath: string = resolveConfigPath()
): void {
  const raw = readConfig(configPath);
  raw.orgs = raw.orgs ?? {};
  raw.orgs[org.name] = orgToRaw(org);
  writeConfig(raw, configPath);
}

export function upsertProject(
  orgName: string,
  project: Project,
  configPath: string = resolveConfigPath()
): void {
  const raw = readConfig(configPath);
  if (!raw.orgs?.[orgName]) {
    throw new Error(`Organization "${orgName}" not found. Create it first via \`jirallm init\`.`);
  }
  const orgRaw = raw.orgs[orgName];
  orgRaw.projects = orgRaw.projects ?? {};
  const rp: RawProject = {};
  if (project.outputDir) rp.output_dir = project.outputDir;
  orgRaw.projects[project.key] = rp;
  writeConfig(raw, configPath);
}

export type RemoveOrgResult = { removed: boolean };

export function removeOrg(
  name: string,
  configPath: string = resolveConfigPath()
): RemoveOrgResult {
  const raw = readConfig(configPath);
  if (!raw.orgs?.[name]) return { removed: false };
  delete raw.orgs[name];
  writeConfig(raw, configPath);
  return { removed: true };
}

export type RemoveProjectResult = { removed: boolean };

export function removeProject(
  orgName: string,
  projectKey: string,
  configPath: string = resolveConfigPath()
): RemoveProjectResult {
  const raw = readConfig(configPath);
  const orgRaw = raw.orgs?.[orgName];
  if (!orgRaw) return { removed: false };
  if (!orgRaw.projects?.[projectKey]) return { removed: false };
  delete orgRaw.projects[projectKey];
  writeConfig(raw, configPath);
  return { removed: true };
}
