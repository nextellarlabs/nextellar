# Port Sep24InteractiveFrame component to the defi template

## Summary
The `default` template ships a `Sep24InteractiveFrame` component for embedding SEP-24 anchor interactive deposit/withdraw pages. The `defi` template did not have this component, even though both templates share most of the same UI surface.

## Changes
Added three files to the defi template:
- `src/templates/defi/src/lib/sep24.ts` — SEP-24 client helpers (`assertSafeInteractiveUrl`, `discoverSep24TransferServer`, `startSep24Interactive`, `buildSep24InteractiveUrl`, `fetchSep24Transaction`, `parseSep24Message`, status utilities)
- `src/templates/defi/src/components/Sep24InteractiveFrame.tsx` — React component that safely embeds anchor interactive URLs in a sandboxed iframe with optional close button
- `src/templates/defi/src/components/Sep24InteractiveFrame.stories.tsx` — Storybook stories (Default, WithCloseButton, UnsafeUrlRendersNothing)

All files mirror the `default` template versions exactly.

## Acceptance Criteria
- ✅ `src/templates/defi/src/components/Sep24InteractiveFrame.tsx` exists and mirrors the default template's version
- ✅ A `.stories.tsx` file is included matching the default sibling

## Testing
Run the Storybook preview in the defi template to verify the component renders correctly:
```bash
cd src/templates/defi
npm run storybook
```