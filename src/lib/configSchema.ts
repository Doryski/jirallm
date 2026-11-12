import { z } from 'zod';
import { baseUrlProblem } from './baseUrl.js';

export const VIDEO_FRAME_LIMITS = {
  fps: { min: 1, max: 30 },
  maxFrames: { min: 1, max: 200 },
} as const;

export type IntegerRange = (typeof VIDEO_FRAME_LIMITS)[keyof typeof VIDEO_FRAME_LIMITS];

const WHOLE_NUMBER_RE = /^\d+$/;

function rangeDescription(range: IntegerRange): string {
  return `a whole number from ${range.min} to ${range.max}`;
}

export function integerInRangeProblem(raw: string, range: IntegerRange): string | undefined {
  const trimmed = raw.trim();
  const value = Number(trimmed);
  if (WHOLE_NUMBER_RE.test(trimmed) && value >= range.min && value <= range.max) return undefined;
  return `"${raw}" is not ${rangeDescription(range)}`;
}

export function clampToRange(value: number, range: IntegerRange): number {
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

function clampedIntegerSchema(range: IntegerRange) {
  return z
    .number()
    .refine(Number.isFinite, 'must be a finite number')
    .transform((value) => clampToRange(value, range));
}

const baseUrlSchema = z.string().superRefine((value, ctx) => {
  const problem = baseUrlProblem(value);
  if (problem) ctx.addIssue({ code: 'custom', message: `Jira base URL ${problem}` });
});

const videoFramesRawSchema = z
  .object({
    enabled: z.boolean().optional(),
    fps: clampedIntegerSchema(VIDEO_FRAME_LIMITS.fps).optional(),
    quality: z.number().optional(),
    max_frames: clampedIntegerSchema(VIDEO_FRAME_LIMITS.maxFrames).optional(),
  })
  .strict();

const projectRawSchema = z
  .object({
    output_dir: z.string().optional(),
  })
  .strict();

const exportFieldsRawSchema = z
  .object({
    preset: z.enum(['all', 'minimal', 'default']).optional(),
    include: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
  })
  .strict();

const customFieldRawSchema = z
  .object({
    id: z.string(),
    type: z.enum(['scalar', 'select', 'user', 'sprint', 'number', 'array']),
  })
  .strict();

const exportRawSchema = z
  .object({
    fields: exportFieldsRawSchema.optional(),
    custom_fields: z.record(z.string(), customFieldRawSchema).optional(),
  })
  .strict();

const orgRawSchema = z
  .object({
    base_url: baseUrlSchema,
    user_email: z.email(),
    include_subtasks: z.boolean().optional(),
    video_frames: videoFramesRawSchema.optional(),
    export: exportRawSchema.optional(),
    projects: z.record(z.string(), projectRawSchema).optional(),
  })
  .strict();

const configRawSchema = z
  .object({
    orgs: z.record(z.string(), orgRawSchema).optional(),
  })
  .strict();

export type RawProject = z.infer<typeof projectRawSchema>;
export type RawOrg = z.infer<typeof orgRawSchema>;
export type RawConfig = z.infer<typeof configRawSchema>;

export function parseConfig(input: unknown, sourcePath?: string): RawConfig {
  const result = configRawSchema.safeParse(input);
  if (result.success) return result.data;

  const lines = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `  ${path}: ${issue.message}`;
  });
  const where = sourcePath ? ` at ${sourcePath}` : '';
  throw new Error(`Invalid jirallm config${where}:\n${lines.join('\n')}`);
}
