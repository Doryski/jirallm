# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in `jirallm`, please **do not** open a public issue. Instead, report it privately via [GitHub Security Advisories](https://github.com/doryski/jirallm/security/advisories/new).

You will receive a response within a reasonable timeframe. If the issue is confirmed, a patch will be released as soon as possible.

## Scope

Security-relevant areas include:

- Handling of Jira API tokens and credentials
- File-system writes during issue export (path traversal, etc.)
- Subprocess invocation (`ffmpeg`)
- Dependencies with known CVEs

## Best practices for users

- Never commit your `.env` or API tokens
- Use scoped Jira API tokens with minimum required permissions
- Review attachments before passing them to LLMs (they may contain secrets uploaded by other team members)

## Third-party binaries

`jirallm` invokes `ffmpeg` as an external process and does not redistribute it. `ffmpeg` is either user-installed (system package manager) or fetched on demand by the user via `jirallm setup --bundled`, which globally installs the `ffmpeg-static` npm package. Codec licensing (LGPL/GPL, H.264/HEVC/AAC patents) is the user's responsibility.
