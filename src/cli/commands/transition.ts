import { loadProfile, findOrgsByProjectKey } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { parseIssueKey } from '../issueKey.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type TransitionOptions = {
  to: string;
  org?: string;
  list?: boolean;
  json?: boolean;
};

function resolveOrg(parsedOrg: string | undefined, flagOrg: string | undefined, projectKey: string): string {
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

export async function runTransition(issueKeyArg: string, opts: TransitionOptions): Promise<void> {
  const parsed = parseIssueKey(issueKeyArg);
  const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);
  const profile = await loadProfile({ org, project: parsed.projectKey });
  const client = new JiraClient(profile.config, profile.apiToken);

  if (opts.list) {
    const transitions = await client.getIssueTransitions(parsed.key);
    if (shouldOutputJson(opts)) {
      printJson({ issueKey: parsed.key, transitions });
      return;
    }
    if (transitions.length === 0) {
      console.log(`No transitions available on ${parsed.key}.`);
      return;
    }
    console.log(`Available transitions on ${parsed.key}:`);
    for (const t of transitions) {
      console.log(`  "${t.name}" → "${t.to.name}" (id=${t.id})`);
    }
    return;
  }

  const result = await client.transitionIssue(parsed.key, opts.to);
  if (shouldOutputJson(opts)) {
    printJson({ issueKey: parsed.key, transition: result, to: opts.to });
    return;
  }
  console.log(`✓ ${parsed.key} transitioned via "${result.name}" → "${opts.to}"`);
}
