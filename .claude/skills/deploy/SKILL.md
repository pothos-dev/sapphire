---
name: deploy
description: Cut a new release of Sapphire. Bumps the version across all manifests, updates CHANGELOG.md, commits, tags, and pushes — the pushed tag triggers the GitHub Actions release workflow that builds installers for Linux, macOS, and Windows. Use when the user runs /deploy or asks to release/ship/cut a new version.
---

# /deploy

Cuts a new Sapphire release. The release artifacts (Linux `.deb`/`.AppImage`, macOS `.dmg`, Windows `.msi`/`.exe`) are built by `.github/workflows/release.yml`, which runs on every pushed `v*` tag via `tauri-action`. This skill's job is to bump the version, write the changelog, and push the tag that triggers that build.

## When to invoke

Only on explicit user request (`/deploy`, "deploy", "cut a release", "ship a new version"). Never run as a side effect of other work.

## Preconditions — verify before doing anything

1. **On `main` and clean.** Run `git status` and `git rev-parse --abbrev-ref HEAD`. If the branch is not `main` or there are uncommitted changes (other than test-screenshot churn the user explicitly waves through), stop and tell the user. Do not stash or auto-commit unrelated work.
2. **`main` is up to date with `origin/main`.** `git fetch origin` then `git rev-list --left-right --count origin/main...main`. If `origin` is ahead, stop. If `main` is ahead, that's fine — those commits ship in this release and get pushed in Phase 4.
3. **The release workflow exists.** Confirm `.github/workflows/release.yml` is present. If missing, stop — there is nothing to trigger.

If any precondition fails, stop and report — do not try to "fix it up" silently.

## Phase 1 — Choose the version bump

Read the current version from `package.json` (`.version`). Get the latest tag with `git describe --tags --abbrev=0` (may be absent on the first release).

Ask the user via `AskUserQuestion` which bump to apply:

- **Patch** (X.Y.Z → X.Y.Z+1) — bugfixes only
- **Minor** (X.Y.Z → X.Y+1.0) — new features, backwards-compatible
- **Major** (X+1.0.0) — breaking changes

Compute the new version and confirm it back in plain text before proceeding (e.g. "Bumping 0.9.0 → 0.10.0").

## Phase 2 — Summarize changes for the CHANGELOG

Collect the commits since the last tag (or the full history on the first release):

```bash
git log --oneline <last-tag>..HEAD   # or: git log --oneline   (first release)
```

Group them into `### Added`, `### Changed`, `### Fixed`, `### Removed` based on commit messages. Skip purely internal commits (refactors with no user-visible effect, "fix typo", test-retry tweaks). Focus on user-visible behavior; when unsure, lean toward including.

Prepend a new section to `CHANGELOG.md` (Keep a Changelog style), using today's date in ISO format:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- ...

### Fixed
- ...
```

Show the user the drafted section and ask for confirmation/edits before committing. Edits often happen here — be ready to revise.

## Phase 3 — Bump, commit, tag

After the CHANGELOG is approved, set the new version in **all four** places (use `Edit`, not version-bump tooling, so the diff stays predictable):

1. `package.json` — `.version`
2. `src-tauri/tauri.conf.json` — `.version`
3. `src-tauri/Cargo.toml` — `[package] version`
4. `src-tauri/Cargo.lock` — the `version` under `[[package]] name = "sapphire"`

Keep all four in lockstep — a mismatch makes `tauri-action` produce wrongly-named artifacts. Do not run `bun install` (the lockfile doesn't change for a self-version bump).

Then:

5. Stage the four manifests and `CHANGELOG.md`.
6. Commit: `Release vX.Y.Z`.
7. Tag: `git tag vX.Y.Z` (note the `v` prefix — the workflow triggers on `v*`).

## Phase 4 — Push

Push the branch and the tag as **separate** commands so a failure is easy to attribute:

```bash
git push origin main
git push origin vX.Y.Z
```

The tag push is what starts the release build.

## Phase 5 — Hand off to GitHub Actions

Print this to the user, verbatim, with the version and repo filled in:

> Release **vX.Y.Z** pushed. GitHub Actions is now building installers for Linux, macOS (Intel + Apple Silicon), and Windows.
>
> Watch the run: https://github.com/pothos-dev/sapphire/actions
>
> When it finishes it creates a **draft** release at https://github.com/pothos-dev/sapphire/releases — review the assets, then publish it.

The release is created as a draft (`releaseDraft: true`) on purpose — the user publishes it manually after checking the artifacts.

## Failure handling

- If a push fails, do **not** delete the tag locally as "cleanup" — the user may want to retry. Report and stop.
- If the build fails after the tag is pushed, fix forward with a new patch tag; never rewrite or force-push an existing tag.
- If the user aborts mid-way (e.g. after the version bump but before push), leave local state as-is and tell them exactly what was done so they can resume or undo manually. Don't `reset --hard`.

## What this skill never does

- Never force-pushes `main` or any tag.
- Never amends or rewrites an existing tag.
- Never runs the Tauri build locally — that happens in GitHub Actions.
- Never edits CHANGELOG entries for previously released versions.
