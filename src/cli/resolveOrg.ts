import { select, isCancel, cancel } from '@clack/prompts';
import { findOrgsByProjectKey, readConfig } from '../lib/config.js';

export function resolveOrg(
  parsedOrg: string | undefined,
  flagOrg: string | undefined,
  projectKey: string
): string {
  if (flagOrg) return flagOrg;
  if (parsedOrg) return parsedOrg;
  const matches = findOrgsByProjectKey(projectKey);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw new Error(`Project "${projectKey}" not found in any configured org. Pass --org.`);
  }
  throw new Error(
    `Project "${projectKey}" exists in multiple orgs (${matches.join(', ')}). Pass --org.`
  );
}

async function pickOrgInteractively(candidates: string[], projectKey: string): Promise<string> {
  const raw = readConfig();
  const choice = await select({
    message: `Multiple orgs have a "${projectKey}" project. Which one?`,
    options: candidates.map((name) => ({
      value: name,
      label: name,
      hint: raw.orgs?.[name]?.base_url,
    })),
  });
  if (isCancel(choice)) {
    cancel('Cancelled.');
    process.exit(0);
  }
  return choice as string;
}

export async function resolveOrgInteractive(
  parsedOrg: string | undefined,
  flagOrg: string | undefined,
  projectKey: string
): Promise<string> {
  if (flagOrg) return flagOrg;
  if (parsedOrg) return parsedOrg;

  const matches = findOrgsByProjectKey(projectKey);
  if (matches.length === 0) {
    throw new Error(
      `Project "${projectKey}" not found in any configured org. ` +
        'Run `jirallm init` to add it, or pass --org explicitly.'
    );
  }
  if (matches.length === 1) return matches[0];

  if (!process.stdin.isTTY) {
    throw new Error(
      `Project "${projectKey}" exists in multiple orgs (${matches.join(', ')}). ` +
        `Pass --org or use the org/${projectKey}-N syntax.`
    );
  }
  return pickOrgInteractively(matches, projectKey);
}
