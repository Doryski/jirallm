import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DESCRIPTION_FORMAT,
  DESCRIPTION_FORMATS,
  parseDescriptionFormat,
} from './descriptionFormat.js';

describe('parseDescriptionFormat', () => {
  it.each(DESCRIPTION_FORMATS)('accepts "%s" unchanged', (format) => {
    expect(parseDescriptionFormat(format)).toBe(format);
  });

  it('defaults to markdown when no value is given', () => {
    expect(parseDescriptionFormat(undefined)).toBe(DEFAULT_DESCRIPTION_FORMAT);
    expect(DEFAULT_DESCRIPTION_FORMAT).toBe('markdown');
  });

  it('rejects an unknown format and lists the allowed values', () => {
    expect(() => parseDescriptionFormat('html')).toThrow(/Invalid --description-format "html"/);
    expect(() => parseDescriptionFormat('html')).toThrow(/markdown, adf, both/);
  });

  it('rejects a mis-cased value rather than normalising it', () => {
    expect(() => parseDescriptionFormat('ADF')).toThrow(/Invalid --description-format "ADF"/);
  });

  it('rejects an empty string instead of falling back to the default', () => {
    expect(() => parseDescriptionFormat('')).toThrow(/Invalid --description-format/);
  });
});
