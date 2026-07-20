import { openSync, readSync, closeSync } from 'node:fs';

export type ImageSize = { width: number; height: number };

const HEADER_BYTES = 65536;

function readHeader(filePath: string): Buffer | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(filePath, 'r');
    const buf = Buffer.alloc(HEADER_BYTES);
    const read = readSync(fd, buf, 0, HEADER_BYTES, 0);
    return buf.subarray(0, read);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function pngSize(buf: Buffer): ImageSize | undefined {
  if (buf.length < 24) return undefined;
  if (buf.readUInt32BE(0) !== 0x89504e47) return undefined;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function gifSize(buf: Buffer): ImageSize | undefined {
  if (buf.length < 10) return undefined;
  if (buf.toString('ascii', 0, 3) !== 'GIF') return undefined;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function bmpSize(buf: Buffer): ImageSize | undefined {
  if (buf.length < 26) return undefined;
  if (buf.toString('ascii', 0, 2) !== 'BM') return undefined;
  return { width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) };
}

const SOF_SKIP = new Set([0xc4, 0xc8, 0xcc]);

function jpegSize(buf: Buffer): ImageSize | undefined {
  if (buf.length < 4 || buf.readUInt16BE(0) !== 0xffd8) return undefined;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buf[offset + 1];
    const length = buf.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && !SOF_SKIP.has(marker)) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    if (length < 2) return undefined;
    offset += 2 + length;
  }
  return undefined;
}

function webpSize(buf: Buffer): ImageSize | undefined {
  if (buf.length < 30) return undefined;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    return undefined;
  }
  const format = buf.toString('ascii', 12, 16);
  if (format === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (format === 'VP8L') {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (format === 'VP8X') {
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width, height };
  }
  return undefined;
}

const PARSERS = [pngSize, jpegSize, gifSize, webpSize, bmpSize];

export function parseImageSize(buf: Buffer): ImageSize | undefined {
  for (const parse of PARSERS) {
    const size = parse(buf);
    if (size && size.width > 0 && size.height > 0) return size;
  }
  return undefined;
}

export function readImageSize(filePath: string): ImageSize | undefined {
  const header = readHeader(filePath);
  return header ? parseImageSize(header) : undefined;
}
