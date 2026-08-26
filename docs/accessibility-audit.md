# Accessibility Audit — WCAG 2.1 AA (#946)

An audit of the scaffolded template UI (`src/templates/*`) against WCAG 2.1 AA, covering the shared wallet components, the theme/network controls, error handling, and the generated landing page across all five templates (`default`, `defi`, `minimal`, `js-template`, `js-defi`).

## Methodology

1. **Manual source review** of every component and page file under `src/templates/*/src/{components,app}`, checked against WCAG 2.1 AA success criteria (name/role/value, labeling, live regions, focus/keyboard operability, text alternatives, use of color).
2. **Automated regression tests** using [`jest-axe`](https://github.com/nickcolley/jest-axe) (axe-core) against real rendered output, in `tests/accessibility.test.tsx`. Run with `npm test -- tests/accessibility.test.tsx`.
3. Existing hand-written accessibility assertions in `tests/components/TransactionStatusBadge.test.tsx` and `tests/components/ErrorBoundary.test.tsx` were reviewed and left as-is — they already cover ground axe can't (e.g. "status is never conveyed by colour alone").

### Known limitations of this pass

- **Color contrast**: `jest-axe`/axe-core cannot reliably compute contrast ratios in `jsdom` (no real layout/paint engine), so `color-contrast` checks don't run here. The template palettes were spot-checked by eye but need verification with a real browser (e.g. axe-core via Playwright, or the browser DevTools contrast checker) against every theme × template combination before being treated as AA-verified.
- **Keyboard-only walkthroughs and screen reader testing** (NVDA/VoiceOver/JAWS) were not performed; the fixes below are based on ARIA/HTML semantics review, not a live assistive-technology session.
- **Coverage is scoped to components that render standalone.** `NetworkSwitcher` and `CounterDemo` depend on `WalletProvider`/Soroban contract clients that aren't mocked in this test suite (no existing `moduleNameMapper` entry for `../contexts/WalletProvider` or the `@/` path alias), so they were fixed by manual review but aren't covered by an automated axe test in this PR. `TransactionList`, `TransactionStatusBadge`, and `AccountSwitcher`/`WalletConnectButton` are covered, either by this PR's new tests or pre-existing ones.

## Findings and fixes applied

| Component / file | Issue | WCAG criterion | Fix |
|---|---|---|---|
| `WalletConnectButton` (all 5 templates) | `WalletIcon`/`LoaderIcon` SVGs had no `aria-hidden`, so some screen readers expose them as unlabeled graphics alongside the button's own text | 1.1.1 Non-text Content | Added `aria-hidden="true"` to both icons |
| `NetworkSwitcher` (default, defi, js-template) | The `<select>`'s only visible label (`"Network"`) is hidden below the `sm` breakpoint (`hidden sm:inline`), so on mobile the control has **no accessible name at all** | 4.1.2 Name, Role, Value / 1.3.1 Info and Relationships | Added `aria-label="Network"` directly on the `<select>`, independent of the responsive text label; hid the chevron icon from AT |
| `AccountSwitcher` (default) | Custom dropdown had no `aria-haspopup`/`aria-expanded`/`aria-controls` on the trigger, no `role="menu"`/`role="menuitem"` on the panel, the selected account was indicated by color/checkmark only (no `aria-current`), and there was no keyboard way to close the menu | 4.1.2 Name, Role, Value; 1.4.1 Use of Color; 2.1.1 Keyboard | Added full ARIA menu semantics, `aria-current="true"` on the active account, and an `Escape` key handler that closes the menu |
| `ErrorBoundary` (all 5 templates) | The "Show Details" / "Hide Details" button toggles a details region with no `aria-expanded`/`aria-controls` linkage | 4.1.2 Name, Role, Value | Added `aria-expanded` (reflecting state) and `aria-controls` pointing at the details region's new `id` |
| `CounterDemo` (defi) | The count display updates on every action with no live region, so screen reader users get no feedback after +/-/reset; the error banner wasn't announced; +/− buttons' only accessible name was the glyph itself, replaced by ambiguous `"..."` while loading | 4.1.3 Status Messages; 2.4.6 Labels or Instructions | Added `role="status" aria-live="polite"` to the count, `role="alert"` to the error banner, stable `aria-label`s on the action buttons independent of loading state, and `aria-busy` while a call is in flight |
| `page.tsx`/`page.jsx` landing page (all 5 templates) | The light/dark background `<Image>` is purely decorative (full-bleed, positioned behind real content) but had a descriptive `alt` (`"Light mode background"` / `"Dark mode background"`), so it was needlessly announced; the theme-toggle sun/moon icons weren't hidden from AT (the button already has `aria-label="Toggle theme"` so this was a minor consistency gap, not a violation); `default`/`minimal`/`js-template`/`js-defi` had **no heading at all** on the page (`defi`'s page gets one for free from `CounterDemo`'s own `<h1>`) | 1.1.1 Non-text Content; 1.3.1 Info and Relationships; 2.4.6 Headings and Labels | Set the background images' `alt=""`; hid the toggle icons from AT; added a visually-hidden (`sr-only`) `<h1>` identifying the page, with no visual design change |

Components already found to be in good shape and left unchanged: `TransactionList` and `TransactionStatusBadge` (both already used `aria-hidden` on decorative icons, `role="status"`/`role="alert"`, and paired every color-coded state with text — see the existing test suites), `ErrorBoundary`'s core fallback structure (proper `h1`, descriptive text), and the `example/[id]` demo page (correct heading hierarchy, semantic `<main>`).

## Verification

- `npx jest tests/accessibility.test.tsx` — 11 tests: `axe()` runs with zero violations against `ErrorBoundary` (TS and JS variants), `WalletConnectButton` (connected/disconnected), and `AccountSwitcher` (closed/open), plus targeted assertions for the ARIA toggle/menu/`aria-current`/Escape behavior described above.
- Existing suites (`tests/components/*`, `tests/templates-parity.test.ts`) re-run clean after these changes — no regressions.
- Manual review confirms no template's build output changes visually (all fixes are additive attributes, an `sr-only` heading, or empty `alt` text).

## Remediation backlog (not fixed in this PR)

Tracked here rather than silently dropped, since a full AA audit surfaces more than one PR should try to fix at once:

1. **Real-browser color contrast pass** for every theme × template combination (light/dark backgrounds, badge palettes, muted text like `text-gray-400`/`text-gray-500` on translucent backgrounds). Best done with Playwright + axe-core or a manual DevTools sweep, since `jsdom` can't compute this.
2. **Keyboard walkthroughs** of the full scaffold-and-run flow (tab order, focus visibility, no traps) in a real browser per template.
3. **Screen reader spot-checks** (VoiceOver/NVDA) of the wallet connect → account switch → send payment flow, to confirm the ARIA additions in this PR read the way they're intended to.
4. **Extend automated coverage** to `NetworkSwitcher` and `CounterDemo` by adding the missing test mocking infrastructure (a `moduleNameMapper`/mock for `../contexts/WalletProvider` and the `@/` path alias respectively), then adding them to `tests/accessibility.test.tsx`.
5. **`minimal` and `js-defi` templates** don't ship `NetworkSwitcher`/`AccountSwitcher` at all (by design — they're the intentionally reduced templates), so the fixes above don't apply there; worth a follow-up check whenever those components are added to a template.
