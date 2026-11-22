# Visual regression baselines

One PNG per Storybook story of the `default` template, written by
`node scripts/visual-regression.mjs --storybook-dir <storybook-static> --update`.
See docs/visual-regression.md. Generate them on Linux (CI or the Playwright
Docker image) so font rendering matches the CI runner.
