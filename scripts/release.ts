import { execSync, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Command } from "commander";

// `--version`/`-V` is reserved by commander for printing its own version, so
// we expose the release-target as `--release-version`.
const program = new Command()
  .name("release")
  .description("Bump package.json, tag, and push to trigger the npm release.")
  .option(
    "-r, --release-version <ver>",
    "release version (e.g. 0.2.0 or v0.2.0); defaults to a patch bump of the latest tag",
  )
  .option("-y, --yes", "skip the confirmation prompt", false)
  .option(
    "-n, --dry-run",
    "preview the actions without modifying files, committing, tagging, or pushing",
    false,
  )
  .helpOption("-h, --help", "show help");

const root = path.resolve(fileURLToPath(import.meta.url), "../..");
const PACKAGE_JSON = path.join(root, "package.json");

const sh = (cmd: string) => execSync(cmd, { encoding: "utf8" }).trim();

const parseSemver = (tag: string) => {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?$/.exec(tag);
  if (!match) return null;
  const [, major, minor, patch, prerelease] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease ?? null,
  };
};

type BumpType = "major" | "minor" | "patch";

const applyBump = (
  v: { major: number; minor: number; patch: number },
  type: BumpType,
) => {
  if (type === "major") return `v${v.major + 1}.0.0`;
  if (type === "minor") return `v${v.major}.${v.minor + 1}.0`;
  return `v${v.major}.${v.minor}.${v.patch + 1}`;
};

const getCommitsSince = (ref: string | null): string[] => {
  try {
    const range = ref ? `${ref}..HEAD` : "HEAD";
    const out = sh(`git log ${range} --format=%B%x00`);
    return out
      ? out
          .split("\0")
          .map((msg) => msg.trim())
          .filter(Boolean)
      : [];
  } catch {
    return [];
  }
};

// Derive the semver bump from conventional-commit messages since the last tag:
// a `!`-marked type or a `BREAKING CHANGE:` footer → major, any `feat` → minor,
// everything else (fix, chore, docs, …) → patch.
const determineBump = (commits: string[]): BumpType => {
  let bump: BumpType = "patch";
  const subjectRe = /^(\w+)(?:\([^)]*\))?(!)?:/;
  for (const msg of commits) {
    const subject = msg.split("\n")[0];
    const match = subjectRe.exec(subject);
    const breaking = match?.[2] === "!" || /^BREAKING CHANGE:/m.test(msg);
    if (breaking) return "major";
    if (match?.[1] === "feat") bump = "minor";
  }
  return bump;
};

const stripV = (tag: string) => (tag.startsWith("v") ? tag.slice(1) : tag);

const getRecentTags = () => {
  try {
    const out = sh("git tag --sort=-v:refname");
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
};

const readJson = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(file, "utf8")) as T;

// Preserve trailing newline so formatters stay happy.
const writeJson = async (file: string, data: unknown) => {
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
};

const updateVersionFile = async (file: string, newVersion: string) => {
  const json = await readJson<Record<string, unknown>>(file);
  if (json.version === newVersion) return false;
  json.version = newVersion;
  await writeJson(file, json);
  return true;
};

const ensureCleanTree = () => {
  const status = sh("git status --porcelain");
  if (status) {
    console.error(
      "\n✗ Working tree is not clean. Commit or stash changes first:\n",
    );
    console.error(status);
    process.exit(1);
  }
};

const ensureOnDefaultBranch = () => {
  const branch = sh("git rev-parse --abbrev-ref HEAD");
  if (branch !== "main" && branch !== "master") {
    console.warn(`\n⚠ You are on branch "${branch}", not main/master.`);
  }
  return branch;
};

