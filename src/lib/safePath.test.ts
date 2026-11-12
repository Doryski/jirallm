import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertNotSymlink,
  assertRealPathInside,
  assignAttachmentFilenames,
  ensureRealDirectory,
  isPathInside,
  isSafeIssueKey,
  resolveContainedPath,
  sanitizeAttachmentFilename,
  writeFileAtomic,
  writeViaTempFile,
} from './safePath.js';

const byteLength = (value: string) => Buffer.byteLength(value, 'utf8');

describe('sanitizeAttachmentFilename', () => {
  it.each([
    ['../../.ssh/id_rsa', 'id_rsa'],
    ['/etc/passwd', 'passwd'],
    ['..\\..\\Windows\\win.ini', 'win.ini'],
    ['a/b\\c.txt', 'c.txt'],
    ['report.pdf', 'report.pdf'],
    ['.env', '.env'],
  ])('reduces %j to the last path segment %j', (input, expected) => {
    expect(sanitizeAttachmentFilename(input, '1')).toBe(expected);
  });

  it.each(['..', '.', '', '   ', '../', 'dir/', '...', '\0'])(
    'falls back to an id-based name for %j',
    (input) => {
      expect(sanitizeAttachmentFilename(input, '10042')).toBe('attachment-10042');
    }
  );

  it('strips unsafe characters from the fallback id', () => {
    expect(sanitizeAttachmentFilename('..', '../x/9')).toBe('attachment-x9');
    expect(sanitizeAttachmentFilename('..', '')).toBe('attachment-unknown');
  });

  it('strips NUL and other control characters', () => {
    expect(sanitizeAttachmentFilename('evil\0.sh\n', '1')).toBe('evil.sh');
    expect(sanitizeAttachmentFilename('a\u0007b c.txt', '1')).toBe('abc.txt');
  });

  it('replaces Windows-invalid characters and percent signs', () => {
    expect(sanitizeAttachmentFilename('a<b>c:d"e|f?g*h.txt', '1')).toBe('a_b_c_d_e_f_g_h.txt');
    expect(sanitizeAttachmentFilename('clip%05d.mp4', '1')).toBe('clip_05d.mp4');
  });

  it.each([
    ['CON', '_CON'],
    ['nul.txt', '_nul.txt'],
    ['COM1.log', '_COM1.log'],
    ['lpt9', '_lpt9'],
    ['Aux .tar.gz', '_Aux .tar.gz'],
    ['console.txt', 'console.txt'],
  ])('neutralises reserved device name %j', (input, expected) => {
    expect(sanitizeAttachmentFilename(input, '1')).toBe(expected);
  });

  it('strips trailing dots and spaces', () => {
    expect(sanitizeAttachmentFilename('notes.txt. . ', '1')).toBe('notes.txt');
  });

  it('caps over-long names while keeping the extension', () => {
    const result = sanitizeAttachmentFilename(`${'a'.repeat(400)}.png`, '1');
    expect(byteLength(result)).toBeLessThanOrEqual(180);
    expect(result.endsWith('.png')).toBe(true);
  });

  it('caps multi-byte names without splitting characters', () => {
    const result = sanitizeAttachmentFilename(`${'ż'.repeat(200)}.mp4`, '1');
    expect(byteLength(result)).toBeLessThanOrEqual(180);
    expect(result).toMatch(/^ż+\.mp4$/);
  });

  it('treats a non-string name as missing', () => {
    expect(sanitizeAttachmentFilename(undefined, '5')).toBe('attachment-5');
  });
});

describe('assignAttachmentFilenames', () => {
  it('keeps unique names and suffixes duplicates before the extension', () => {
    expect(
      assignAttachmentFilenames([
        { id: '1', filename: 'doc.pdf' },
        { id: '2', filename: 'doc.pdf' },
        { id: '3', filename: 'README' },
        { id: '4', filename: 'README' },
      ])
    ).toEqual(['doc.pdf', 'doc-1.pdf', 'README', 'README-1']);
  });

  it('treats names differing only by case as collisions', () => {
    expect(
      assignAttachmentFilenames([
        { id: '1', filename: 'Photo.JPG' },
        { id: '2', filename: 'photo.jpg' },
      ])
    ).toEqual(['Photo.JPG', 'photo-1.jpg']);
  });

  it('detects collisions after sanitizing', () => {
    expect(
      assignAttachmentFilenames([
        { id: '1', filename: 'a/x.png' },
        { id: '2', filename: 'b\\X.png' },
      ])
    ).toEqual(['x.png', 'X-1.png']);
  });

  it('avoids clashing with another attachment frames directory', () => {
    expect(
      assignAttachmentFilenames([
        { id: '1', filename: 'demo.mp4' },
        { id: '2', filename: 'demo.mp4-frames' },
      ])
    ).toEqual(['demo.mp4', 'demo-1.mp4-frames']);
  });
});

