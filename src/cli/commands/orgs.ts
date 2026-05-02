import { confirm, isCancel, cancel } from '@clack/prompts';
import {
  readConfig,
  resolveConfigPath,
  removeOrg,
  removeProject,
  listOrgs,
} from '../../lib/config.js';
import { hasStoredToken, removeToken } from '../../lib/credentials.js';

export async function runOrgsList(): Promise<void> {
  const path = resolveConfigPath();
  const raw = readConfig(path);
  const orgs = raw.orgs ?? {};
  const names = Object.keys(orgs);

  if (names.length === 0) {
    console.log(`No organizations configured.\nConfig path: ${path}\nRun \`jirallm init\` to create one.`);
    return;
  }

  console.log(`Config: ${path}\n`);
  for (const name of names) {
    const tokenStatus = (await hasStoredToken(name)) ? 'token: stored' : 'token: missing';
    const o = orgs[name];
    console.log(`  ${name}  (${tokenStatus})  ${o.base_url ?? ''}`);
    const projects = o.projects ?? {};
    const projectKeys = Object.keys(projects);
    if (projectKeys.length === 0) {
      console.log('     (no projects)');
      continue;
    }
    for (const key of projectKeys) {
      const outputDir = projects[key].output_dir ? ` → ${projects[key].output_dir}` : '';
      console.log(`       ${key}${outputDir}`);
    }
  }
}

function ensureOrgExists(orgName: string): void {
  const orgs = listOrgs();
  if (!orgs.includes(orgName)) {
    console.error(
      `Organization "${orgName}" not found. Existing orgs: ${orgs.join(', ') || '(none)'}`
    );
    process.exit(1);
  }
}

export async function runOrgsRemove(orgName: string, opts: { yes?: boolean } = {}): Promise<void> {
  ensureOrgExists(orgName);

  if (!opts.yes) {
    const ok = await confirm({
      message: `Remove organization "${orgName}" and all its projects?\n\x1b[2mAlso removes the stored API token for this org from the keychain.\x1b[22m`,
      initialValue: false,
    });
    if (isCancel(ok) || ok !== true) {
      cancel('Cancelled.');
      return;
    }
  }

  const result = removeOrg(orgName);
  if (!result.removed) {
    console.log(`Organization "${orgName}" not found (nothing to remove).`);
    return;
  }

  try {
    await removeToken(orgName);
  } catch {
    // best-effort; keychain may be unavailable
  }

  console.log(`Removed organization "${orgName}".`);
}

export async function runProjectRemove(
  orgName: string,
  projectKey: string,
  opts: { yes?: boolean } = {}
): Promise<void> {
  ensureOrgExists(orgName);

  if (!opts.yes) {
    const ok = await confirm({
      message: `Remove project "${projectKey}" from org "${orgName}"?`,
      initialValue: false,
    });
    if (isCancel(ok) || ok !== true) {
      cancel('Cancelled.');
      return;
    }
  }

  const result = removeProject(orgName, projectKey);
  if (!result.removed) {
    console.log(`Project "${projectKey}" not found in org "${orgName}" (nothing to remove).`);
    return;
  }

  console.log(`Removed project "${projectKey}" from "${orgName}".`);
}
