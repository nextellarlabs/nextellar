# Backend Migration Guide (#684)

This document outlines the manual steps required to complete the migration of `backend/` and `routes-d/` to a separate repository.

## Status

- ✅ **CLI repo cleaned**: `backend/` and `routes-d/` have been removed from the main nextellar CLI repository
- ✅ **Documentation updated**: README now points to the new backend repo location
- ⏳ **Backend repo**: Needs to be created and populated (manual GitHub steps required)

## What Was Moved

### backend/ (Express API)
- Authentication & token management (`auth/token.ts`, `auth/totpService.ts`)
- Middleware layer (CORS, CSRF, auth, session, error handling, idempotency, request IDs)
- API routes (checkout, payments, orders, dashboard, notifications, etc.)
- WebSocket support for notifications
- Test suite (`__tests__/`)
- ~40 files total

### routes-d/ (Stellar Wave Contributor Routes)
- ~150 route handler files from the Stellar Wave contributor program
- Comprehensive test suite (unit, integration, and E2E tests)
- Helper libraries for common patterns (crypto, file uploads, email, PDF generation, etc.)
- Documentation for specific features and deprecation policies
- ~300 files total

## Next Steps (Manual)

### Step 1: Create Repository on GitHub

Create a new public repository at `nextellarlabs/nextellar-backend` with:
- **Description**: "Express backend API and Stellar Wave contributor routes for Nextellar"
- **Public visibility**
- MIT License (copy from main repo)
- No initial files (don't auto-generate README, .gitignore, LICENSE)

### Step 2: Push Filtered History

A filtered clone has been prepared at `c:\Users\USER\Desktop\Nextellar\nextellar-backend-temp/` containing:
- Complete git history for backend/ and routes-d/
- All original commit authors and dates preserved
- Ready to push to the new repository

Commands to run:

```bash
cd c:\Users\USER\Desktop\Nextellar\nextellar-backend-temp

# Add new remote
git remote set-url origin https://github.com/nextellarlabs/nextellar-backend.git

# Push all history
git push -u origin main

# Verify
git log --oneline | head -20
```

### Step 3: Set Up Backend Repository

After pushing, configure the new repo:

1. **Branch protection**: Protect `main` branch, require PR reviews
2. **CI/CD**: Copy relevant workflows from main nextellar repo (adjust paths)
3. **Issue templates**: Copy from main repo
4. **Labels**: Create appropriate labels (routes-d, backend, stellar-wave, etc.)
5. **Documentation**:
   - Create comprehensive README explaining the repo structure
   - Link back to main Nextellar CLI repo
   - Document the Stellar Wave contributor process

### Step 4: Transfer Issues

The ~61 open routes-d related issues need to be manually transferred:

1. Create corresponding issues in nextellar-backend with:
   - Same title and description
   - Link to original issue for context
   - Appropriate labels
   - Assign to relevant maintainers

2. Close original issues in main repo with comment:
   ```
   This issue has been moved to https://github.com/nextellarlabs/nextellar-backend/issues/XXX
   ```

### Step 5: Update Main Repo References

After backend repo is live:

1. Add nextellar-backend to organization README/docs
2. Update CONTRIBUTING.md with pointer to backend repo
3. Mark routes-d/backend issues in main repo as "moved"
4. Update GitHub org pages if needed

## Verification Checklist

- [ ] nextellar-backend repo created and public
- [ ] Full git history pushed (verify with `git log`)
- [ ] CI workflows operational in new repo
- [ ] README and documentation complete
- [ ] Issues transferred to new repo
- [ ] Main repo builds successfully without backend/ and routes-d/
- [ ] Main repo issues reduced to >50% CLI-related
- [ ] Links in both READMEs working correctly

## Rollback

If needed, the main nextellar repo can be restored from git history:

```bash
# Restore deleted directories (only before pushing if urgent)
git revert <commit-hash>
```

However, once the backend repo is live, deletion from main should be permanent.

## Files Modified in Main Repo

- `README.md` - Added Backend & Stellar Wave Routes section with link
- `package.json` - Updated lint/format scripts to exclude backend/routes-d
- `backend/`, `routes-d/` - Completely removed

## References

- Issue: #684
- Related: #200 (moved to backend repo)
- Stellar Wave: https://github.com/nextellarlabs/stellar-wave

---

**Created**: August 30, 2026  
**Status**: Awaiting GitHub repo creation and manual push
