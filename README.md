# jirallm

[![CI](https://github.com/doryski/jirallm/actions/workflows/ci.yml/badge.svg)](https://github.com/doryski/jirallm/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/jirallm)](https://www.npmjs.com/package/jirallm)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)

Export Jira Cloud issues as LLM-ready context bundles — markdown, attachments, and deduplicated video frames.

## Why it exists

Pasting Jira tickets into an LLM is painful: descriptions are ADF (Atlassian Document Format), comments live in a separate API, attachments are URLs behind auth, and video recordings are useless to a text model. `jirallm` turns a Jira issue into a self-contained folder of clean markdown plus extracted media — ready to drop into Claude, ChatGPT, Cursor, or any RAG pipeline.

It exists because every team that uses Jira + LLMs ends up writing the same brittle scraping script. This is the version you wish you had.

## Features

- Export one or more issues by key into a structured folder
- Renders Jira ADF descriptions and comments to clean Markdown
- Downloads all attachments with original filenames (auth handled)
- Extracts frames from attached videos via `ffmpeg` and deduplicates near-identical frames using `pixelmatch`
- Produces an `index.md` summary per issue, ready to paste into an LLM context window
- Works as a CLI (`jirallm`) and as a programmatic library
- TypeScript-first, ESM, zero hidden globals

## Requirements

- Node.js >= 20
- [`ffmpeg`](https://ffmpeg.org/download.html) on your `PATH` — only required if you export issues with video attachments. You can also run `jirallm setup` to install it for you (and `jirallm init` will offer to do this automatically when you opt into video frames).
- A Jira Cloud API token

## Installation

```bash
# Global CLI
npm install -g jirallm
# or
pnpm add -g jirallm

# As a library inside a project
pnpm add jirallm
```

### Updating

`jirallm` checks for new versions once a day in the background and prints a notice on the next invocation. To upgrade:

```bash
jirallm upgrade           # auto-detects npm / pnpm / yarn / Homebrew
jirallm upgrade --check   # just report whether an update is available
```

## Configuration

The recommended way to configure `jirallm` is the interactive wizard:

```bash
jirallm init
```

It prompts for everything, writes an org + project entry to `~/.config/jirallm/config.toml`, and stores the API token in your OS keychain (macOS Keychain / libsecret / Windows Credential Manager) — never on disk.

Run `jirallm init` again any time you want to **add another organization** or **add a new project to an existing organization** — the wizard detects existing config and lets you pick "Create a new organization" or "Add a project to *<org>*".

If you enable video frame extraction during `init` and `ffmpeg` isn't on your `PATH`, `init` will offer to run `jirallm setup` for you. You can also run it manually any time, or use `jirallm setup --bundled` to install a self-contained `ffmpeg` via npm without touching your system.

### Organizations and projects

Configuration is two levels: an **organization** owns the connection (Jira instance, account email, API token); each org has one or more **projects** that share those credentials and only differ by project key (and optionally output directory).

```toml
# ~/.config/jirallm/config.toml

[orgs.widgets]
base_url         = "https://widgets.atlassian.net"
user_email       = "user@widgets.example"
include_subtasks = true

[orgs.widgets.video_frames]
enabled    = true
fps        = 5
max_frames = 10

[orgs.widgets.projects.WID]
output_dir = "~/jira/widgets"

[orgs.acme]
base_url   = "https://acme.atlassian.net"
user_email = "user@acme.example"

# Three projects share the same Jira instance + token
[orgs.acme.projects.PROJ]
output_dir = "~/jira/acme/proj"

[orgs.acme.projects.DOCS]
output_dir = "~/jira/acme/docs"

[orgs.acme.projects.LIB]
```

Most invocations are just the issue key — `jirallm` looks up the org by the project prefix:

```bash
jirallm PROJ-7              # auto-resolves to the org that owns PROJ
jirallm acme/PROJ-7         # disambiguate if multiple orgs have a PROJ project
jirallm --org acme PROJ-7   # explicit override
```

If a project key exists in more than one org and you didn't qualify it, you'll get an interactive picker (TTY) or an error suggesting `--org` / `org/KEY` (non-TTY).

Useful subcommands:

```bash
jirallm orgs list                   # show orgs, projects, and token status
jirallm auth set --org acme         # replace stored token (per organization)
jirallm auth rm  --org acme         # remove stored token
```

### Selection precedence

1. `--org` flag
2. `org/` prefix on the issue key (e.g. `acme/PROJ-7`)
3. Auto-resolved from the project prefix when only one configured org owns it

CLI flags (`--base-url`, `--output-dir`, `--fps`, …) override whatever the resolved config produces.

## Quick start

### CLI

```bash
# First-time setup (config + credentials, offers to install ffmpeg)
jirallm init

# Install ffmpeg later, or independently of init
jirallm setup
jirallm setup --bundled   # self-contained ffmpeg-static, no system changes

# Export a single issue (output defaults to ./jira-export)
jirallm PROJ-123

# Export several issues to a custom directory
jirallm PROJ-123 PROJ-124 --output-dir ./context

# Skip video frame extraction (faster, no ffmpeg required)
jirallm PROJ-123 --no-video-frames

# Tune frame extraction
jirallm PROJ-123 --fps 2 --max-frames 6

# Include subtask metadata in the export
jirallm PROJ-123 --include-subtasks

# Show all options
jirallm --help
```

Each issue lands in its own folder:

```
jira-export/
  PROJ-123/
    index.md            # summary + description + comments
    attachments/
      design.pdf
      screen-recording.mp4
    frames/
      screen-recording/
        frame-0001.jpg
        frame-0042.jpg   # only meaningfully different frames are kept
```

### Programmatic

```ts
import { JiraExporter, loadProfile } from 'jirallm';

// Resolve an org/project (config file + keychain), with the same precedence as the CLI
const { config, apiToken, org, project } = await loadProfile({ org: 'acme', project: 'DOCS' });

const exporter = new JiraExporter(config, apiToken);

const result = await exporter.exportIssues(['DOCS-123'], {
  outputDir: project.outputDir ?? './jira-export',
  includeSubtasks: org.includeSubtasks ?? false,
  videoFrames: { enabled: true, fps: 5, maxFrames: 10 },
});
```

The constructor also accepts a hand-rolled `JiraConfig` + token if you don't want to use the config file.

A lower-level `JiraClient` is also exported for callers that want to drive the Jira API directly.

## Example

Bundle a few issues and pipe the resulting summary into your LLM of choice:

```bash
jirallm PROJ-123 PROJ-124 --output-dir ./triage-bundle
cat ./triage-bundle/PROJ-123/index.md | pbcopy
```

## For agents (CLI commands)

Every read command supports `--json` (and automatically switches to JSON when stdout is not a TTY), so they're safe to pipe into `jq` or feed back into an agent. Every write command supports `--dry-run`.

Discovery & search:

```bash
jirallm me --org acme --json
jirallm projects --org acme --json
jirallm boards --org acme --project PROJ --json
jirallm sprints 123 --org acme --state active --json
jirallm issuetypes --org acme --project PROJ --json
jirallm linktypes --org acme --json
jirallm search 'assignee = currentUser() AND statusCategory != Done' --org acme --limit 25 --json
jirallm fetch PROJ-123 --json
jirallm transition PROJ-123 --list --json
```

Mutations (all accept `--dry-run`):

```bash
jirallm comment PROJ-123 --file ./summary.md
jirallm comment:ls PROJ-123 --json
jirallm comment:edit PROJ-123 26215 --file ./fixed.md --attach after-proof.png
jirallm comment PROJ-123 --file ./summary.md --attach-images shot.png:"New config field"
jirallm comment:rm PROJ-123 26215 --yes
jirallm transition PROJ-123 --to "In Review"
jirallm worklog -f ./worklogs.json
jirallm create --org acme --project PROJ --type Task --summary "Spike" --description-file ./spike.md
jirallm edit PROJ-123 --summary "New title" --labels a,b --priority High --parent PROJ-1 --due 2026-08-01
jirallm assign PROJ-123 me
jirallm link PROJ-1 "blocks" PROJ-2 --comment "blocked by infra work"
jirallm link:rm 10042 --org acme
jirallm attach PROJ-123 ./screenshot.png ./recording.mp4
jirallm attach:rm 99021 --org acme
jirallm watchers PROJ-123 --add me
```

### Full-size images in comments and descriptions

`--attach` embeds images as wiki thumbnails (`!file.png|thumbnail!`) — small, centered, and not
resizable, because Jira's wiki markup has no way to set an image size. `--attach-images` uploads the
same files but embeds them as ADF `mediaSingle` nodes instead, which do support layout and width:

```bash
jirallm comment PROJ-123 --file ./summary.md \
  --attach-images shot.png:"New config field" flow.png \
  --image-layout align-start --image-width 50

jirallm comment:edit PROJ-123 26215 --file ./qa.md --attach-images after.png:"After the fix"
jirallm create -o acme -t Bug -s "Crash" --description-file ./repro.md --attach-images repro.png
jirallm edit PROJ-123 --description-file ./updated.md --attach-images after.png:"After the fix"
```

- Spec format: `file.png` or `file.png:"caption"` (captions may contain spaces and colons).
- `--image-layout`: `center`, `align-start` (default), `align-end`, `wrap-left`, `wrap-right`,
  `wide`, `full-width`.
- `--image-width`: percent of the container width, `1`–`100` (default `50`).
- Pixel dimensions are read from the file header (PNG/JPEG/GIF/WEBP/BMP) and passed to Jira.
- Non-image files given to `--attach-images` fall back to attachment cards, like `--attach`.
- `--attach` is unchanged, so existing scripts keep working.
- On `jirallm edit`, files are uploaded but the description is only rewritten when
  `--description`/`--description-file` is also given.

How it works: the comment/description is posted through REST v2 (wiki markup) exactly as before, so
Jira does the markdown→ADF conversion — tables, code blocks and attachment cards come out right.
`jirallm` then reads the generated ADF over REST v3, swaps each marked image for a `mediaSingle`
node, and writes it back.

> **Do not "fix" captions into ADF `caption` nodes.** ADF has a `caption` node inside `mediaSingle`
> and Jira happily stores it (the API returns 200 and a GET shows it), but Jira **never renders it in
> comments** — it is a Confluence-only feature. That is why captions are emitted as a separate
> italic (`em`) paragraph right after the image.

## Library usage

The package re-exports `JiraClient` plus all the domain types so you can drive Jira directly from your own TypeScript:

```ts
import { JiraClient, loadProfile } from 'jirallm';

const { config, apiToken } = await loadProfile({ org: 'acme' });
const client = new JiraClient(config, apiToken);

// Search (single page; pass nextPageToken for the next one)
const page = await client.searchIssues('project = PROJ AND statusCategory != Done', {
  fields: ['summary', 'status'],
  limit: 50,
});

// Create + comment
const created = await client.createIssue({
  projectKey: 'PROJ',
  issueType: 'Task',
  summary: 'Investigate flaky test',
  descriptionMarkdown: '**Repro**\n\n1. step\n2. step',
});
await client.addComment(created.key, 'Auto-filed from triage script.');
```

See `examples/` for runnable scripts:

- `examples/search-my-issues.ts` — paginated JQL
- `examples/create-bug.ts` — create + comment
- `examples/board-snapshot.ts` — boards → sprints → issues

## Platform support

Native binaries (via [`@napi-rs/keyring`](https://www.npmjs.com/package/@napi-rs/keyring)) ship prebuilt — no compile step on install.

- **macOS** (arm64, x64) — fully supported. Tokens stored in macOS Keychain.
- **Linux** (x64, arm64, arm, riscv64; glibc and musl) — fully supported. Tokens stored via Secret Service (`libsecret`); requires a running keyring daemon (e.g. `gnome-keyring` or KWallet). Headless servers without a keyring backend will fail the keychain step in `jirallm doctor`.
- **Windows** (x64, arm64, ia32) — fully supported. Tokens stored in Windows Credential Manager. `ffmpeg` must be on `PATH` for video frame extraction.
- **FreeBSD** (x64) — keychain works; other features untested.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines, and please follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Security

Found a vulnerability? Please follow the disclosure process in [SECURITY.md](./SECURITY.md).

## License

MIT — see [LICENSE](./LICENSE). Authored by [Dominik Rycharski](https://github.com/doryski).

### Third-party tools

`jirallm` invokes [`ffmpeg`](https://ffmpeg.org/) as an external process to extract video frames. **`jirallm` does not distribute or bundle `ffmpeg` or any codec binaries.** Users install `ffmpeg` themselves (via system package manager, or via `jirallm setup --bundled`, which installs the [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static) npm package globally on the user's machine). `ffmpeg` and its codecs are governed by their own licenses (LGPL/GPL) and may carry codec patent obligations (H.264, HEVC, AAC, etc.) depending on jurisdiction and usage. The end user is responsible for compliance with those licenses and any applicable patent licensing.
