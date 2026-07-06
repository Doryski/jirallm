import { intro, outro, password, confirm, isCancel, cancel } from '@clack/prompts';
import { setToken, removeToken, hasStoredToken, getTokenSource } from '../../lib/credentials.js';
import { listOrgs, readConfig } from '../../lib/config.js';

function ensureOrg(name: string): void {
  const orgs = listOrgs();
  if (!orgs.includes(name)) {
    console.error(
      `Organization "${name}" not found. Existing orgs: ${orgs.join(', ') || '(none)'}\nRun \`jirallm init\` first.`
    );
    process.exit(1);
  }
}

export async function runAuthSet(orgName: string): Promise<void> {
  ensureOrg(orgName);
  intro(`jirallm auth set --org ${orgName}`);

  const token = await password({
    message:
      'Jira API token\n\x1b[2mCreate one at https://id.atlassian.com/manage-profile/security/api-tokens. Stored in your OS keychain.\x1b[22m',
    validate: (v) => (v ? undefined : 'Required'),
  });
  if (isCancel(token)) {
    cancel('Cancelled.');
    process.exit(0);
  }

  await setToken(orgName, token);
  outro('Token stored in OS keychain.');
}

export async function runAuthRm(orgName: string, opts: { yes?: boolean } = {}): Promise<void> {
  ensureOrg(orgName);

  if (!(await hasStoredToken(orgName))) {
    console.log(`No stored token for "${orgName}" (nothing to remove).`);
    return;
  }

  if (!opts.yes) {
    const ok = await confirm({
      message: `Remove stored token for "${orgName}"?`,
      initialValue: false,
    });
    if (isCancel(ok) || ok !== true) {
      cancel('Cancelled.');
      return;
    }
  }

  const removed = await removeToken(orgName);
  if (removed) console.log(`Removed token for "${orgName}".`);
  else console.log(`No stored token for "${orgName}" (nothing to remove).`);
}

export async function runAuthList(): Promise<void> {
  const raw = readConfig();
  const orgs = Object.keys(raw.orgs ?? {});
  if (orgs.length === 0) {
    console.log('No organizations configured. Run `jirallm init`.');
    return;
  }

  for (const name of orgs) {
    const baseUrl = raw.orgs?.[name]?.base_url ?? '';
    const stored = await hasStoredToken(name);
    const tokenLabel = stored ? 'token: stored' : 'token: missing';
    console.log(`  ${name}  ${baseUrl}  ${tokenLabel}`);
  }
}

export async function runAuthStatus(orgName: string): Promise<void> {
  ensureOrg(orgName);
  const source = await getTokenSource(orgName);
  if (source === null) {
    console.error(
      `No token stored for "${orgName}". Run \`jirallm auth set --org ${orgName}\`.`
    );
    process.exit(1);
  }
  const detail = source === 'keychain' ? 'stored in OS keychain' : 'resolved from environment variable';
  console.log(`${orgName}: token ${detail}.`);
}
