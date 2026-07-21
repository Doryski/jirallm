import { describe, expect, it } from 'vitest';
import { parseFfmpegStderrSize, parseFfprobeSize } from './videoSize.js';

describe('parseFfprobeSize', () => {
  it('reads width and height from the first video stream', () => {
    expect(parseFfprobeSize('{"streams":[{"width":1280,"height":720}]}')).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it('returns undefined for malformed JSON, missing streams or bogus values', () => {
    expect(parseFfprobeSize('not json')).toBeUndefined();
    expect(parseFfprobeSize('{"streams":[]}')).toBeUndefined();
    expect(parseFfprobeSize('{"streams":[{"width":"1280","height":720}]}')).toBeUndefined();
    expect(parseFfprobeSize('{"streams":[{"width":0,"height":720}]}')).toBeUndefined();
  });
});

describe('parseFfmpegStderrSize', () => {
  it('extracts dimensions from an ffmpeg stream line', () => {
    const stderr = [
      "Input #0, matroska,webm, from 'demo.webm':",
      '  Stream #0:0(eng): Video: vp9 (Profile 0), yuv420p(tv, bt709), 1920x1080, SAR 1:1 DAR 16:9, 30 fps',
    ].join('\n');

    expect(parseFfmpegStderrSize(stderr)).toEqual({ width: 1920, height: 1080 });
  });

  it('returns undefined when no dimensions are present', () => {
    expect(parseFfmpegStderrSize('Invalid data found when processing input')).toBeUndefined();
  });
});
