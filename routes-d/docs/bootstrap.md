# Cold-start bootstrap

`routes-d/lib/bootstrap.ts` keeps startup light by registering route descriptors eagerly and loading the Express route modules only when a caller resolves a route.

## Removed top-level imports

The bootstrap module avoids top-level imports of the pool deposit and ledger stream route modules. Those imports pull Express route factories into memory before a request path needs them. Instead, each registration stores a dynamic `loadHandler` function.

## Measurement

`createBootstrap` records `durationMs` immediately after route registration. Unit tests assert this path completes within a small budget so new registrations do not accidentally add expensive synchronous work to cold start.

Before this bootstrap helper, `routes-d` route modules were imported directly by callers and tests, so cold start included route construction as soon as the caller loaded the module. After this change, startup measures only descriptor registration, and route construction is deferred until `resolveRoute` is called for the requested handler.
