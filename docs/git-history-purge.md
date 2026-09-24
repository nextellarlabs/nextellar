# Git History Blob Purge Guide (`node_modules` & `dist`)

To reduce repository clone size (from ~100MB+ down to minimal size), tracked `node_modules` and `dist` build output blobs were purged from historical commits.

## History Cleanup Steps

1. **Prerequisites**: Install `git-filter-repo` (e.g. `pip install git-filter-repo`).
2. **Purge Command**:
   ```bash
   git filter-repo --invert-paths --path-match "node_modules" --path-match "dist" --force
   ```
3. **Garbage Collection**:
   ```bash
   git reflog expire --expire=now --all
   git gc --prune=now --aggressive
   ```
4. **Coordinated Force-Push**:
   Maintainers execute a single coordinated force push across active default branches (`main`, `dev`).
5. **Fresh Clone Verification**:
   ```bash
   git clone --depth 1 https://github.com/nextellarlabs/nextellar.git
   du -sh nextellar/.git
   ```

## Guidelines for Contributors

- Never stage or track `node_modules` or `dist` directories in Git.
- Ensure `.gitignore` continuously excludes `**/node_modules/` and `**/dist/`.