describe('isSafeIssueKey', () => {
  it.each(['PROJ-1', 'AB_2-99999'])('accepts %j', (key) => {
    expect(isSafeIssueKey(key)).toBe(true);
  });

  it.each(['../PROJ-1', 'org/PROJ-1', 'proj-1', 'PROJ-1\n', 'PROJ', '', 42, undefined])(
    'rejects %j',
    (key) => {
      expect(isSafeIssueKey(key)).toBe(false);
    }
  );
});

describe('isPathInside / resolveContainedPath', () => {
  it('detects containment', () => {
    expect(isPathInside('/a/b', '/a/b/c')).toBe(true);
    expect(isPathInside('/a/b', '/a/b/..foo')).toBe(true);
    expect(isPathInside('/a/b', '/a/b')).toBe(false);
    expect(isPathInside('/a/b', '/a/bc')).toBe(false);
    expect(isPathInside('/a/b', '/a')).toBe(false);
  });

  it('throws for names that escape the directory', () => {
    expect(resolveContainedPath('/a/b', 'c.txt')).toBe('/a/b/c.txt');
    expect(() => resolveContainedPath('/a/b', '../c.txt')).toThrow(/outside/);
    expect(() => resolveContainedPath('/a/b', '.')).toThrow(/outside/);
  });
});

describe('filesystem guards', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jirallm-safe-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('assertNotSymlink throws for symlinks, including dangling ones', () => {
    symlinkSync(join(dir, 'missing'), join(dir, 'link'));
    expect(() => assertNotSymlink(join(dir, 'link'))).toThrow(/symlink: .*link/);
    expect(() => assertNotSymlink(join(dir, 'absent'))).not.toThrow();
  });

  it('ensureRealDirectory creates a directory and refuses symlinks and files', () => {
    ensureRealDirectory(join(dir, 'new'));
    expect(existsSync(join(dir, 'new'))).toBe(true);
    symlinkSync(join(dir, 'new'), join(dir, 'link'));
    expect(() => ensureRealDirectory(join(dir, 'link'))).toThrow(/symlink/);
    writeFileSync(join(dir, 'file'), 'x');
    expect(() => ensureRealDirectory(join(dir, 'file'))).toThrow(/not a directory/);
  });

  it('assertRealPathInside follows the real paths of both sides', () => {
    mkdirSync(join(dir, 'out', 'inner'), { recursive: true });
    mkdirSync(join(dir, 'other'));
    symlinkSync(join(dir, 'other'), join(dir, 'out', 'escape'));
    expect(() => assertRealPathInside(join(dir, 'out'), join(dir, 'out', 'inner'))).not.toThrow();
    expect(() => assertRealPathInside(join(dir, 'out'), join(dir, 'out', 'escape'))).toThrow(
      /outside/
    );
  });

  it('writeFileAtomic replaces content and leaves no temp files', () => {
    const target = join(dir, 'task.md');
    writeFileSync(target, 'old');
    writeFileAtomic(target, 'new');
    expect(readFileSync(target, 'utf-8')).toBe('new');
    expect(readdirSync(dir)).toEqual(['task.md']);
  });

  it('writeFileAtomic refuses a symlinked target', () => {
    const victim = join(dir, 'victim');
    writeFileSync(victim, 'keep');
    symlinkSync(victim, join(dir, 'task.md'));
    expect(() => writeFileAtomic(join(dir, 'task.md'), 'evil')).toThrow(/symlink/);
    expect(readFileSync(victim, 'utf-8')).toBe('keep');
  });

  it('writeViaTempFile renames on success and cleans up on failure', async () => {
    const target = join(dir, 'a.bin');
    await writeViaTempFile(target, async (tmp) => writeFileSync(tmp, 'data'));
    expect(readFileSync(target, 'utf-8')).toBe('data');

    const failing = join(dir, 'b.bin');
    await expect(
      writeViaTempFile(failing, async (tmp) => {
        writeFileSync(tmp, 'partial');
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(readdirSync(dir)).toEqual(['a.bin']);
  });
});
