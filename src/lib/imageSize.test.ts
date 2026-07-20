import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseImageSize, readImageSize } from './imageSize.js';

function png(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  buf.writeUInt32BE(0x89504e47, 0);
  buf.writeUInt32BE(0x0d0a1a0a, 4);
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

function jpeg(width: number, height: number): Buffer {
  const buf = Buffer.alloc(22);
  buf.writeUInt16BE(0xffd8, 0);
  buf.writeUInt16BE(0xffe0, 2);
  buf.writeUInt16BE(4, 4);
  buf.writeUInt16BE(0xffc0, 8);
  buf.writeUInt16BE(11, 10);
  buf.writeUInt8(8, 12);
  buf.writeUInt16BE(height, 13);
  buf.writeUInt16BE(width, 15);
  return buf;
}

function gif(width: number, height: number): Buffer {
  const buf = Buffer.alloc(13);
  buf.write('GIF89a', 0, 'ascii');
  buf.writeUInt16LE(width, 6);
  buf.writeUInt16LE(height, 8);
  return buf;
}

function webpVp8x(width: number, height: number): Buffer {
  const buf = Buffer.alloc(32);
  buf.write('RIFF', 0, 'ascii');
  buf.write('WEBP', 8, 'ascii');
  buf.write('VP8X', 12, 'ascii');
  buf.writeUIntLE(width - 1, 24, 3);
  buf.writeUIntLE(height - 1, 27, 3);
  return buf;
}

function bmp(width: number, height: number): Buffer {
  const buf = Buffer.alloc(30);
  buf.write('BM', 0, 'ascii');
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(-height, 22);
  return buf;
}

describe('parseImageSize', () => {
  it.each([
    ['png', png(3456, 2080), { width: 3456, height: 2080 }],
    ['jpeg', jpeg(800, 600), { width: 800, height: 600 }],
    ['gif', gif(120, 90), { width: 120, height: 90 }],
    ['webp/VP8X', webpVp8x(1024, 768), { width: 1024, height: 768 }],
    ['bmp', bmp(64, 32), { width: 64, height: 32 }],
  ])('reads %s dimensions from the header', (_name, buf, expected) => {
    expect(parseImageSize(buf)).toEqual(expected);
  });

  it('returns undefined for an unknown format', () => {
    expect(parseImageSize(Buffer.from('<svg viewBox="0 0 10 10"></svg>'))).toBeUndefined();
  });

  it('returns undefined for a truncated buffer', () => {
    expect(parseImageSize(Buffer.alloc(3))).toBeUndefined();
  });
});

describe('readImageSize', () => {
  it('reads dimensions from disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jirallm-imagesize-'));
    const file = join(dir, 'shot.png');
    writeFileSync(file, png(1440, 900));
    expect(readImageSize(file)).toEqual({ width: 1440, height: 900 });
  });

  it('returns undefined for a missing file', () => {
    expect(readImageSize(join(tmpdir(), 'jirallm-does-not-exist.png'))).toBeUndefined();
  });
});
