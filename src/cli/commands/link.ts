import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { parseIssueKey } from '../issueKey.js';
import { resolveOrg } from '../resolveOrg.js';
import { printJson, shouldOutputJson } from '../jsonOutput.js';

export type LinkOptions = {
  inwardKey: string;
  outwardKey: string;
  type: string;
  comment?: string;
  org?: string;
  dryRun?: boolean;
  json?: boolean;
};

export async function runLink(opts: LinkOptions): Promise<void> {
  const inward = parseIssueKey(opts.inwardKey);
  const outward = parseIssueKey(opts.outwardKey);
  const org = resolveOrg(inward.org ?? outward.org, opts.org, inward.projectKey);
  const profile = await loadProfile({ org, project: inward.projectKey });

  if (opts.dryRun) {
    const payload = {
      dryRun: true,
      type: opts.type,
      inwardIssue: inward.key,
      outwardIssue: outward.key,
      comment: opts.comment,
    };
    if (shouldOutputJson(opts)) printJson(payload);
    else console.log(`Dry run — would link ${inward.key} -[${opts.type}]-> ${outward.key}`);
    return;
  }

  const client = new JiraClient(profile.config, profile.apiToken);
  await client.linkIssues(inward.key, outward.key, opts.type, opts.comment);

  if (shouldOutputJson(opts)) {
    printJson({ inwardIssue: inward.key, outwardIssue: outward.key, type: opts.type });
    return;
  }
  console.log(`✓ Linked ${inward.key} -[${opts.type}]-> ${outward.key}`);
}

export type LinkRemoveOptions = {
  linkId: string;
  org: string;
  dryRun?: boolean;
  json?: boolean;
};

export async function runLinkRemove(opts: LinkRemoveOptions): Promise<void> {
  if (opts.dryRun) {
    const payload = { dryRun: true, linkId: opts.linkId };
    if (shouldOutputJson(opts)) printJson(payload);
    else console.log(`Dry run — would remove link ${opts.linkId}`);
    return;
  }
  const profile = await loadProfile({ org: opts.org });
  const client = new JiraClient(profile.config, profile.apiToken);
  await client.removeIssueLink(opts.linkId);
  if (shouldOutputJson(opts)) {
    printJson({ linkId: opts.linkId, removed: true });
    return;
  }
  console.log(`✓ Removed link ${opts.linkId}`);
}
