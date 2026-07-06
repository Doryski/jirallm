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
  json?: boolean;
  issueKey?: string;
  duration?: string;
};

type Resolved = ValidatedWorklog & { resolvedOrg: string };

function readEntries(opts: WorklogOptions): unknown[] {
  if (opts.issueKey && opts.duration) {
    return [{ issueKey: opts.issueKey, duration: opts.duration }];
  }
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
  return parsed;
}

export async function runWorklog(opts: WorklogOptions): Promise<void> {
  const json = opts.json ?? false;
  const parsed = readEntries(opts);

  if (!json) {
    console.log(`Validating ${parsed.length} worklog entr${parsed.length === 1 ? 'y' : 'ies'}...`);
  }
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
    if (json) {
      console.log(
        JSON.stringify(
          { ok: false, errors: errors.sort((a, b) => a.index - b.index) },
          null,
          2
        )
      );
    } else {
      console.error(`Validation failed for ${errors.length} entr${errors.length === 1 ? 'y' : 'ies'}:`);
      for (const e of errors.sort((a, b) => a.index - b.index)) {
        console.error(`  [${e.index}] ${e.message}`);
      }
    }
    throw new Error('Aborting — fix validation errors and retry.');
  }

  if (!json) {
    console.log(`  ✓ ${resolved.length}/${parsed.length} valid`);
    console.log('');
    console.log(`Posting ${resolved.length} worklog(s)...`);
  }

  const clientCache = new Map<string, JiraClient>();
  const getClient = async (org: string, projectKey: string): Promise<JiraClient> => {
    const cached = clientCache.get(org);
    if (cached) return cached;
    const profile = await loadProfile({ org, project: projectKey });
    const client = new JiraClient(profile.config, profile.apiToken);
    clientCache.set(org, client);
    return client;
  };

  type JsonEntry = {
    index: number;
    org: string;
    issueKey: string;
    durationSeconds: number;
    started: string;
    comment?: string;
    ok?: boolean;
    id?: string;
    error?: string;
  };
  const jsonEntries: JsonEntry[] = [];
  let okCount = 0;
  let failCount = 0;

  for (const entry of resolved.sort((a, b) => a.index - b.index)) {
    const started = formatStartedForJira(entry.started);
    const commentBody = entry.description
      ? opts.noWiki
        ? entry.description
        : markdownToWiki(entry.description)
      : undefined;
    const human = formatDurationHuman(entry.durationSeconds);
    const base: JsonEntry = {
      index: entry.index,
      org: entry.resolvedOrg,
      issueKey: entry.issueKey,
      durationSeconds: entry.durationSeconds,
      started,
      comment: commentBody,
    };

    if (opts.dryRun) {
      jsonEntries.push(base);
      if (!json) {
        console.log(
          `  • [${entry.index}] ${entry.resolvedOrg}/${entry.issueKey}  ${human}  started=${started}` +
            (commentBody ? `  comment="${commentBody.slice(0, 60).replace(/\n/g, ' ')}${commentBody.length > 60 ? '…' : ''}"` : '')
        );
      }
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
      okCount++;
      jsonEntries.push({ ...base, ok: true, id: res.id });
      if (!json) console.log(`  ✓ [${entry.index}] ${entry.issueKey}  ${human}  (id=${res.id})`);
    } catch (err) {
      const message = (err as Error).message;
      failCount++;
      jsonEntries.push({ ...base, ok: false, error: message });
      if (!json) console.log(`  ✗ [${entry.index}] ${entry.issueKey}  ${human}  failed: ${message.split('\n')[0]}`);
    }
  }

  if (opts.dryRun) {
    if (json) {
      console.log(JSON.stringify({ ok: true, dryRun: true, worklogs: jsonEntries }, null, 2));
    } else {
      console.log('');
      console.log('(dry-run — no worklogs posted)');
    }
    return;
  }

  if (json) {
    console.log(
      JSON.stringify(
        { ok: failCount === 0, dryRun: false, worklogs: jsonEntries, summary: { posted: okCount, failed: failCount } },
        null,
        2
      )
    );
  } else {
    console.log('');
    console.log(`Summary: ${okCount} posted, ${failCount} failed.`);
  }
  if (failCount > 0) {
    process.exitCode = 1;
  }
}
