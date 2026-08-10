# Top Assets Leaderboard

## Summary

Add `GET /assets/top` endpoint that computes and serves a top-assets leaderboard ranked by volume over rolling time windows.

## Changes

- **`routes-d/lib/volumeRollup.ts`** — Volume computation module with in-memory trade store, configurable windows (24h, 7d, 30d), and result caching with 30s TTL. Exports `recordTrade`, `getTopAssets`, and test helpers (`__resetTrades`, `__seedTrade`, `__clearCache`, `__getCacheSize`).

- **`routes-d/routes/assets.top.ts`** — `GET /assets/top` endpoint supporting `window` query param (`24h` default, `7d`, `30d`). Returns ranked assets with `volume`, `tradeCount`, and `lastPrice`.

- **`routes-d/tests/unit/volumeRollup.test.ts`** — Unit tests covering:
  - Empty trades returns empty assets
  - Assets ranked by volume descending
  - Window filtering for 24h, 7d, and 30d
  - `lastPrice` set to most recent trade price per asset
  - Multiple assets with varying trade counts
  - Cache retains result within TTL
  - Cache recomputes after `__clearCache`
  - `recordTrade` clears all caches
  - Each window cached independently
  - `__resetTrades` clears caches

- **`routes-d/tests/assets.top.test.ts`** — Route integration tests covering:
  - Authentication (401 when `x-user-id` missing)
  - Default window (24h)
  - Invalid window validation (400)
  - Each valid window (`24h`, `7d`, `30d`)
  - Response shape (success, data, assets array)
  - `generatedAt` timestamp
  - Empty assets when no trades exist

## Testing

Tests follow the existing routes-d pattern (`supertest` + `express`, `buildApp()`, `beforeEach` reset, `__seed*` helpers).

```bash
npm test -- routes-d/tests/unit/volumeRollup.test.ts routes-d/tests/assets.top.test.ts
```

closes #385
