# feat: add routes for NFT floor price, anchor fees, anchor list, and market depth

Closes #514, #517, #500, #515

## Changes

Four new route handlers and their test suites under `routes-d/`:

- `routes-d/routes/nfts.floor.get.ts` — `GET /nfts/floor` (#514)
- `routes-d/routes/anchors.fees.ts` — `GET /anchors/:id/fees` (#517)
- `routes-d/routes/anchors.list.ts` — `GET /anchors` (#515)
- `routes-d/routes/defi.market.depth.ts` — `GET /defi/market/:pair/depth` (#500)

Each route follows existing codebase conventions: Express Router, `sendError` from `lib/response.ts`, TTL-based in-memory caching, strict input validation, and exported `__` test helpers. Corresponding test files live under `routes-d/tests/`.

## Testing

All files pass TypeScript diagnostics with zero errors. Tests cover normal cases, edge cases (sparse/empty data), invalid inputs, unknown resources, and cache hit behaviour.
