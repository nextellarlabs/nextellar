// jest.setup.ts

// 1) Add TextEncoder/TextDecoder polyfill FIRST
import { TextEncoder, TextDecoder } from 'util';
Object.assign(global, { TextEncoder, TextDecoder });

// 2) Import Jest globals for ESM
import { jest } from '@jest/globals';
Object.assign(global, { jest });

import '@testing-library/jest-dom';

// 2) Stub BroadcastChannel (MSW uses it internally)
class BroadcastChannel {
  name: string;
  onmessage: ((event: { data: any }) => void) | null = null;
  constructor(name: string) {
    this.name = name;
  }
  postMessage(message: any) {
    // no-op
  }
  close() {
    // no-op
  }
}
Object.assign(global, { BroadcastChannel });

// 3) Polyfill Web Streams API (required before undici import)
import {
  ReadableStream,
  WritableStream,
  TransformStream,
} from 'web-streams-polyfill';
Object.assign(global, { ReadableStream, WritableStream, TransformStream });

// 4) Setup fetch polyfill for MSW and networked tests
const undici = await import('undici');
Object.assign(globalThis, {
  Headers: undici.Headers,
  Request: undici.Request,
  Response: undici.Response,
  fetch: undici.fetch,
});

// 5) MSW Setup (optional - may not exist, commented out for ESM compatibility)
// try {
//   const { server } = require('./src/mocks/server');
//   beforeAll(() => server.listen());
//   afterEach(() => server.resetHandlers());
//   afterAll(() => server.close());
// } catch (error) {
//   // MSW server not available, skip
// }
