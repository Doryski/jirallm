import { z } from 'zod';

const videoFramesRawSchema = z
  .object({
    enabled: z.boolean().optional(),
    fps: z.number().optional(),
    quality: z.number().optional(),
    max_frames: z.number().optional(),
    similarity_threshold: z.number().optional(),
  })
  .strict();

const projectRawSchema = z
  .object({
    output_dir: z.string().optional(),
  })
  .strict();

const orgRawSchema = z
  .object({
    base_url: z.url(),
    user_email: z.email(),
    include_subtasks: z.boolean().optional(),
    video_frames: videoFramesRawSchema.optional(),
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