const makeRunStep =
  (dryRun: boolean) => (label: string, cmd: string, args: string[]) => {
    if (dryRun) {
      console.log(`→ [dry-run] ${label}`);
      return;
    }
    console.log(`→ ${label}`);
    const result = spawnSync(cmd, args, { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  };

type Flags = { releaseVersion?: string; yes: boolean; dryRun: boolean };

const main = async () => {
  program.parse();
  const flags = program.opts<Flags>();

  ensureCleanTree();
  const branch = ensureOnDefaultBranch();

  const tags = getRecentTags();
  const pkg = await readJson<{ name: string; version: string }>(PACKAGE_JSON);

  console.log("\n📦 jirallm — release\n");
  console.log(`Package:           ${pkg.name}`);
  console.log(`Current branch:    ${branch}`);
  console.log(`package.json:      ${pkg.version}`);
  console.log(
    `Recent tags:       ${tags.length ? tags.slice(0, 5).join(", ") : "(none)"}`,
  );

  const latest = tags.find((t) => parseSemver(t));
  const latestParsed = latest ? parseSemver(latest) : null;

  const commitsSinceTag = getCommitsSince(latest ?? null);
  const bumpType = determineBump(commitsSinceTag);

  const proposed = latestParsed
    ? applyBump(latestParsed, bumpType)
    : `v${stripV(pkg.version)}`;

  console.log(
    `Commits since tag: ${commitsSinceTag.length} (${bumpType} bump)`,
  );
  console.log(`Proposed new tag:  ${proposed}\n`);

  const interactive = stdin.isTTY === true;
  const rl = interactive
    ? createInterface({ input: stdin, output: stdout })
    : null;

  const askVersion = async () => {
    if (flags.releaseVersion) {
      console.log(`Version (from --release-version):  ${flags.releaseVersion}`);
      return flags.releaseVersion;
    }
    if (!rl) return proposed;
    return (
      await rl.question(`Enter version (press Enter to accept ${proposed}): `)
    ).trim();
  };

  const askConfirm = async () => {
    if (flags.yes) {
      console.log(`Proceed? [y/N]  y  (from --yes)`);
      return true;
    }
    if (!rl) {
      console.error(
        "\n✗ Non-interactive run: pass --yes to skip the confirmation prompt.",
      );
      process.exit(1);
    }
    const ans = (await rl.question(`Proceed? [y/N] `)).trim().toLowerCase();
    return ans === "y" || ans === "yes";
  };

  const input = await askVersion();
  const chosen = input || proposed;

  const normalized = chosen.startsWith("v") ? chosen : `v${chosen}`;
  const bareVersion = stripV(normalized);

  if (!parseSemver(normalized)) {
    console.error(`\n✗ Invalid semver tag: ${normalized}`);
    rl?.close();
    process.exit(1);
  }

  if (tags.includes(normalized)) {
    console.error(`\n✗ Tag ${normalized} already exists.`);
    rl?.close();
    process.exit(1);
  }

  console.log(`\nThis will:`);
  console.log(`  1. Bump package.json   ${pkg.version}  →  ${bareVersion}`);
  console.log(`  2. Commit on ${branch}`);
  console.log(`  3. Tag ${normalized} and push ${branch} + tag`);
  console.log(`  4. GitHub Actions will build, test, and publish to npm\n`);

  if (flags.dryRun) console.log("Dry-run mode: no changes will be made.\n");

  const confirmed = await askConfirm();
  rl?.close();

  if (!confirmed) {
    console.log("Aborted.");
    process.exit(0);
  }

  const runStep = makeRunStep(flags.dryRun);

  if (flags.dryRun) {
    console.log(`→ [dry-run] would bump package.json to ${bareVersion}`);
  } else {
    const pkgChanged = await updateVersionFile(PACKAGE_JSON, bareVersion);
    if (!pkgChanged) {
      console.warn("\n⚠ package.json already at target version.");
    } else {
      runStep(`git add package.json`, "git", ["add", "package.json"]);
      runStep(`git commit -m "release: ${normalized}"`, "git", [
        "commit",
        "-m",
        `release: ${normalized}`,
      ]);
    }
  }

  runStep(`git tag ${normalized}`, "git", ["tag", normalized]);

  // Push the commit first so the tag resolves on the remote.
  runStep(`git push origin ${branch}`, "git", ["push", "origin", branch]);

  if (!flags.dryRun) {
    const pushTag = spawnSync("git", ["push", "origin", normalized], {
      stdio: "inherit",
    });
    if (pushTag.status !== 0) {
      console.error("\n✗ Tag push failed. Clean up local tag with:");
      console.error(`  git tag -d ${normalized}`);
      process.exit(pushTag.status ?? 1);
    }
  } else {
    runStep(`git push origin ${normalized}`, "git", [
      "push",
      "origin",
      normalized,
    ]);
  }

  if (flags.dryRun) {
    console.log(
      `\n✓ Dry-run complete. Re-run without --dry-run to actually release ${normalized}.`,
    );
    return;
  }

  console.log(
    `\n✓ Tag ${normalized} pushed. GitHub Actions will build, test, and publish to npm.`,
  );
  console.log(`  Watch: https://github.com/doryski/jirallm/actions`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
