## Changelog

All notable changes to `jirallm` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The normalised `parent` object returned by `fetch --json` and `search --json` now also carries
  `issueType` and `priority` (#22), so an Epic parent can be told apart from a Story/Task parent
  without a second `fetch` on the parent key or a `--raw` round trip. Both are omitted when Jira
  does not supply them; no extra request is made.
- `search` now includes `parent` in its default field set (#21): every row carries the same
  normalised `{ key, title, status, issueType, priority }` object `fetch` returns (omitted when the
  issue has no parent),
  so a `parent in (A, B, C)` query groups into a parent → children map without an extra `fetch` per
  child. Drop it with `--fields -parent`; a narrowing selector like `--fields summary,status` omits
  it. Human-readable output labels the parent key on each line when present.
- `search --fields` now projects `epic` (#25). The instance's Epic Link custom field id is resolved
  at runtime — the org's `[orgs.X.export.custom_fields] epic` override first, else auto-detected
  from the field catalog (the `com.pyxis.greenhopper.jira:gh-epic-link` schema, or a field named
  "Epic Link"), else the common epic custom field ids — and added to the request exactly as `sprint`
  and `storyPoints` already were, so `jirallm search 'project = PROJ' --fields default,+epic` emits
  the epic on every row. Either shape Jira returns is read — an epic object or a bare epic key, with
  the title omitted when Jira supplies none — on both the resolved-id and the fallback path. The
  catalog read is memoised per client, so a successful read is one shared
  `GET /rest/api/3/field` across the raw-ID check and the sprint / story-points / epic detection; a
  catalog read that fails is not memoised and each detection retries it on its own.
- `ParentRef` is now a public type export (used by `JiraTaskData.parent` and
  `JiraTaskSummary.parent`).
- Failed Jira requests now throw a `JiraApiError` carrying the response `status`, `body` and
  `headers` instead of a flat `Error`, so callers can branch on the status code and read Jira's
  error payload without re-issuing the request.
- `export --include-parent` pulls a child's parent along as its own full bundle (#24) — its own
  directory with `task.md`, attachments and frames — instead of only the flattened
  `parent: "PROJ-100 - <title>"` frontmatter line, so the parent's description, where the
  requirements usually live, travels with the child. The whole ancestor chain is walked: a sub-task
  under a Story under an Epic pulls both. It is the counterpart to `--include-subtasks`, which goes
  the other way and stays metadata-only. The flag has no org-config counterpart; the library
  equivalent is `includeParent` on `ExportOptions`.

### Changed

- `epic.title` is now optional on `JiraTaskData` and `JiraTaskSummary` (#25). Jira hands back a bare
  epic key with no summary on some instances, so the title can legitimately be absent; the exported
  frontmatter prints the key alone rather than `KEY - undefined`, and `--json` omits the `title`
  property entirely. Consumers that read `epic.title` must now handle `undefined`.

### Removed

- The unused `includeParentEpic` field has been dropped from the public `ExportOptions` type (#24).
  This is a breaking change to that public type: passing `includeParentEpic` in an object literal —
  the usual way to call `exportIssues` — is now a compile error, because TypeScript's excess
  property check rejects it. The field was declared but never read, so nothing it was meant to do is
  lost and no runtime behaviour changes; the fix is to delete the property from the call.

### Security

- Redirects to private or non-allowlisted hosts are refused. A Jira response redirecting to a
  loopback, link-local or RFC 1918 address (or any host outside the configured site) no longer has
  the request — and its `Authorization` header — followed to that target.

### Fixed

- `search --fields` no longer accepts `epic` and `subtasks` and then silently returns neither (#25).
  Both friendly names map to internal sentinels that are stripped from the wire request, and
  `search` had no step to resolve them the way it already resolved `sprint` and `storyPoints`, so
  `jirallm search 'project = PROJ' --fields default,+epic` and `--fields minimal` returned rows
  without either field while `fetch` on the same issue returned both. `epic` is now resolved and
  returned. `subtasks` cannot be projected by `search` at all — Jira returns no subtasks in a search
  page, so it would mean one extra request per row on a page of up to 50 — and it now fails loudly
  instead of silently: naming it explicitly (`--fields subtasks`, `--fields default,+subtasks`) is
  an error exiting 1 and pointing at `jirallm fetch <KEY> --with-subtasks`, while `subtasks` arriving
  only implicitly — from a preset (`minimal`, `default` and `all` all contain it) or the configured
  base — prints one `Warning:` line on stderr and the search proceeds, so those presets stay usable.
  Both guards match the name case-insensitively.
  `fetch` and `export` are unchanged and still supply subtasks via `--with-subtasks` /
  `includeSubtasks`.
- `--fields "+name"` now adds to the current field set instead of replacing it (#23). Previously a
  lone `+name` (with no `-name` alongside it and no explicit preset) was indistinguishable from a
  bare replacement list, so asking for one extra field silently discarded the rest of the preset —
  `fetch PROJ-1 --fields "+priority"` returned a single field instead of the default set plus
  `priority`. `+name`/`-name` now consistently adjust the current set across `export`, `fetch` and
  `search`; a bare comma list or an explicit preset still replaces it.
- Unrecognised `--fields` names are now rejected instead of being silently dropped (#23). A typo
  such as `--fields "+issuelinkz"` previously yielded no data and no diagnostic; `fetch` and
  `export` now fail with the offending name and the list of valid ones. `search` still passes
  unmapped raw Jira field IDs (`customfield_10050`, `environment`) straight through, as documented.
- `search --fields` now catches typos in those raw pass-through IDs (#23). A name outside jirallm's
  vocabulary is verified against the instance's field catalog (one extra `GET /field`, made only
  when such a name is present) and rejected with a closest-match suggestion instead of silently
  producing an empty column. Only IDs are accepted — a display name is rejected with the ID to use
  (`"Team" → "customfield_10050"`). `*all`/`*navigable` and `-name` exclusions are never checked, and
  a catalog that cannot be read only warns, leaving the search to run as before.
- `export --fields` adjustments now compose with the org's configured `[orgs.X.export.fields]` base
  rather than discarding it (#23). An unrecognised name coming from config warns and continues, so a
  stale config cannot hard-fail an export.
- `search --json` rows are now shaped from the resolved `--fields` set (#20) instead of a fixed
  projection, so a narrowed or widened selector is reflected in the emitted rows.
- A key repeated on an `export` command line is now exported once (#24).
  `jirallm export PROJ-123 PROJ-100 PROJ-100` previously fetched `PROJ-100` twice and reported it in
  both the "Imported" and the "Updated" summary bucket, printing its download banner twice;
  attachment bytes were already guarded, but the issue fetch, comments, changelog, subtask fetch,
  markdown rewrite and video frame extraction all repeated. Keys are now deduplicated
  case-insensitively, keeping the casing and position of the first occurrence, and each one is
  reported exactly once. The dedupe happens both in the CLI — so the `--dry-run` listing and the
  `Exporting N issue(s)` count agree with what is written — and inside `JiraExporter.exportIssues`,
  so programmatic callers get the same guarantee.

## [0.12.0] - 2026-07-21

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
- `--attach-images` now accepts **any** file type, and `--attach-media` is available as an alias:
  - videos (`.mp4`, `.mov`, `.webm`, `.mkv`, …) are sized inline via `ffprobe`, falling back to
    parsing `ffmpeg -i` output; without either binary the video still embeds, just unsized;
  - non-media files (`.txt`, `.log`, `.har`, …) embed as a compact ADF `mediaGroup` tile instead of a
    full-width attachment card, and consecutive uncaptioned files share one tile row.
- Positional embedding: write `@@media:<file>@@` on its own line in the body to place a file exactly
  there instead of appending it. Matches the basename or the path passed on the command line, works
  with `--no-wiki`, and warns (leaving the text alone) when nothing matches.
- `fetch --rendered` adds `expand=renderedFields` and returns a `renderedFields` object alongside the
  raw fields (implies raw JSON), so rich bodies can be verified as rendered HTML without dropping to
  raw REST. `fetch --expand <list>` passes arbitrary Jira expand params through on the raw object.
- `comment:ls --rendered` adds `expand=renderedBody` and includes `renderedBody` per comment
  (implies JSON).
- `--no-wiki` on `create` and `edit`, matching `comment --no-wiki`: the description is sent verbatim
  instead of being converted markdown → wiki, so Jira wiki-markup templates (`h2.`, `#`, `{panel}`)
  can be submitted as-is.
- `attach --json` now emits the full attachment objects Jira returns (#19) — `self`, `mimeType`,
  `created`, `content`, `thumbnail` and `author` — typed as `UploadedAttachment` rather than narrowed
  to id/filename/size.

### Fixed

- `create --field` is now pre-flighted against the project + issue-type create screen (#12). Jira
  silently drops (and defaults) custom fields that are not on the create screen, so values were lost
  without any error; the command now aborts with the offending field ids before the POST, and
  warns-and-proceeds when the screen cannot be fetched.

## [0.11.0] - 2026-07-21

### Added

- `fetch` now resolves the shared `default` field preset (components, labels, priority, assignee, …)
  and org custom fields (#3), so `--json` is no longer trimmed to key/title/status/description/
  issueType. `--fields <list>` reuses the `export` preset/`+add`/`-drop` resolver.
- `fetch --raw` dumps the untouched Jira field object (`fields=*all&expand=names`) for verifying what
  actually landed after a `create` or `edit`, backed by a new `JiraClient.fetchIssueRaw`.

### Fixed

- `create`/`edit` `--components` is now repeatable (one literal name per occurrence, like
  `-F/--field`) instead of comma-split (#2). Splitting on `,` tore a single valid component name
  containing a comma (e.g. `"Foo, Bar & Baz"`) into non-existent ones.

## [0.10.0] - 2026-07-20

### Added

- `--attach-images <spec...>` on `comment`, `comment:edit`, `create` and `edit`: uploads images and
  embeds them as ADF `mediaSingle` nodes instead of wiki thumbnails, so they can be sized and
  aligned. Spec format is `file.png` or `file.png:"caption"`.
- `--image-layout` (`center`, `align-start` (default), `align-end`, `wrap-left`, `wrap-right`,
  `wide`, `full-width`) and `--image-width` (percent of container width, 1–100, default 50).
- `--attach` on `create` and `edit` (embeds into the issue description).
- Image pixel dimensions are read from the file header (PNG/JPEG/GIF/WEBP/BMP) and sent to Jira.

### Notes

- Content is still posted through REST v2 (wiki markup) so Jira keeps generating the ADF for tables,
  code blocks and attachment cards; `jirallm` then rewrites only the marked images over REST v3.
- Captions are emitted as an italic (`em`) paragraph directly after the image. ADF's `caption` node
  is deliberately **not** used: Jira stores it but never renders it in comments (Confluence only).
- `--attach` behaviour is unchanged (images still embed as `!file|thumbnail!`).

## [0.9.0] - 2026-07-15

### Added

- `comment:edit` accepts attachments, matching `comment`.

## [0.8.0] - 2026-07-15

### Added

- `comment:edit` for editing an existing comment.
- `edit` now supports `parent` and due date.

## [0.7.0] - 2026-07-08

### Added

- Attachments can be embedded in comments, and media is rendered when reading issues back.
- Comment listings and issue details now include the full comment body instead of a truncated
  preview.

## [0.6.1] - 2026-07-07

### Fixed

- The CLI now runs when invoked through a symlinked `bin` (e.g. a `pnpm link`ed global install).

## [0.6.0] - 2026-07-07

### Added

- Org and project context is inferred from the working directory and config, so most commands no
  longer need explicit `-o/-P` flags.

### Changed

- Assorted CLI ergonomics and safety improvements around the inferred context.

## [0.5.0] - 2026-07-05

### Changed

- Replaced the local video frame extractor with [`framewise`](https://www.npmjs.com/package/framewise).
- Migrated the release pipeline to the shared
  [`@doryski/release`](https://www.npmjs.com/package/@doryski/release) workflow.

## [0.4.0] - 2026-07-04

### Added

- `export` subcommand, plus `--with-*` data flags on `fetch` and `export` for opting into extra
  issue data.

### Fixed

- The release version is now derived from conventional commits.

## [0.3.0] - 2026-06-09

### Added

- Custom field and component support on `create` and `edit`.

## [0.2.0] - 2026-05-23

### Added

- Discovery, search and mutation commands: `me`, `projects`, `boards`, `sprints`, `issuetypes`,
  `linktypes`, `search`, `fetch`, `create`, `edit`, `assign`, `link`, `attach`, `watchers`. Read
  commands emit JSON when stdout is not a TTY; write commands accept `--dry-run`.
- `comment` command with markdown → wiki conversion and chunking for long bodies.
- `board:issues` and `transition` commands.
- `worklog` command for batch Jira time logging.
- `upgrade` command with a version check and update notifier.
- Configurable field selection and custom fields on `export`.
- Export results and the summary output now include file paths.
- A `.gitignore` is auto-generated in the export output directory.

### Changed

- Flattened the frontmatter structure and enriched export item metadata.

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

[0.12.0]: https://github.com/doryski/jirallm/releases/tag/v0.12.0
[0.11.0]: https://github.com/doryski/jirallm/releases/tag/v0.11.0
[0.10.0]: https://github.com/doryski/jirallm/releases/tag/v0.10.0
[0.9.0]: https://github.com/doryski/jirallm/releases/tag/v0.9.0
[0.8.0]: https://github.com/doryski/jirallm/releases/tag/v0.8.0
[0.7.0]: https://github.com/doryski/jirallm/releases/tag/v0.7.0
[0.6.1]: https://github.com/doryski/jirallm/releases/tag/v0.6.1
[0.6.0]: https://github.com/doryski/jirallm/releases/tag/v0.6.0
[0.5.0]: https://github.com/doryski/jirallm/releases/tag/v0.5.0
[0.4.0]: https://github.com/doryski/jirallm/releases/tag/v0.4.0
[0.3.0]: https://github.com/doryski/jirallm/releases/tag/v0.3.0
[0.2.0]: https://github.com/doryski/jirallm/releases/tag/v0.2.0
[0.1.1]: https://github.com/doryski/jirallm/releases/tag/v0.1.1
[0.1.0]: https://github.com/doryski/jirallm/releases/tag/v0.1.0
