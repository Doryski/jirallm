import { loadProfile } from '../../lib/config.js';
import {
  JiraClient,
  type IssueLinkSummary,
  type JiraIssueLinkType,
} from '../../lib/jiraClient.js';
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

type ResolvedLinkType = { name: string; swap: boolean };

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

function resolveLinkType(types: JiraIssueLinkType[], input: string): ResolvedLinkType | null {
  const target = normalizeLabel(input);
  const byName = types.find((t) => normalizeLabel(t.name) === target);
  if (byName) return { name: byName.name, swap: false };
  const byOutward = types.find((t) => normalizeLabel(t.outward) === target);
  if (byOutward) return { name: byOutward.name, swap: false };
  const byInward = types.find((t) => normalizeLabel(t.inward) === target);
  if (byInward) return { name: byInward.name, swap: true };
  return null;
}

function unknownLinkTypeError(types: JiraIssueLinkType[], input: string): Error {
  const names = types.map((t) => t.name).join(', ') || '(none)';
  return new Error(`Unknown link type "${input}". Valid types: ${names}.`);
}

export async function runLink(opts: LinkOptions): Promise<void> {
  const inwardParsed = parseIssueKey(opts.inwardKey);
  const outwardParsed = parseIssueKey(opts.outwardKey);
  const org = resolveOrg(inwardParsed.org ?? outwardParsed.org, opts.org, inwardParsed.projectKey);
  const profile = await loadProfile({ org, project: inwardParsed.projectKey });
  const client = new JiraClient(profile.config, profile.apiToken);

  const types = await client.listLinkTypes();
  const resolved = resolveLinkType(types, opts.type);
  if (!resolved) throw unknownLinkTypeError(types, opts.type);

  const inward = resolved.swap ? outwardParsed.key : inwardParsed.key;
  const outward = resolved.swap ? inwardParsed.key : outwardParsed.key;

  if (opts.dryRun) {
    const payload = {
      dryRun: true,
      type: resolved.name,
      inwardIssue: inward,
      outwardIssue: outward,
      comment: opts.comment,
    };
    if (shouldOutputJson(opts)) printJson(payload);
    else console.log(`Dry run — would link ${inward} -[${resolved.name}]-> ${outward}`);
    return;
  }

  await client.linkIssues(inward, outward, resolved.name, opts.comment);

  if (shouldOutputJson(opts)) {
    printJson({ inwardIssue: inward, outwardIssue: outward, type: resolved.name });
    return;
  }
  console.log(`✓ Linked ${inward} -[${resolved.name}]-> ${outward}`);
}

export type LinkRemoveOptions = {
  linkId: string;
  to?: string;
  org?: string;
  dryRun?: boolean;
  json?: boolean;
};

type LinkRecord = IssueLinkSummary & { id?: string };

function looksLikeIssueKey(input: string): boolean {
  try {
    parseIssueKey(input);
    return true;
  } catch {
    return false;
  }
}

async function removeByLinkId(opts: LinkRemoveOptions): Promise<void> {
  if (opts.dryRun) {
    const payload = { dryRun: true, linkId: opts.linkId };
    if (shouldOutputJson(opts)) printJson(payload);
    else console.log(`Dry run — would remove link ${opts.linkId}`);
    return;
  }
  if (!opts.org) throw new Error('Pass --org (-o) to remove a link by id.');
  const profile = await loadProfile({ org: opts.org });
  const client = new JiraClient(profile.config, profile.apiToken);
  await client.removeIssueLink(opts.linkId);
  if (shouldOutputJson(opts)) {
    printJson({ linkId: opts.linkId, removed: true });
    return;
  }
  console.log(`✓ Removed link ${opts.linkId}`);
}

function printLinkList(issueKey: string, links: LinkRecord[]): void {
  if (!links.length) {
    console.log(`No links on ${issueKey}.`);
    return;
  }
  console.log(`${links.length} link(s) on ${issueKey}:`);
  for (const link of links) {
    const title = link.title ? ` (${link.title})` : '';
    console.log(`  ${link.id ?? '?'}  ${link.type} → ${link.key}${title}`);
  }
}

async function removeByIssueKey(opts: LinkRemoveOptions): Promise<void> {
  const parsed = parseIssueKey(opts.linkId);
  const org = resolveOrg(parsed.org, opts.org, parsed.projectKey);
  const profile = await loadProfile({ org, project: parsed.projectKey });
  const client = new JiraClient(profile.config, profile.apiToken);
  const data = await client.fetchIssueDetails(parsed.key, {
    includeLinks: true,
    includeComments: false,
    includeChangelog: false,
  });
  const links: LinkRecord[] = data.issueLinks ?? [];

  if (!opts.to) {
    if (shouldOutputJson(opts)) printJson({ issueKey: parsed.key, links });
    else printLinkList(parsed.key, links);
    return;
  }

  const toKey = parseIssueKey(opts.to).key;
  const matches = links.filter((link) => link.key === toKey);
  if (matches.length === 0) {
    throw new Error(`No link from ${parsed.key} to ${toKey} found.`);
  }
  if (matches.length > 1) {
    const listed = matches.map((link) => `${link.id ?? '?'} (${link.type})`).join(', ');
    throw new Error(
      `Multiple links from ${parsed.key} to ${toKey}: ${listed}. Remove by id with \`link:rm <id> -o ${org}\`.`
    );
  }
  const match = matches[0];
  const linkId = match.id;
  if (!linkId) {
    throw new Error(`Could not determine link id for ${parsed.key} → ${toKey}.`);
  }

  if (opts.dryRun) {
    const payload = { dryRun: true, linkId, issueKey: parsed.key, to: toKey, type: match.type };
    if (shouldOutputJson(opts)) printJson(payload);
    else
      console.log(
        `Dry run — would remove link ${linkId} (${parsed.key} -[${match.type}]-> ${toKey})`
      );
    return;
  }

  await client.removeIssueLink(linkId);
  if (shouldOutputJson(opts)) {
    printJson({ linkId, removed: true });
    return;
  }
  console.log(`✓ Removed link ${linkId} (${parsed.key} → ${toKey})`);
}

export async function runLinkRemove(opts: LinkRemoveOptions): Promise<void> {
  if (looksLikeIssueKey(opts.linkId)) {
    await removeByIssueKey(opts);
    return;
  }
  await removeByLinkId(opts);
}
