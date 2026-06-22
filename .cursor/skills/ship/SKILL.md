---
name: ship
description: >-
  Bump the CoScripter3 version (minor), commit all pending changes to main, and push.
  Use when the user says "ship", "ship it", or "bump the version number, commit
  and push". This does NOT upload to the Chrome Web Store — that is a separate flow.
---

# Ship

Bump the version, commit to `main`, and push. Solo-developer flow: commit
directly to `main`, no branches/PRs/tags.

## Steps

1. **Summary**: if the user didn't give one, ask for a short release summary
   (used in the commit message `version X.Y.Z: <summary>`).

2. **Bump level**: default is **minor** (e.g. `0.1.0 → 0.2.0`). Use `--major`
   only if the user asks or there is a breaking change. Use `--patch` for
   bug-fix-only releases. Use `--version X.Y.Z` when the user specifies explicitly.

3. **Bump the version** in `manifest.json`:

```bash
python3 scripts/bump-version.py
```

   Read the script output for `$NEW` before committing (`next: X.Y.Z`).

   For a major bump: `python3 scripts/bump-version.py --major`.
   For a patch bump: `python3 scripts/bump-version.py --patch`.
   For an explicit version: `python3 scripts/bump-version.py --version X.Y.Z`.

4. **Commit everything** (the code changes plus the version bump) in one commit
   on `main`, then push:

```bash
git add -A
git commit -m "version $NEW: <summary>"
git push origin main
```

5. **Report** the new version and confirm the push to `origin main`.

## Notes

- Stay on `main`. If somehow on another branch, move the work to `main` rather
  than opening a PR.
- No git tag (lightweight ship flow — tags are for formal versioned releases).
- The version lives only in `manifest.json`; no other files need syncing.
