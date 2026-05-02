## Changelog

All notable changes to `jirallm` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-01

### Added

- Initial public release.
- CLI `jirallm <ISSUE-KEY> [ISSUE-KEY ...]` for exporting one or more Jira issues
  into a structured folder.
- ADF-to-Markdown rendering for issue descriptions and comments.
- Authenticated download of all attachments with original filenames.
- Video frame extraction via `ffmpeg` with `pixelmatch`-based deduplication of
  near-identical frames; configurable via `--fps`, `--max-frames`, and
  `--no-video-frames`.
- Optional subtask metadata via `--include-subtasks`.
- Per-issue `index.md` summary suitable for pasting into an LLM context window.
- Programmatic API (`JiraExporter`, `JiraClient`, `loadProfile`, and credential
  helpers) for use as a library.
- Multi-organization / multi-project configuration in
  `~/.config/jirallm/config.toml` (or `$XDG_CONFIG_HOME/jirallm/config.toml`),
  with API tokens stored in the OS keychain via `keytar` (macOS Keychain,
  libsecret, Windows Credential Manager) — never written to disk.
- `jirallm init` interactive setup wizard (creates a new org or adds a project
  to an existing one) and `jirallm doctor` reachability check.
- `jirallm auth set|rm|list|status` and `jirallm orgs list|rm|project rm`
  subcommands for credential and config management.
- `jirallm setup` to install missing system dependencies (`ffmpeg`) with
  cascading consent, and `jirallm setup --bundled` to install the
  `ffmpeg-static` npm package globally instead of touching the system.
- `jirallm init` offers to run `jirallm setup` at the end when video frames are
  enabled and `ffmpeg` is missing from `PATH`. Defaults to opt-in everywhere
  except macOS without Homebrew, where it defaults to no (since setup may
  cascade into a long Homebrew + Xcode CLT install).

[0.1.0]: https://github.com/doryski/jirallm/releases/tag/v0.1.0
