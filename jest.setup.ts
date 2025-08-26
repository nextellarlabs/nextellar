// jest.setup.ts
import '@testing-library/jest-dom';

// 0) Stub BroadcastChannel (MSW uses it internally)
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
global.BroadcastChannel = BroadcastChannel as any;

import { Headers, Request, Response, fetch } from 'undici';

(globalThis as any).Headers = Headers;
(globalThis as any).Request = Request;
(globalThis as any).Response = Response;
(globalThis as any).fetch = fetch;

// 2) Polyfill TextEncoder/TextDecoder
import { TextEncoder, TextDecoder } from 'util';
global.TextEncoder = TextEncoder as any;
global.TextDecoder = TextDecoder as any;

// 3) Polyfill Web Streams API
import {
  ReadableStream,
  WritableStream,
  TransformStream,
} from 'web-streams-polyfill';
global.ReadableStream  = ReadableStream  as any;
global.WritableStream  = WritableStream  as any;
global.TransformStream = TransformStream as any;

// 4) MSW Setup
import { server } from './src/mocks/server';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
