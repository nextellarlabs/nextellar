// jest.setup.ts

// 1) Add encoding and binary web API polyfills first
import { TextEncoder, TextDecoder } from 'util';
import { Blob, File } from 'buffer';
Object.assign(globalThis, { TextEncoder, TextDecoder, Blob, File });

// 2) Import Jest globals for ESM
import { jest } from '@jest/globals';
Object.assign(global, { jest });

import '@testing-library/jest-dom';

// 3) Stub BroadcastChannel (MSW uses it internally)
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

// 4) Polyfill Web Streams API (required before undici import)
import {
  ReadableStream,
  WritableStream,
  TransformStream,
} from 'web-streams-polyfill';
Object.assign(global, { ReadableStream, WritableStream, TransformStream });

// 5) Setup fetch/web polyfill for MSW and networked tests
const undici = await import('undici');
Object.assign(globalThis, {
  Headers: undici.Headers,
  Request: undici.Request,
  Response: undici.Response,
  FormData: undici.FormData,
  fetch: undici.fetch,
});

// 6) MSW Setup - ESM compatible
const { server } = await import('./src/mocks/server.js');
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
