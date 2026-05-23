import { readFileSync } from 'fs';
import { loadProfile } from '../../lib/config.js';
import { JiraClient } from '../../lib/jiraClient.js';
import { markdownToWiki } from '../../lib/markdownToWiki.js';
import { resolveOrg } from '../resolveOrg.js';
import {
  validateAll,
  formatStartedForJira,
  formatDurationHuman,
  type ValidatedWorklog,
} from '../../lib/worklog.js';

export type WorklogOptions = {
  file?: string;
  org?: string;
  noWiki?: boolean;
  dryRun?: boolean;
};

type Resolved = ValidatedWorklog & { resolvedOrg: string };

export async function runWorklog(opts: WorklogOptions): Promise<void> {
  const raw = opts.file ? readFileSync(opts.file, 'utf-8') : readFileSync(0, 'utf-8');
  if (!raw.trim()) throw new Error('Empty input.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`, { cause: err });
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Input must be a JSON array of worklog entries.');
  }
  if (parsed.length === 0) {
    throw new Error('No worklog entries provided.');
  }

  console.log(`Validating ${parsed.length} worklog entr${parsed.length === 1 ? 'y' : 'ies'}...`);
  const { valid, errors } = validateAll(parsed);

  const resolved: Resolved[] = [];
  for (const v of valid) {
    try {
      const org = resolveOrg(v.org, opts.org, v.projectKey);
      resolved.push({ ...v, resolvedOrg: org });
    } catch (err) {
      errors.push({ index: v.index, message: (err as Error).message });
    }
  }

  if (errors.length > 0) {
    console.error(`Validation failed for ${errors.length} entr${errors.length === 1 ? 'y' : 'ies'}:`);
    for (const e of errors.sort((a, b) => a.index - b.index)) {
      console.error(`  [${e.index}] ${e.message}`);
    }
    throw new Error('Aborting — fix validation errors and retry.');
  }

  console.log(`  ✓ ${resolved.length}/${parsed.length} valid`);
  console.log('');
  console.log(`Posting ${resolved.length} worklog(s)...`);

  const clientCache = new Map<string, JiraClient>();
  const getClient = async (org: string, projectKey: string): Promise<JiraClient> => {
    const cached = clientCache.get(org);
    if (cached) return cached;
    const profile = await loadProfile({ org, project: projectKey });
    const client = new JiraClient(profile.config, profile.apiToken);
    clientCache.set(org, client);
    return client;
  };

  type Result = { entry: Resolved; ok: true; id: string } | { entry: Resolved; ok: false; error: string };
  const results: Result[] = [];

  for (const entry of resolved.sort((a, b) => a.index - b.index)) {
    const started = formatStartedForJira(entry.started);
    const commentBody = entry.description
      ? opts.noWiki
        ? entry.description
        : markdownToWiki(entry.description)
      : undefined;
    const human = formatDurationHuman(entry.durationSeconds);

    if (opts.dryRun) {
      console.log(
        `  • [${entry.index}] ${entry.resolvedOrg}/${entry.issueKey}  ${human}  started=${started}` +
          (commentBody ? `  comment="${commentBody.slice(0, 60).replace(/\n/g, ' ')}${commentBody.length > 60 ? '…' : ''}"` : '')
      );
      continue;
    }

    try {
      const client = await getClient(entry.resolvedOrg, entry.projectKey);
      const res = await client.addWorklog(entry.issueKey, {
        started,
        timeSpentSeconds: entry.durationSeconds,
        comment: commentBody,
        visibility: entry.visibility,
      });
      console.log(`  ✓ [${entry.index}] ${entry.issueKey}  ${human}  (id=${res.id})`);
      results.push({ entry, ok: true, id: res.id });
    } catch (err) {
      const message = (err as Error).message;
      console.log(`  ✗ [${entry.index}] ${entry.issueKey}  ${human}  failed: ${message.split('\n')[0]}`);
      results.push({ entry, ok: false, error: message });
    }
  }

  if (opts.dryRun) {
    console.log('');
    console.log('(dry-run — no worklogs posted)');
    return;
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  console.log('');
  console.log(`Summary: ${okCount} posted, ${failCount} failed.`);
  if (failCount > 0) {
    process.exitCode = 1;
  }
}
