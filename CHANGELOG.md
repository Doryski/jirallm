## Changelog

All notable changes to `jirallm` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `users <query>` (alias `user`): resolve any Jira user to their `accountId` by email, display name
  or accountId prefix — no more `assign --dry-run` detour. Supports `-P/--project` and
  `--issue` to restrict results to assignable users, `--limit`, and `me` as a query shorthand.
- `--sprint <id|active|none>` on `create` and `edit`: a first-class Sprint flag. Pass a sprint id,
  `active` to auto-resolve the project's scrum board's active sprint, or `none`/`null` to clear it —
  no more `--field customfield_XXXXX:number=`. `--board <name>` disambiguates `active` when the
  project has several scrum boards.
- `--field name=` (empty) or `--field name=null` now clears any nullable field (writes JSON `null`),
  for both friendly names and raw `customfield_NNNNN` ids.
- `--attach-images <spec...>` on `comment`, `comment:edit`, `create` and `edit`: uploads images and
  embeds them as ADF `mediaSingle` nodes instead of wiki thumbnails, so they can be sized and
  aligned. Spec format is `file.png` or `file.png:"caption"`.
- `--image-layout` (`center`, `align-start` (default), `align-end`, `wrap-left`, `wrap-right`,
  `wide`, `full-width`) and `--image-width` (percent of container width, 1–100, default 50).
- `--attach` on `create` and `edit` (embeds into the issue description).
- Image pixel dimensions are read from the file header (PNG/JPEG/GIF/WEBP/BMP) and sent to Jira.
- `--attach-images` now accepts **any** file type, and `--attach-media` is available as an alias:
  - videos (`.mp4`, `.mov`, `.webm`, `.mkv`, …) are sized inline via `ffprobe`, falling back to
    parsing `ffmpeg -i` output; without either binary the video still embeds, just unsized;
  - non-media files (`.txt`, `.log`, `.har`, …) embed as a compact ADF `mediaGroup` tile instead of a
    full-width attachment card, and consecutive uncaptioned files share one tile row.
- Positional embedding: write `@@media:<file>@@` on its own line in the body to place a file exactly
  there instead of appending it. Matches the basename or the path passed on the command line, works
  with `--no-wiki`, and warns (leaving the text alone) when nothing matches.

### Notes

- Content is still posted through REST v2 (wiki markup) so Jira keeps generating the ADF for tables,
  code blocks and attachment cards; `jirallm` then rewrites only the marked images over REST v3.
- Captions are emitted as an italic (`em`) paragraph directly after the image. ADF's `caption` node
  is deliberately **not** used: Jira stores it but never renders it in comments (Confluence only).
- `--attach` behaviour is unchanged (images still embed as `!file|thumbnail!`).

## [0.1.1] - 2026-05-03

### Changed

- Replaced `keytar` with [`@napi-rs/keyring`](https://www.npmjs.com/package/@napi-rs/keyring)
  for OS keychain access. Ships prebuilt binaries via NAPI-RS — no `node-gyp`
  rebuild required, fixing failures on global installs (`pnpm add -g jirallm`,
  `npm i -g jirallm`).
- Updated `jirallm doctor` and setup hints to reflect the new backend.

### Platforms

- Prebuilt binaries available for macOS (arm64, x64), Linux (x64, arm64, arm,
  riscv64; glibc and musl), Windows (x64, arm64, ia32), and FreeBSD (x64).
- Linux still requires a Secret Service provider (`gnome-keyring`, KWallet) for
  keychain operations.

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
