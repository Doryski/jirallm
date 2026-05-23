import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printJson, shouldOutputJson } from './jsonOutput.js';

describe('jsonOutput', () => {
  const originalIsTTY = process.stdout.isTTY;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  describe('shouldOutputJson', () => {
    it('returns true when flags.json is set even with TTY', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      expect(shouldOutputJson({ json: true })).toBe(true);
    });

    it('returns true when stdout is not a TTY (pipe/redirect) even without flag', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
      expect(shouldOutputJson({})).toBe(true);
    });

    it('returns false when interactive TTY and no flag', () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      expect(shouldOutputJson({})).toBe(false);
      expect(shouldOutputJson({ json: false })).toBe(false);
    });
  });

  describe('printJson', () => {
    it('writes pretty-printed JSON with trailing newline', () => {
      printJson({ a: 1, b: [2, 3] });
      expect(writeSpy).toHaveBeenCalledTimes(1);
      const arg = writeSpy.mock.calls[0][0] as string;
      expect(arg.endsWith('\n')).toBe(true);
      expect(JSON.parse(arg)).toEqual({ a: 1, b: [2, 3] });
      expect(arg).toContain('\n  '); // 2-space indent
    });

    it('handles null/primitive values', () => {
      printJson(null);
      const arg = writeSpy.mock.calls[0][0] as string;
      expect(arg).toBe('null\n');
    });
  });
});
