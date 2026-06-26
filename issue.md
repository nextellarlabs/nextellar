#514 Create collection floor price route in routes-d/routes
Repo Avatar
nextellarlabs/nextellar
Summary
Return the current floor price for an NFT collection through a route inside routes-d/routes.

Requirements
Add routes-d/routes/nfts.floor.get.ts handling GET /nfts/floor
Compute from active listings with documented heuristics
Cache briefly to absorb spikes
Tests cover normal, sparse market, and missing collection
Scope
The primary route handler MUST live at routes-d/routes/.ts
Supporting helpers may go in routes-d/lib/ only when justified, but the route file itself stays under routes-d/routes/
Add tests under routes-d/tests/
Do not modify or add code outside the routes-d/ folder
Use TypeScript and ESM consistent with the rest of the Nextellar codebase
Acceptance Criteria
The new route file exists under routes-d/routes/
Files compile and any new tests pass
No regressions in CI

#517 Create anchor fee schedule route in routes-d/routes
Repo Avatar
nextellarlabs/nextellar
Summary
Return the fee schedule for deposits and withdrawals at an anchor through a route inside routes-d/routes.

Requirements
Add routes-d/routes/anchors.fees.ts handling GET /anchors/:id/fees
Source via SEP-24 fee endpoints when available
Cache results briefly
Tests cover known fees, missing fees, and unknown anchor
Scope
The primary route handler MUST live at routes-d/routes/.ts
Supporting helpers may go in routes-d/lib/ only when justified, but the route file itself stays under routes-d/routes/
Add tests under routes-d/tests/
Do not modify or add code outside the routes-d/ folder
Use TypeScript and ESM consistent with the rest of the Nextellar codebase
Acceptance Criteria
The new route file exists under routes-d/routes/
Files compile and any new tests pass
No regressions in CI

#500 Create market depth route in routes-d/routes
Repo Avatar
nextellarlabs/nextellar
Summary
Return depth-of-book for a Stellar DEX market through a route inside routes-d/routes.

Requirements
Add routes-d/routes/defi.market.depth.ts handling GET /defi/market/:pair/depth
Validate the asset pair format strictly
Cap depth with a configurable maximum
Tests cover normal book, thin book, and unknown pair
Scope
The primary route handler MUST live at routes-d/routes/.ts
Supporting helpers may go in routes-d/lib/ only when justified, but the route file itself stays under routes-d/routes/
Add tests under routes-d/tests/
Do not modify or add code outside the routes-d/ folder
Use TypeScript and ESM consistent with the rest of the Nextellar codebase
Acceptance Criteria
The new route file exists under routes-d/routes/
Files compile and any new tests pass
No regressions in CI

#515 Create anchors list route in routes-d/routes
Repo Avatar
nextellarlabs/nextellar
Summary
List the on-ramp and off-ramp anchors that Nextellar supports through a route inside routes-d/routes.

Requirements
Add routes-d/routes/anchors.list.ts handling GET /anchors
Source from a curated config with periodic refresh
Filter by supported flow and region
Tests cover full list, region filter, and unknown filter rejection
Scope
The primary route handler MUST live at routes-d/routes/.ts
Supporting helpers may go in routes-d/lib/ only when justified, but the route file itself stays under routes-d/routes/
Add tests under routes-d/tests/
Do not modify or add code outside the routes-d/ folder
Use TypeScript and ESM consistent with the rest of the Nextellar codebase
Acceptance Criteria
The new route file exists under routes-d/routes/
Files compile and any new tests pass
No regressions in CI

