#!/bin/bash

# This script applies branch protection rules to the main branch of nextellarlabs/nextellar.
# It requires:
#   - GitHub CLI (gh) installed and authenticated
#   - Repository admin rights to nextellarlabs/nextellar
#
# Usage: ./scripts/apply-branch-protection.sh

set -e

# Required status check names (verified from .github/workflows/ci.yml and API)
CONTEXTS=(
  "Lint and format"
  "Coverage threshold gate"
  "Build and verify package"
  "E2E — default scaffold + next build"
  "E2E — minimal scaffold + next build"
  "npm pack size guard"
  "Lighthouse CI — default scaffold"
  "Visual regression — default template Storybook"
)

# Convert array to JSON array format
CONTEXTS_JSON=$(printf '%s\n' "${CONTEXTS[@]}" | jq -R . | jq -s .)

# Apply branch protection via GitHub API
gh api -X PUT repos/nextellarlabs/nextellar/branches/main/protection \
  -f required_status_checks="{\"strict\":true,\"contexts\":$CONTEXTS_JSON}" \
  -f enforce_admins=true \
  -f required_pull_request_reviews="{\"required_approving_review_count\":1}" \
  -f restrictions=null

echo "Branch protection applied successfully."
echo "Required status checks: ${CONTEXTS[*]}"
