import { randomBytes } from 'crypto';
import {
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
  type Stats,
} from 'fs';
import { dirname, isAbsolute, join, relative, sep } from 'path';
import { parseIssueKey } from '../cli/issueKey.js';
import { stripControlChars } from './untrusted.js';

const MAX_FILENAME_BYTES = 180;
const MAX_EXTENSION_LENGTH = 16;
const MAX_FALLBACK_ID_LENGTH = 32;
const TEMP_SUFFIX_BYTES = 8;
const FRAMES_SUFFIX = '-frames';
const PATH_SEPARATORS = /[/\\]/;
const INVALID_FILENAME_CHARS = /[<>:"|?*%]/g;
const TRAILING_DOTS_AND_SPACES = /[. ]+$/;
const UNSAFE_ID_CHARS = /[^A-Za-z0-9_-]/g;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;
const MISSING_ENTRY_CODES = ['ENOENT', 'ENOTDIR'] as const;

type AttachmentRef = { id: string; filename: string };

type SplitName = { stem: string; ext: string };

const byteLength = (value: string) => Buffer.byteLength(value, 'utf8');

const lastSegment = (name: string) => name.split(PATH_SEPARATORS).pop() ?? '';

const stripTrailingDotsAndSpaces = (name: string) => name.replace(TRAILING_DOTS_AND_SPACES, '');

const replaceInvalidChars = (name: string) => name.replace(INVALID_FILENAME_CHARS, '_');

const fallbackName = (id: unknown) => {
  const safeId = String(id ?? '')
    .replace(UNSAFE_ID_CHARS, '')
    .slice(0, MAX_FALLBACK_ID_LENGTH);
  return `attachment-${safeId || 'unknown'}`;
};

function splitExtension(name: string): SplitName {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || name.length - dot - 1 > MAX_EXTENSION_LENGTH) return { stem: name, ext: '' };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

function truncateToBytes(value: string, maxBytes: number): string {
  let out = '';
  for (const ch of value) {
    if (byteLength(out + ch) > maxBytes) return out;
    out += ch;
  }
  return out;
}

function capLength(name: string): string {
  if (byteLength(name) <= MAX_FILENAME_BYTES) return name;
  const { stem, ext } = splitExtension(name);
  const stemBudget = MAX_FILENAME_BYTES - byteLength(ext);
  const truncated = stripTrailingDotsAndSpaces(truncateToBytes(stem, stemBudget));
  return `${truncated || 'attachment'}${ext}`;
}

function neutraliseReservedName(name: string): string {
  const base = name.split('.')[0].trimEnd();
  return WINDOWS_RESERVED_NAME.test(base) ? `_${name}` : name;
}

export function sanitizeAttachmentFilename(name: unknown, id: unknown): string {
  const raw = typeof name === 'string' ? name.normalize('NFC') : '';
  const cleaned = stripTrailingDotsAndSpaces(
    replaceInvalidChars(lastSegment(stripControlChars(raw))).trimStart()
  );
  if (!cleaned) return fallbackName(id);
  return capLength(neutraliseReservedName(cleaned));
}

const collisionKey = (name: string) => name.normalize('NFKD').toUpperCase().toLowerCase();

const withCounter = (name: string, counter: number) => {
  const { stem, ext } = splitExtension(name);
  return `${stem}-${counter}${ext}`;
};

const isNameFree = (used: ReadonlySet<string>, candidate: string) =>
  !used.has(collisionKey(candidate)) && !used.has(collisionKey(`${candidate}${FRAMES_SUFFIX}`));

function pickFreeName(used: ReadonlySet<string>, base: string): string {
  if (isNameFree(used, base)) return base;
  for (let counter = 1; ; counter++) {
    const candidate = withCounter(base, counter);
    if (isNameFree(used, candidate)) return candidate;
  }
}

export function assignAttachmentFilenames(attachments: ReadonlyArray<AttachmentRef>): string[] {
  const used = new Set<string>();
  return attachments.map((att) => {
    const name = pickFreeName(used, sanitizeAttachmentFilename(att.filename, att.id));
    used.add(collisionKey(name));
    used.add(collisionKey(`${name}${FRAMES_SUFFIX}`));
    return name;
  });
}

export function framesDirName(filename: string): string {
  return `${filename}${FRAMES_SUFFIX}`;
}

export function isSafeIssueKey(key: unknown): key is string {
  if (typeof key !== 'string' || key.includes('/')) return false;
  try {
    return parseIssueKey(key).key === key;
  } catch {
    return false;
  }
}

export function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  if (rel === '' || isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

export function resolveContainedPath(dir: string, name: string): string {
  const target = join(dir, name);
  if (!isPathInside(dir, target)) {
    throw new Error(`Refusing to write outside ${dir}: ${JSON.stringify(name)}`);
  }
  return target;
}

const isMissingEntryError = (error: unknown) =>
  error instanceof Error &&
  'code' in error &&
  MISSING_ENTRY_CODES.some((code) => code === error.code);

function lstatOrUndefined(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isMissingEntryError(error)) return undefined;
    throw error;
  }
}

export function entryExists(path: string): boolean {
  return lstatOrUndefined(path) !== undefined;
}

export function isSymlink(path: string): boolean {
  return lstatOrUndefined(path)?.isSymbolicLink() ?? false;
}

export function isRegularFile(path: string): boolean {
  return lstatOrUndefined(path)?.isFile() ?? false;
}

export function isRealDirectory(path: string): boolean {
  return lstatOrUndefined(path)?.isDirectory() ?? false;
}

export function isRealPathInside(root: string, path: string): boolean {
  return isPathInside(realpathSync(root), realpathSync(path));
}

export function tempPathIn(dir: string): string {
  return join(dir, `.jirallm-${randomBytes(TEMP_SUFFIX_BYTES).toString('hex')}.tmp`);
}

export function assertNotSymlink(path: string): void {
  if (isSymlink(path)) throw new Error(`Refusing to write through symlink: ${path}`);
}

export function assertRealPathInside(root: string, path: string): void {
  if (!isRealPathInside(root, path)) {
    throw new Error(`Refusing to write outside ${root}: ${path} resolves elsewhere`);
  }
}

export function ensureRealDirectory(path: string): void {
  assertNotSymlink(path);
  if (!entryExists(path)) mkdirSync(path);
  if (!isRealDirectory(path)) throw new Error(`Refusing to write: ${path} is not a directory`);
}

export function removeEntry(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

export function writeFileAtomic(path: string, content: string): void {
  assertNotSymlink(path);
  const tmp = tempPathIn(dirname(path));
  try {
    writeFileSync(tmp, content, { encoding: 'utf-8', flag: 'wx' });
    renameSync(tmp, path);
  } catch (error) {
    removeEntry(tmp);
    throw error;
  }
}

export async function writeViaTempFile(
  target: string,
  write: (tempPath: string) => Promise<void>
): Promise<void> {
  assertNotSymlink(target);
  const tmp = tempPathIn(dirname(target));
  removeEntry(tmp);
  try {
    await write(tmp);
    assertNotSymlink(target);
    renameSync(tmp, target);
  } catch (error) {
    removeEntry(tmp);
    throw error;
  }
}
