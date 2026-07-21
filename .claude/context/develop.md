# develop context

- **Base branch:** `main`
- **Ship depth:** PR + merge (squash, delete branch). Every change lands via a PR that closes its issue with `Closes #N`.
- **CI:** `.github/workflows/ci.yml` runs build, lint, type-check, test on Node 20 & 22. Mirror these locally as the gate; there is no `format:check` job.
- **Issue tracker:** GitHub — `Doryski/jirallm` (use `gh`, never WebFetch).
- **Do not add evidence files to PRs.** Do not create or commit anything under `.github/pr-evidence/` (or any in-repo evidence dir). Keep run evidence local and gitignored only. PR descriptions/comments should describe the change and test results in text, not link committed evidence files.
