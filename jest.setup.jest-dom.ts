// jest.setup.jest-dom.ts
//
// Minimal setupFilesAfterEnv entry that wires up `@testing-library/jest-dom`
// matchers (toBeInTheDocument, toHaveTextContent, toHaveClass, etc.) used by
// component tests under jsdom (`@jest-environment jsdom`).
//
// Deliberately does NOT start the MSW server or apply the other global
// polyfills in jest.setup.ts — those affect every test in the repo,
// including the ~190 files that drive a real local Express app via
// `supertest`, and MSW's global network interception causes unrelated
// `console.warn` assertions in some of those to fail (e.g.
// tests/middleware/errorHandler.test.ts, routes-d/tests/defi.yields.get.test.ts)
// since it intercepts and warns on requests it has no handler for. Until
// that's addressed repo-wide, keep this setup file scoped to jest-dom only.
import { jest } from '@jest/globals';
Object.assign(global, { jest });

import '@testing-library/jest-dom';
