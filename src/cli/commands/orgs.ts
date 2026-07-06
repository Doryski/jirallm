import {
  readConfig,
  resolveConfigPath,
  removeOrg,
  removeProject,
  listOrgs,
} from '../../lib/config.js';
import { hasStoredToken, removeToken } from '../../lib/credentials.js';
import { confirmOrAbort, typedNameConfirm } from '../confirm.js';
import { resolveOrg } from '../resolveOrg.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

type OrgsListOptions = { json?: boolean };
type OrgsRemoveOptions = { yes?: boolean; dryRun?: boolean };
type ProjectRemoveOptions = { yes?: boolean; dryRun?: boolean };

export async function runOrgsList(opts: OrgsListOptions = {}): Promise<void> {
  const path = resolveConfigPath();
  const raw = readConfig(path);
  const orgs = raw.orgs ?? {};
  const names = Object.keys(orgs);

  const summary = await Promise.all(
    names.map(async (name) => {
      const o = orgs[name];
      const projects = Object.entries(o.projects ?? {}).map(([key, p]) => ({
        key,
        outputDir: p.output_dir,
      }));
      return {
        name,
        baseUrl: o.base_url,
        tokenStored: await hasStoredToken(name),
        projects,
      };
    })
  );

  if (shouldOutputJson(opts)) {
    printJson({ configPath: path, orgs: summary });
    return;
  }

  if (names.length === 0) {
    console.log(
      `No organizations configured.\nConfig path: ${path}\nRun \`jirallm init\` to create one.`
    );
    return;
  }

  console.log(`Config: ${path}\n`);
  for (const org of summary) {
    const tokenStatus = org.tokenStored ? 'token: stored' : 'token: missing';
    console.log(`  ${org.name}  (${tokenStatus})  ${org.baseUrl ?? ''}`);
    if (org.projects.length === 0) {
      console.log('     (no projects)');
      continue;
    }
    for (const p of org.projects) {
      const outputDir = p.outputDir ? ` → ${p.outputDir}` : '';
      console.log(`       ${p.key}${outputDir}`);
    }
  }
}

function ensureOrgExists(orgName: string): void {
  const orgs = listOrgs();
  if (orgs.includes(orgName)) return;
  console.error(
    `Organization "${orgName}" not found. Existing orgs: ${orgs.join(', ') || '(none)'}`
  );
  process.exit(1);
}

function projectKeysOf(orgName: string): string[] {
  const raw = readConfig();
  return Object.keys(raw.orgs?.[orgName]?.projects ?? {});
}

export async function runOrgsRemove(
  orgName: string,
  opts: OrgsRemoveOptions = {}
): Promise<void> {
  ensureOrgExists(orgName);

  const projectKeys = projectKeysOf(orgName);

  if (opts.dryRun) {
    console.log(`[dry-run] Would remove organization "${orgName}".`);
    if (projectKeys.length > 0) {
      console.log(
        `[dry-run] Would remove ${projectKeys.length} project(s): ${projectKeys.join(', ')}.`
      );
    }
    console.log(
      `[dry-run] Would remove the stored API token for "${orgName}" from the keychain.`
    );
    return;
  }

  const confirmed = await confirmRemoveOrg(orgName, projectKeys, opts.yes);
  if (!confirmed) {
    console.log('Cancelled.');
    return;
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

async function confirmRemoveOrg(
  orgName: string,
  projectKeys: string[],
  yes?: boolean
): Promise<boolean> {
  if (projectKeys.length === 0) {
    return confirmOrAbort(
      `Remove organization "${orgName}"? Also removes the stored API token from the keychain.`,
      { yes }
    );
  }
  console.log(
    `Organization "${orgName}" still owns ${projectKeys.length} project(s): ${projectKeys.join(', ')}.`
  );
  return typedNameConfirm(orgName, { yes });
}

export async function runProjectRemove(
  orgName: string | undefined,
  projectKey: string,
  opts: ProjectRemoveOptions = {}
): Promise<void> {
  const resolvedOrg = resolveOrg(undefined, orgName, projectKey);
  ensureOrgExists(resolvedOrg);

  if (opts.dryRun) {
    console.log(`[dry-run] Would remove project "${projectKey}" from org "${resolvedOrg}".`);
    return;
  }

  const confirmed = await confirmOrAbort(
    `Remove project "${projectKey}" from org "${resolvedOrg}"?`,
    { yes: opts.yes }
  );
  if (!confirmed) {
    console.log('Cancelled.');
    return;
  }

  const result = removeProject(resolvedOrg, projectKey);
  if (!result.removed) {
    console.log(`Project "${projectKey}" not found in org "${resolvedOrg}" (nothing to remove).`);
    return;
  }

  console.log(`Removed project "${projectKey}" from "${resolvedOrg}".`);
}
