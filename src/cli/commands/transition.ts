import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { resolveOrg } from '../resolveOrg.js';
import { parseIssueKey } from '../issueKey.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type TransitionOptions = {
  to: string;
  org?: string;
  list?: boolean;
  dryRun?: boolean;
  json?: boolean;
};

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

  const result = await client.transitionIssue(parsed.key, opts.to, { dryRun: opts.dryRun });
  if (shouldOutputJson(opts)) {
    printJson({
      issueKey: parsed.key,
      transition: result,
      to: opts.to,
      ...(opts.dryRun ? { dryRun: true } : {}),
    });
    return;
  }
  if (opts.dryRun) {
    console.log(`[dry-run] ${parsed.key} would transition via "${result.name}" → "${opts.to}"`);
    return;
  }
  console.log(`✓ ${parsed.key} transitioned via "${result.name}" → "${opts.to}"`);
}
