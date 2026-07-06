import { parseIssueKey } from '../cli/issueKey.js';

export type WorklogVisibility = {
  type: 'group' | 'role';
  value: string;
};

export type WorklogInput = {
  issueKey: string;
  startTime?: string;
  endTime?: string;
  duration?: string | number;
  description?: string;
  org?: string;
  visibility?: WorklogVisibility;
};

export type ValidatedWorklog = {
  index: number;
  issueKey: string;
  projectKey: string;
  org?: string;
  started: Date;
  durationSeconds: number;
  description?: string;
  visibility?: WorklogVisibility;
};

export type ValidationError = {
  index: number;
  message: string;
};

const ISO_DURATION_RE = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;
const JIRA_DURATION_RE = /^(?:(\d+)w)?\s*(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?$/;
const SECONDS_PER_UNIT = { w: 604800, d: 86400, h: 3600, m: 60, s: 1 } as const;

export function parseDuration(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) {
      throw new Error(`Invalid numeric duration: ${input}`);
    }
    return Math.round(input);
  }
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Empty duration');

  if (/^\d+$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    if (n <= 0) throw new Error(`Invalid numeric duration: ${n}`);
    return n;
  }

  const isoMatch = trimmed.match(ISO_DURATION_RE);
  if (isoMatch) {
    const [, h, m, s] = isoMatch;
    const total = (parseInt(h ?? '0', 10) * 3600) + (parseInt(m ?? '0', 10) * 60) + parseInt(s ?? '0', 10);
    if (total <= 0) throw new Error(`Invalid ISO duration: ${trimmed}`);
    return total;
  }

  const jiraMatch = trimmed.match(JIRA_DURATION_RE);
  if (jiraMatch && jiraMatch.slice(1).some(Boolean)) {
    const [, w, d, h, m, s] = jiraMatch;
    const total =
      parseInt(w ?? '0', 10) * SECONDS_PER_UNIT.w +
      parseInt(d ?? '0', 10) * SECONDS_PER_UNIT.d +
      parseInt(h ?? '0', 10) * SECONDS_PER_UNIT.h +
      parseInt(m ?? '0', 10) * SECONDS_PER_UNIT.m +
      parseInt(s ?? '0', 10) * SECONDS_PER_UNIT.s;
    if (total <= 0) throw new Error(`Invalid duration: ${trimmed}`);
    return total;
  }

  throw new Error(`Unrecognized duration format: "${trimmed}". Use seconds, "1h 30m", or "PT1H30M".`);
}

function parseDate(input: string, fieldName: string): Date {
  const d = new Date(input);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid ${fieldName}: "${input}" (must be ISO 8601)`);
  }
  return d;
}

export function formatStartedForJira(d: Date): string {
  // Jira requires: yyyy-MM-ddTHH:mm:ss.SSSZZ where ZZ is +HHmm (no colon)
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hour = pad(d.getHours());
  const min = pad(d.getMinutes());
  const sec = pad(d.getSeconds());
  const ms = pad(d.getMilliseconds(), 3);
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const absOff = Math.abs(offsetMin);
  const offH = pad(Math.floor(absOff / 60));
  const offM = pad(absOff % 60);
  return `${year}-${month}-${day}T${hour}:${min}:${sec}.${ms}${sign}${offH}${offM}`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateWorklog(entry: unknown, index: number): ValidatedWorklog {
  if (!isObject(entry)) {
    throw new Error(`entry must be an object`);
  }

  const issueKeyRaw = entry.issueKey;
  if (typeof issueKeyRaw !== 'string' || !issueKeyRaw) {
    throw new Error(`missing or invalid "issueKey"`);
  }
  const parsed = parseIssueKey(issueKeyRaw);

  const hasStart = entry.startTime !== undefined && entry.startTime !== null;
  const hasEnd = entry.endTime !== undefined && entry.endTime !== null;
  const hasDur = entry.duration !== undefined && entry.duration !== null;
  const durationOnly = hasDur && !hasStart && !hasEnd;
  const present = [hasStart, hasEnd, hasDur].filter(Boolean).length;
  if (present < 2 && !durationOnly) {
    throw new Error(
      `at least 2 of startTime/endTime/duration are required (got ${present})`
    );
  }

  let started: Date;
  let durationSeconds: number;
  let end: Date | undefined;

  if (hasStart) {
    if (typeof entry.startTime !== 'string') throw new Error(`"startTime" must be a string`);
    started = parseDate(entry.startTime, 'startTime');
  } else {
    started = durationOnly ? new Date() : new Date(0);
  }
  if (hasEnd) {
    if (typeof entry.endTime !== 'string') throw new Error(`"endTime" must be a string`);
    end = parseDate(entry.endTime, 'endTime');
  }
  if (hasDur) {
    if (typeof entry.duration !== 'string' && typeof entry.duration !== 'number') {
      throw new Error(`"duration" must be a string or number`);
    }
    durationSeconds = parseDuration(entry.duration);
  } else {
    durationSeconds = 0;
  }

  if (hasStart && hasEnd && hasDur) {
    const computed = Math.round((end!.getTime() - started.getTime()) / 1000);
    if (computed !== durationSeconds) {
      throw new Error(
        `inconsistent times: endTime - startTime = ${computed}s but duration = ${durationSeconds}s`
      );
    }
  } else if (hasStart && hasEnd) {
    durationSeconds = Math.round((end!.getTime() - started.getTime()) / 1000);
    if (durationSeconds <= 0) {
      throw new Error(`endTime must be after startTime`);
    }
  } else if (hasEnd && hasDur) {
    started = new Date(end!.getTime() - durationSeconds * 1000);
  }
  // (hasStart && hasDur) — started + durationSeconds already set

  if (durationSeconds <= 0) {
    throw new Error(`duration must be > 0`);
  }

  let description: string | undefined;
  if (entry.description !== undefined && entry.description !== null) {
    if (typeof entry.description !== 'string') {
      throw new Error(`"description" must be a string`);
    }
    description = entry.description;
  }

  let visibility: WorklogVisibility | undefined;
  if (entry.visibility !== undefined && entry.visibility !== null) {
    const v = entry.visibility;
    if (!isObject(v) || (v.type !== 'group' && v.type !== 'role') || typeof v.value !== 'string') {
      throw new Error(`"visibility" must be { type: "group"|"role", value: string }`);
    }
    visibility = { type: v.type, value: v.value };
  }

  let orgOverride: string | undefined;
  if (entry.org !== undefined && entry.org !== null) {
    if (typeof entry.org !== 'string') throw new Error(`"org" must be a string`);
    orgOverride = entry.org;
  }

  return {
    index,
    issueKey: parsed.key,
    projectKey: parsed.projectKey,
    org: orgOverride ?? parsed.org,
    started,
    durationSeconds,
    description,
    visibility,
  };
}

export function validateAll(entries: unknown[]): {
  valid: ValidatedWorklog[];
  errors: ValidationError[];
} {
  const valid: ValidatedWorklog[] = [];
  const errors: ValidationError[] = [];
  for (let i = 0; i < entries.length; i++) {
    try {
      valid.push(validateWorklog(entries[i], i));
    } catch (err) {
      errors.push({ index: i, message: (err as Error).message });
    }
  }
  return { valid, errors };
}

export function formatDurationHuman(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}
