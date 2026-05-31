# Refreshing Horizon Fixture Snapshots

The fixture files under `routes-d/tests/fixtures/` pin the exact response
shapes that the Horizon contract tests assert against. When Horizon's API
evolves, or when you want to capture a response from a different network,
run the refresh script below.

## When to Refresh

- After a Horizon API version bump that changes response fields.
- When switching the test account to a different address.
- When adding a new fixture for a new endpoint.

## Refresh Script

Run from the **repo root**:

```bash
#!/usr/bin/env bash
# refresh-horizon-fixtures.sh
# Pulls live responses from Horizon Testnet and writes them to fixtures/.

set -euo pipefail

ACCOUNT="${TEST_ACCOUNT:-GABCDE1234567890ABCDE1234567890ABCDE1234567890ABCDE12345678}"
HORIZON="${HORIZON_URL:-https://horizon-testnet.stellar.org}"
OUT="routes-d/tests/fixtures"

echo "Refreshing fixtures for account: $ACCOUNT"
echo "Horizon endpoint: $HORIZON"

curl -sS -H "Accept: application/json" \
  "$HORIZON/accounts/$ACCOUNT" \
  | jq . > "$OUT/horizon.accounts.json"
echo "✓ horizon.accounts.json"

curl -sS -H "Accept: application/json" \
  "$HORIZON/accounts/$ACCOUNT/payments?limit=10&order=desc" \
  | jq . > "$OUT/horizon.payments.json"
echo "✓ horizon.payments.json"

curl -sS -H "Accept: application/json" \
  "$HORIZON/accounts/$ACCOUNT/operations?limit=10&order=desc" \
  | jq . > "$OUT/horizon.operations.json"
echo "✓ horizon.operations.json"

echo "Done. Commit the updated fixtures and re-run the contract tests."
```

### Usage

```bash
# Default: uses the fixture account on Testnet
bash scripts/refresh-horizon-fixtures.sh

# Custom account or network
TEST_ACCOUNT=GXYZ... HORIZON_URL=https://horizon.stellar.org \
  bash scripts/refresh-horizon-fixtures.sh
```

## After Refreshing

1. Run the contract tests to confirm the new fixtures pass:
   ```bash
   cd routes-d
   npm test -- --testPathPattern horizon.contract
   ```
2. Inspect any diffs in `git diff routes-d/tests/fixtures/` to understand
   what changed in the Horizon response shape.
3. Update any field-level assertions in `horizon.contract.test.ts` that
   reference specific values (amounts, IDs) that changed.
4. Commit both the fixture files and test changes together.

## Notes

- Never edit fixture files by hand — always regenerate from a real Horizon
  response so the contract stays authoritative.
- For Mainnet fixtures, set `HORIZON_URL=https://horizon.stellar.org` and
  use a funded Mainnet account.
- The `TEST_ACCOUNT` in the default fixtures is a placeholder; replace it
  with a real funded Testnet account if you need non-empty balance/payment
  data.