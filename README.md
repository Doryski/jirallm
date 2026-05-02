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

[orgs.acme.projects.CORE]
output_dir = "~/jira/acme/core"

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
const { config, apiToken, org, project } = await loadProfile({ org: 'acme', project: 'CORE' });

const exporter = new JiraExporter(config, apiToken);

const result = await exporter.exportIssues(['CIT-123'], {
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

## Platform support

- macOS — fully supported
- Linux — fully supported
- Windows — should work; `ffmpeg` must be on `PATH`

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup and guidelines, and please follow our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Security

Found a vulnerability? Please follow the disclosure process in [SECURITY.md](./SECURITY.md).

## License

MIT — see [LICENSE](./LICENSE). Authored by [Dominik Rycharski](https://github.com/doryski).

### Third-party tools

`jirallm` invokes [`ffmpeg`](https://ffmpeg.org/) as an external process to extract video frames. **`jirallm` does not distribute or bundle `ffmpeg` or any codec binaries.** Users install `ffmpeg` themselves (via system package manager, or via `jirallm setup --bundled`, which installs the [`ffmpeg-static`](https://www.npmjs.com/package/ffmpeg-static) npm package globally on the user's machine). `ffmpeg` and its codecs are governed by their own licenses (LGPL/GPL) and may carry codec patent obligations (H.264, HEVC, AAC, etc.) depending on jurisdiction and usage. The end user is responsible for compliance with those licenses and any applicable patent licensing.
