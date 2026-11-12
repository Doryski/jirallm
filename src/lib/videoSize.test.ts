import { beforeEach, describe, expect, it, vi } from 'vitest';

type ExecResult = { stdout: string; stderr: string };
type ExecHandler = (file: string, args: readonly string[]) => ExecResult | Error;
type ExecCallback = (error: Error | null, result?: ExecResult) => void;

const { execFile, resolveFfmpegBinary } = vi.hoisted(() => ({
  execFile:
    vi.fn<
      (file: string, args: readonly string[], options: unknown, callback: ExecCallback) => void
    >(),
  resolveFfmpegBinary: vi.fn<() => Promise<string | null>>(),
}));

vi.mock('node:child_process', () => ({ execFile }));
vi.mock('framewise', () => ({ resolveFfmpegBinary }));

import {
  __test,
  parseFfmpegStderrDuration,
  parseFfmpegStderrSize,
  parseFfprobeDuration,
  parseFfprobeSize,
  PROBE_TIMEOUT_MS,
  readVideoDuration,
} from './videoSize.js';

function stubExecFile(handler: ExecHandler): void {
  execFile.mockImplementation((file, args, _options, callback) => {
    const result = handler(file, args);
    if (result instanceof Error) {
      callback(result);
      return;
    }
    callback(null, result);
  });
}

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

describe('parseFfprobeDuration', () => {
  it('reads the container duration in seconds', () => {
    expect(parseFfprobeDuration('{"format":{"duration":"12.480000"}}')).toBe(12.48);
    expect(parseFfprobeDuration('{"format":{"duration":7}}')).toBe(7);
  });

  it('returns undefined for missing, N/A or non-finite durations', () => {
    expect(parseFfprobeDuration('{"format":{}}')).toBeUndefined();
    expect(parseFfprobeDuration('{"format":{"duration":"N/A"}}')).toBeUndefined();
    expect(parseFfprobeDuration('{"format":{"duration":""}}')).toBeUndefined();
    expect(parseFfprobeDuration('{"format":{"duration":"-5"}}')).toBeUndefined();
    expect(parseFfprobeDuration('not json')).toBeUndefined();
  });
});

describe('parseFfmpegStderrDuration', () => {
  it('reads the Duration line', () => {
    expect(parseFfmpegStderrDuration('  Duration: 01:02:03.50, start: 0.000000')).toBe(3723.5);
  });

  it('returns undefined for N/A durations', () => {
    expect(parseFfmpegStderrDuration('  Duration: N/A, bitrate: N/A')).toBeUndefined();
  });
});

describe('readVideoDuration', () => {
  beforeEach(() => {
    __test.resetFfprobeCache();
    execFile.mockReset();
    resolveFfmpegBinary.mockResolvedValue('/bin/ffmpeg');
  });

  it('returns the ffprobe duration and passes a timeout to every probe call', async () => {
    stubExecFile((_file, args) =>
      args.includes('-version')
        ? { stdout: 'ffprobe version', stderr: '' }
        : { stdout: '{"format":{"duration":"42.0"}}', stderr: '' }
    );

    expect(await readVideoDuration('/v.mp4')).toEqual({ status: 'known', seconds: 42 });
    expect(execFile).toHaveBeenCalled();
    for (const call of execFile.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ timeout: PROBE_TIMEOUT_MS }));
    }
  });

  it('falls back to ffmpeg stderr when ffprobe reports no duration', async () => {
    stubExecFile((file, args) => {
      if (args.includes('-version')) return { stdout: '', stderr: '' };
      if (file.endsWith('ffprobe')) return { stdout: '{"format":{}}', stderr: '' };
      return Object.assign(new Error('exit 1'), { stderr: 'Duration: 00:40:00.00, start' });
    });

    expect(await readVideoDuration('/v.mp4')).toEqual({ status: 'known', seconds: 2400 });
  });

  it('reports unknown when the tools run but no duration is found', async () => {
    stubExecFile((file, args) => {
      if (args.includes('-version')) return { stdout: '', stderr: '' };
      if (file.endsWith('ffprobe')) return { stdout: '{"format":{"duration":"N/A"}}', stderr: '' };
      return Object.assign(new Error('exit 1'), { stderr: 'Duration: N/A' });
    });

    expect(await readVideoDuration('/v.mp4')).toEqual({ status: 'unknown' });
  });

  it('reports unavailable when neither ffprobe nor ffmpeg can be found', async () => {
    resolveFfmpegBinary.mockResolvedValue(null);
    stubExecFile(() => new Error('ENOENT'));

    expect(await readVideoDuration('/v.mp4')).toEqual({ status: 'unavailable' });
  });
});
