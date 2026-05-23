import { findOrgsByProjectKey } from '../lib/config.js';

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
