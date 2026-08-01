export const DESCRIPTION_FORMATS = ['markdown', 'adf', 'both'] as const;

export type DescriptionFormat = (typeof DESCRIPTION_FORMATS)[number];

export const DEFAULT_DESCRIPTION_FORMAT: DescriptionFormat = 'markdown';

export function parseDescriptionFormat(value?: string): DescriptionFormat {
  if (value === undefined) return DEFAULT_DESCRIPTION_FORMAT;
  const match = DESCRIPTION_FORMATS.find((format) => format === value);
  if (!match) {
    throw new Error(
      `Invalid --description-format "${value}". Allowed values: ${DESCRIPTION_FORMATS.join(', ')}.`
    );
  }
  return match;
}
