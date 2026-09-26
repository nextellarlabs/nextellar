# Testing Guide for Generated Apps

## What actually ships (correcting a common assumption)

Every Nextellar template (`default`, `defi`, `minimal`, `js-defi`, `js-template`)
ships **Storybook**, not Jest or React Testing Library. Check any generated
project's own `package.json` and you'll see:

```json
{
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build"
  }
}
```

There's no `test` script, no `jest.config.*`, no `vitest.config.*`. The
`.stories.tsx`/`.stories.jsx` files sitting next to most components (e.g.
`TransactionList.stories.tsx`, `SendForm.stories.tsx`) aren't just visual
documentation, they're this starter's real, working test layer:

- **`@storybook/addon-interactions`** and **`@storybook/addon-a11y`** are
  installed in every template's `.storybook/main.ts`.
- A story can define a **`play` function** that drives the component the same
  way a user would (click, type, submit) and Storybook runs it automatically
  in every browser tab that story is open in, failing the story if an
  assertion throws.
- `@storybook/test` re-exports the same `within`/`userEvent`/`expect`
  primitives Testing Library and Jest users already know, so this isn't a
  different testing mental model, just a different runner.

This guide is about how you write and extend that testing layer for your own
new components. (If your project genuinely needs Jest or Vitest in addition
to this, e.g. for testing plain business logic that isn't a React component,
see [Adding Jest or Vitest](#adding-jest-or-vitest-if-you-need-it) below.)

---

## Running the existing tests

```bash
npm run storybook
```

Opens Storybook locally. Every story with a `play` function runs its
interactions the moment that story is selected, and the **Interactions**
panel (bottom of the addon sidebar) shows each step and whether it passed.

To run every interaction test headlessly (e.g. in CI), use Storybook's test
runner:

```bash
npx storybook build
npx test-storybook --url http://localhost:6006
# or, against the static build directly:
npx concurrently -k -s first \
  "npx http-server storybook-static --port 6006 --silent" \
  "npx wait-on http://localhost:6006 && npx test-storybook --url http://localhost:6006"
```

(`test-storybook` isn't preinstalled by the scaffold; add it with
`npm install --save-dev @storybook/test-runner` the first time you want CI
coverage.)

---

## Writing a test for an existing component's story

Open `src/components/SendForm.stories.tsx` for a real, already-working
example. Each exported story is one scenario, and a `play` function is what
turns a static story into a test:

```tsx
/** Validation error — invalid address and negative amount both surface inline errors. */
export const ValidationError: Story = {
  decorators: [withMockWallet()],
  play: async ({ canvasElement }) => {
    const { within, userEvent } = await import('@storybook/test');
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('To'), 'not-a-valid-address');
    await userEvent.type(canvas.getByLabelText('Amount (XLM)'), '-5');
  },
};
```

- `canvasElement` is the story's rendered DOM root; `within(canvasElement)`
  scopes every query to it, exactly like `render(...)`'s returned `screen`
  does in Testing Library.
- `userEvent` fires real, sequenced user interactions (typing character by
  character, focus/blur, clicks) rather than firing a single low-level DOM
  event.
- The `import('@storybook/test')` is dynamic on purpose: it keeps the story
  file loadable in Storybook's docs view without pulling test-only code into
  every render.

To add an assertion (rather than just driving interactions), import `expect`
from the same module and assert against the canvas, the same way you would
with `@testing-library/jest-dom`:

```tsx
play: async ({ canvasElement }) => {
  const { within, userEvent, expect } = await import('@storybook/test');
  const canvas = within(canvasElement);
  await userEvent.type(canvas.getByLabelText('To'), 'not-a-valid-address');
  await userEvent.type(canvas.getByLabelText('Amount (XLM)'), '-5');
  await userEvent.click(canvas.getByRole('button', { name: /send/i }));

  expect(canvas.getByText(/invalid stellar address/i)).toBeInTheDocument();
  expect(canvas.getByRole('button', { name: /send/i })).toBeDisabled();
},
```

---

## Writing a test for a brand-new component

Say you've added `src/components/AssetBadge.tsx`, a small presentational
component with no story yet. The pattern is the same as every shipped
component: create a co-located `.stories.tsx` file, and give at least one
story a `play` function.

```tsx
// src/components/AssetBadge.tsx
export interface AssetBadgeProps {
  code: string;
  onClick?: () => void;
}

export default function AssetBadge({ code, onClick }: AssetBadgeProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Filter by ${code}`}
      className="rounded-full px-3 py-1 text-xs font-medium bg-gray-100 dark:bg-gray-800"
    >
      {code}
    </button>
  );
}
```

```tsx
// src/components/AssetBadge.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import AssetBadge from './AssetBadge';

const meta: Meta<typeof AssetBadge> = {
  title: 'Components/AssetBadge',
  component: AssetBadge,
};
export default meta;

type Story = StoryObj<typeof AssetBadge>;

export const Default: Story = {
  args: { code: 'USDC' },
};

/** Clicking the badge calls onClick exactly once. */
export const ClickFiresCallback: Story = {
  args: { code: 'USDC' },
  play: async ({ canvasElement, args }) => {
    const { within, userEvent, fn, expect } = await import('@storybook/test');
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Filter by USDC' }));
    expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};
```

For the `onClick` assertion to work, wire the story's `args.onClick` to a
spy (Storybook's `fn()`, re-exported from `@storybook/test`) in `meta.args`:

```tsx
const meta: Meta<typeof AssetBadge> = {
  title: 'Components/AssetBadge',
  component: AssetBadge,
  args: {
    onClick: () => {},
  },
};
```

Run `npm run storybook`, open `AssetBadge`, select `Click Fires Callback`, and
confirm the Interactions panel shows the click and the passing assertion.

---

## Testing a hook or plain function (no rendered component)

Not everything is a component. If you add a pure utility (say, an asset-code
formatter) or extend a hook like `useTransactionHistory`, a Storybook story
has nothing to render against. For this, add Jest or Vitest as described
below rather than forcing a story around logic that isn't UI.

## Adding Jest or Vitest if you need it

Neither ships by default, since most of a generated app's own code is UI
components already covered by the story pattern above. If your project adds
enough non-component logic to want a dedicated unit-test runner:

```bash
npm install --save-dev vitest @testing-library/react @testing-library/jest-dom jsdom
```

Add a minimal `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

and a `test` script in `package.json`:

```json
{
  "scripts": {
    "test": "vitest run"
  }
}
```

From there, `@testing-library/react`'s `render`/`screen`/`fireEvent` work the
same way they do in this repository's own test suite (see this repo's
[`tests/components/`](../tests/components) directory for real examples, if
you're curious how Nextellar itself is tested; those tests cover the CLI
generator and template source, not a generated project, but the
Testing-Library patterns transfer directly).

---

## Summary

| What you're testing | Use |
| --- | --- |
| A component's rendering, states, and user interactions | A story's `play` function (ships by default) |
| Accessibility issues | `@storybook/addon-a11y`'s panel, already installed |
| A pure function or non-component hook logic | Add Vitest or Jest yourself (see above) |
