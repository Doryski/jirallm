export { JiraClient } from './lib/jiraClient.js';
export type { JiraConfig, JiraTaskData, JiraTaskSummary } from './lib/jiraClient.js';
export { JiraExporter } from './lib/exporter.js';
export type { ExportOptions, ExportResult } from './lib/exporter.js';
export {
  extractAndDeduplicateFrames,
  checkFFmpegInstalled,
  isVideoFile,
} from './lib/videoFrameExtractor.js';
export type { ExtractionOptions, ExtractionResult } from './lib/videoFrameExtractor.js';
export {
  loadProfile,
  resolveConfigPath,
  readConfig,
  writeConfig,
  upsertOrg,
  upsertProject,
  listOrgs,
  findOrgsByProjectKey,
} from './lib/config.js';
export type {
  Organization,
  Project,
  ResolvedProfile,
  LoadProfileOptions,
  VideoFramesConfig,
} from './lib/config.js';
export { getToken, setToken, removeToken, hasStoredToken } from './lib/credentials.js';
