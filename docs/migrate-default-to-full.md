# Migrating a `default` project to `full`

`nextellar upgrade` only reconciles a project against **newer files of the
same template**, it reads `.nextellar/config.json`'s `template` field and
diffs against that template's current source, but it never switches a
project from one template to another. There is no CLI command for a
`default` → `full` migration; this guide walks through doing it by hand.

`full` is `default` plus two things, applied as overlays at scaffold time
(see `src/lib/templates.ts`'s `full` entry): the `CounterDemo` component
(ported from `defi`'s Soroban demo) wired into the landing page, and the
contracts overlay (`--with-contracts`), always on. Migrating means adding
both to an existing `default` project.

## 1. Add the contracts overlay

If you didn't scaffold with `--with-contracts`, you're missing the files
`full`'s `CounterDemo` depends on. Copy these from a fresh `full` (or
`defi --with-contracts`) scaffold, or from this repo's
`src/templates/contracts-template/`, into your project:

```
contracts/                       # Cargo workspace: hello_world + counter example contracts
src/lib/bindings/Counter.ts
src/lib/bindings/HelloWorld.ts
src/lib/contracts/index.ts       # exports CONTRACTS, CounterClient, HelloWorldClient, validateContracts
```

Add the two contract-id environment variables these expect
(`src/lib/contracts/index.ts` falls back to an invalid placeholder if
unset, see `validateContracts()`):

```bash
# .env.local
NEXT_PUBLIC_HELLO_WORLD_CONTRACT_ID=C...
NEXT_PUBLIC_COUNTER_CONTRACT_ID=C...
```

If you don't already have a deployed `counter` contract, build and deploy
the one in `contracts/counter/` (see `SOROBAN_SETUP.md` alongside it) and
set `NEXT_PUBLIC_COUNTER_CONTRACT_ID` to the resulting contract ID.

## 2. Add the `CounterDemo` component

Copy `src/components/CounterDemo.tsx` (or `CounterDemo.jsx` for a
JavaScript project, see `src/templates/js-full/`) from `full`'s overlay
into your project's `src/components/`. It only depends on `useSorobanContract`
(already present in `default`) and `CounterClient`/`CONTRACTS` from the
contracts overlay you just added in step 1, nothing else needs to change
for it to compile.

## 3. Wire it into the landing page

`full`'s only change to `src/app/page.tsx` versus `default` is this:

```diff
+ import CounterDemo from '../components/CounterDemo';
  ...
-   <h1 className="sr-only">Nextellar Starter — Stellar wallet integration for Next.js</h1>
+   {/* CounterDemo renders the page's own <h1>, so default's sr-only heading is omitted. */}
+   <div className="mb-16">
+     <CounterDemo />
+   </div>
```

`CounterDemo` renders its own `<h1>Counter Contract Demo</h1>`, which is why
`default`'s screen-reader-only landing-page heading is removed rather than
kept alongside it (leaving both would give the page two top-level
headings). Drop `CounterDemo` wherever else makes sense for your layout if
you don't want it on the landing page at all; the component itself has no
dependency on where it's rendered.

## 4. (Optional) Storybook story and mock

If your project uses Storybook, `full` also ships
`src/components/CounterDemo.stories.tsx` and a Storybook-only mock
(`.storybook/mocks/contracts.ts`) so the story doesn't need a real deployed
contract or live RPC connection. Copy both if you want the story; skip them
entirely if you don't use Storybook in this project.

## 5. Record the template change (optional)

`nextellar upgrade` will keep diffing against `default` until
`.nextellar/config.json`'s `template` field says otherwise. If you want
future `nextellar upgrade` runs to compare against `full` instead, update
that field by hand:

```diff
  {
    "nextellarVersion": "...",
-   "template": "default",
+   "template": "full",
    "createdAt": "..."
  }
```

This is optional, nothing breaks if you leave it as `default`, but future
`nextellar upgrade` runs will then only ever offer you `default`'s upstream
changes, not `full`'s (e.g. `CounterDemo` improvements), since `upgrade`
has no way to know the project now also carries `full`'s overlay.

## What you don't need to change

Everything else in `full` is identical to `default`: same `WalletProvider`,
same hooks, same other components, same `package.json` dependencies (the
contracts overlay adds no new npm dependencies, only source files and env
vars). There's no dependency bump or config-schema change involved in this
migration beyond what's covered above.
