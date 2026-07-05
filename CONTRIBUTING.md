# Contributing to jirallm

Thanks for considering a contribution! This document explains how to get a working dev environment and how to propose changes.

By participating in this project you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## Ways to contribute

- Report a bug using the [bug report template](./.github/ISSUE_TEMPLATE/bug_report.md)
- Propose an enhancement using the [feature request template](./.github/ISSUE_TEMPLATE/feature_request.md)
- Improve documentation
- Submit a pull request that fixes a bug or implements an accepted feature

For non-trivial changes, please open an issue first so we can discuss the approach before you invest time in code.

## Development setup

Prerequisites:

- Node.js >= 20
- [pnpm](https://pnpm.io/) (recommended) or npm
- `ffmpeg` on your `PATH` if you want to test video frame extraction

Clone and install:

```bash
git clone https://github.com/doryski/jirallm.git
cd jirallm
pnpm install
```

Build:

```bash
pnpm build       # one-shot
pnpm dev         # tsc --watch
```

Run the CLI from your local checkout:

```bash
node dist/cli/index.js PROJ-123 --output-dir ./jira-export
```

Set up credentials by running `node dist/cli/index.js init` (writes `~/.config/jirallm/config.toml` and stores the API token in your OS keychain). For one-off runs you can also bypass the keychain by passing `--base-url`, `--user-email`, and `--api-token` directly on the command line. Use a personal sandbox project — never commit real ticket content.

## Coding guidelines

- TypeScript strict mode; prefer type inference and `type` aliases over `interface`
- ESM only — use `.js` import specifiers in source as required by Node ESM
- Keep functions small, pure, and composable; avoid hidden globals
- Do not log secrets, tokens, or raw issue payloads from third parties
- Follow the existing folder structure (`src/lib`, `src/cli`)

## Pull request process

1. Fork the repo and create a feature branch from `main` (e.g. `feat/jql-pagination`)
2. Make your changes in focused commits with clear messages
3. Run `pnpm build` and verify the CLI still works end-to-end against a real issue
4. Update `README.md` and `CHANGELOG.md` (if present) when behavior changes
5. Open a PR using the [pull request template](./.github/PULL_REQUEST_TEMPLATE.md) and describe the motivation and trade-offs
6. Be ready to iterate on review feedback

## Releasing (maintainers)

Releases are automated via `.github/workflows/release.yml`, triggered when a `v*.*.*` tag is pushed.

1. Update `CHANGELOG.md` — move entries from `[Unreleased]` into a new dated section, commit on the default branch
2. Run `pnpm release` — this runs `doryski-release` (from the `@doryski/release` dev dependency), which bumps `package.json`, commits, creates the `vX.Y.Z` tag, and pushes both the branch and the tag to trigger the CI publish workflow
   - Defaults to a patch bump of the latest tag; pass `--release-version 1.2.0` for anything else
   - `--dry-run` previews without changes; `--yes` skips the confirmation prompt
3. The release workflow then verifies the tag matches `package.json`, builds, runs tests via `prepublishOnly`, publishes to npm with provenance, and creates a GitHub Release with auto-generated notes

A repository secret named `NPM_TOKEN` (an npm automation token with publish access) is required for npm publishing to succeed.

## Reporting security issues

Please do **not** open a public issue for security vulnerabilities. Follow the process in [SECURITY.md](./SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
